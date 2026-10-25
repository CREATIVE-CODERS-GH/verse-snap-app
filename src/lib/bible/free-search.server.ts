import { fromApiBookId } from "./books";
import { isOnVercel } from "./ai/client-ip.server";
import {
  createSupabaseTokenVerifier,
  resolveIdentity,
  type Identity,
  type TokenVerifier,
} from "./ai/identity.server";
import {
  FREE_SEARCH_EDITIONS,
  FREE_SEARCH_MAX_OFFSET,
  FREE_SEARCH_PAGE_LIMIT,
  freeSearchRequestSchema,
  normalizeFreeQuery,
  pagingFor,
  type FreeSearchHit,
  type FreeSearchRequest,
  type FreeSearchResponse,
  type FreeSearchServerResult,
} from "./free-search-protocol";
import { formatReference } from "./types";

/**
 * The server side of free Bible search: the only code that talks to the search index.
 *
 * Order of work (each step can stop the request, and nothing after it runs):
 *   1. kill switch (FREE_SEARCH_ENABLED)      5. which editions are searchable right now
 *   2. request shape, edition allow-list      6. rate limit, BEFORE any search work
 *   3. query rules (normalise, 2-200 chars)   7. the search, with a hard time limit
 *   4. who is asking (token, else keyed IP)   8. mapping rows to canonical, translation-aware results
 *
 * Privacy: the query text is passed to the database as a bound parameter and goes nowhere else. It is
 * not stored, cached, logged or put in an error. Logs carry outcomes and counts only, and an
 * unexpected failure logs only the error's class and code, never its message (which could carry
 * parameters). Failures return fixed values (`FreeSearchServerResult`), never thrown text.
 *
 * Data access is behind `FreeSearchStore` so tests run without Supabase. The production store uses
 * the service-role client, which exists only in server modules and is loaded lazily.
 */

type Env = Record<string, string | undefined>;

export interface FreeSearchLimits {
  guestMinute: number;
  guestDay: number;
  userMinute: number;
  userDay: number;
  /** Shared ceiling across everyone: protects the database, not money. */
  globalMinute: number;
}

export interface FreeSearchConfig {
  /** Master switch. Off unless FREE_SEARCH_ENABLED is "true", in every environment. */
  enabled: boolean;
  /** Hard limit on one search, including the database call. */
  timeoutMs: number;
  limits: FreeSearchLimits;
}

export const DEFAULT_FREE_LIMITS: FreeSearchLimits = {
  guestMinute: 30,
  guestDay: 600,
  userMinute: 60,
  userDay: 1500,
  globalMinute: 300,
};
export const DEFAULT_TIMEOUT_MS = 2000;

function positiveInt(value: string | undefined, fallback: number, max = 1_000_000): number {
  if (value === undefined || !/^\d{1,9}$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  return parsed >= 1 ? Math.min(parsed, max) : fallback;
}

export function readFreeSearchConfig(env: Env = process.env): FreeSearchConfig {
  return {
    enabled: env["FREE_SEARCH_ENABLED"]?.trim().toLowerCase() === "true",
    timeoutMs: Math.max(
      500,
      Math.min(5000, positiveInt(env["FREE_SEARCH_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS, 60_000)),
    ),
    limits: {
      guestMinute: positiveInt(env["FREE_LIMIT_GUEST_MINUTE"], DEFAULT_FREE_LIMITS.guestMinute),
      guestDay: positiveInt(env["FREE_LIMIT_GUEST_DAY"], DEFAULT_FREE_LIMITS.guestDay),
      userMinute: positiveInt(env["FREE_LIMIT_USER_MINUTE"], DEFAULT_FREE_LIMITS.userMinute),
      userDay: positiveInt(env["FREE_LIMIT_USER_DAY"], DEFAULT_FREE_LIMITS.userDay),
      globalMinute: positiveInt(env["FREE_LIMIT_GLOBAL_MINUTE"], DEFAULT_FREE_LIMITS.globalMinute),
    },
  };
}

// ---------- data access ----------

/** One row of public.search_bible(). */
export interface SearchRow {
  edition_code: string;
  book: string;
  chapter: number;
  verse: number;
  verse_text: string;
  total_count: number;
  corrected_query: string | null;
}

export interface QuotaAnswer {
  allowed: boolean;
  reason: string | null;
  retryAfterSeconds: number;
}

/** Thrown by a store; carries a kind and a database error code only, never a message. */
export class StoreError extends Error {
  constructor(
    readonly kind: "timeout" | "unavailable",
    readonly code?: string,
  ) {
    super(kind);
    this.name = "StoreError";
  }
}

export interface FreeSearchStore {
  /** Edition codes whose source is active and approved right now. */
  listActiveEditions(signal: AbortSignal): Promise<string[]>;
  /** One atomic call: per-person minute and day windows, then the shared per-minute ceiling. Null = unreadable. */
  consumeQuota(
    args: { subject: string; minuteLimit: number; dayLimit: number; globalMinuteLimit: number },
    signal: AbortSignal,
  ): Promise<QuotaAnswer | null>;
  search(
    args: {
      query: string;
      editions: readonly string[];
      limit: number;
      offset: number;
      /** false: no typo repair (the person chose their original wording). */
      repair: boolean;
    },
    signal: AbortSignal,
  ): Promise<SearchRow[]>;
}

/** PostgreSQL / PostgREST codes that mean "too slow": statement_timeout and a cancelled query. */
const TIMEOUT_CODES = new Set(["57014", "57P01"]);

interface RpcResult {
  data: unknown;
  error: { code?: string } | null;
}
interface AdminLike {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): { abortSignal(signal: AbortSignal): PromiseLike<RpcResult> };
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): { abortSignal(signal: AbortSignal): PromiseLike<RpcResult> };
      };
    };
  };
}

function storeError(error: { code?: string } | null | unknown, signal: AbortSignal): StoreError {
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : undefined;
  if ((code && TIMEOUT_CODES.has(code)) || signal.aborted) return new StoreError("timeout", code);
  return new StoreError("unavailable", code);
}

/**
 * Production store: the server-only service-role client, loaded lazily. Calls are POST requests to
 * PostgREST (the default for rpc; never `get: true`), so the query text travels in a request body,
 * not a URL. Errors are reduced to a kind and a code.
 */
export function createSupabaseStore(
  loadAdmin: () => Promise<AdminLike> = async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as unknown as AdminLike;
  },
): FreeSearchStore {
  return {
    async listActiveEditions(signal) {
      try {
        const admin = await loadAdmin();
        const { data, error } = await admin
          .from("bible_sources")
          .select("edition_code")
          .eq("status", "active")
          .eq("license_status", "approved")
          .abortSignal(signal);
        if (error) throw storeError(error, signal);
        return Array.isArray(data)
          ? data.flatMap((row: unknown) => {
              const code = (row as { edition_code?: unknown })?.edition_code;
              return typeof code === "string" ? [code] : [];
            })
          : [];
      } catch (error) {
        throw error instanceof StoreError ? error : storeError(error, signal);
      }
    },

    async consumeQuota(args, signal) {
      try {
        const admin = await loadAdmin();
        const { data, error } = await admin
          .rpc("consume_free_search_quota", {
            p_subject: args.subject,
            p_minute_limit: args.minuteLimit,
            p_day_limit: args.dayLimit,
            p_global_minute_limit: args.globalMinuteLimit,
          })
          .abortSignal(signal);
        if (error) return null;
        const row: unknown = Array.isArray(data) ? data[0] : data;
        if (!row || typeof row !== "object") return null;
        const { allowed, reason, retry_after_seconds } = row as Record<string, unknown>;
        if (typeof allowed !== "boolean") return null;
        const seconds = Number(retry_after_seconds);
        return {
          allowed,
          reason: typeof reason === "string" ? reason : null,
          retryAfterSeconds: Number.isFinite(seconds) && seconds >= 1 ? Math.ceil(seconds) : 60,
        };
      } catch {
        return null;
      }
    },

    async search(args, signal) {
      try {
        const admin = await loadAdmin();
        const { data, error } = await admin
          .rpc("search_bible", {
            p_query: args.query,
            p_editions: [...args.editions],
            p_limit: args.limit,
            p_offset: args.offset,
            p_repair: args.repair,
          })
          .abortSignal(signal);
        if (error) throw storeError(error, signal);
        return Array.isArray(data) ? (data as SearchRow[]) : [];
      } catch (error) {
        throw error instanceof StoreError ? error : storeError(error, signal);
      }
    },
  };
}

// ---------- the service ----------

/** Fixed-shape, query-free record of what happened. */
export interface FreeSearchLog {
  event: "free_search";
  outcome: string;
  subjectKind?: "user" | "guest";
  editions?: number;
  page?: number;
  results?: number;
  durationMs?: number;
  /** A database error code (for example 57014), never a message. */
  errorCode?: string;
}

export interface FreeSearchDeps {
  readConfig: () => FreeSearchConfig;
  env: Env;
  onVercel: boolean;
  verifyToken: TokenVerifier;
  store: FreeSearchStore;
  now: () => number;
  log: (entry: FreeSearchLog) => void;
  /** Active editions are cached briefly so readiness costs nothing per request. */
  editionsCache: { value: string[] | null; at: number };
}

export const EDITIONS_CACHE_MS = 60_000;

export function defaultDeps(): FreeSearchDeps {
  return {
    readConfig: () => readFreeSearchConfig(),
    env: process.env,
    onVercel: isOnVercel(),
    verifyToken: createSupabaseTokenVerifier(),
    store: createSupabaseStore(),
    now: () => Date.now(),
    // Outcomes and counts only: never the query, the caller, or a key.
    log: (entry) => console.info("[free-search]", JSON.stringify(entry)),
    editionsCache: sharedEditionsCache,
  };
}
const sharedEditionsCache: FreeSearchDeps["editionsCache"] = { value: null, at: 0 };

export interface RequestContext {
  headers: { get(name: string): string | null };
  socketIp: string | undefined;
  authorization?: string | null;
  /** The incoming request's own abort signal: a closed page cancels the database call. */
  signal?: AbortSignal | undefined;
}

const PREPARING: FreeSearchResponse = {
  status: "preparing",
  results: [],
  total: 0,
  offset: 0,
  hasMore: false,
  limitReached: false,
  searchedEditions: [],
};

const approved: readonly string[] = FREE_SEARCH_EDITIONS;

function failure(error: Extract<FreeSearchServerResult, { ok: false }>["error"], retry?: number) {
  return {
    ok: false as const,
    error,
    ...(retry !== undefined ? { retryAfterSeconds: retry } : {}),
  };
}

function toHit(row: SearchRow): FreeSearchHit | null {
  const book = fromApiBookId(row.book);
  if (!book || !approved.includes(row.edition_code)) return null;
  return {
    translation: row.edition_code,
    bookId: book.id,
    bookName: book.name,
    chapter: row.chapter,
    verse: row.verse,
    reference: formatReference({
      bookId: book.id,
      bookName: book.name,
      chapter: row.chapter,
      verse: row.verse,
    }),
    text: row.verse_text,
  };
}

export async function runFreeSearch(
  rawRequest: unknown,
  ctx: RequestContext,
  deps: FreeSearchDeps = defaultDeps(),
): Promise<FreeSearchServerResult> {
  const started = deps.now();
  const done = (entry: Omit<FreeSearchLog, "event" | "durationMs">) =>
    deps.log({ event: "free_search", durationMs: deps.now() - started, ...entry });
  try {
    // 1. kill switch: no database, no quota
    const config = deps.readConfig();
    if (!config.enabled) {
      done({ outcome: "disabled" });
      return { ok: true, response: PREPARING };
    }

    // 2-3. shape and query rules (a bad request never reaches the database)
    const parsed = freeSearchRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      done({ outcome: "invalid_request" });
      return failure("invalid");
    }
    const request: FreeSearchRequest = parsed.data;
    const checked = normalizeFreeQuery(request.query);
    if (!checked.ok) {
      done({ outcome: "invalid_query" });
      return failure("invalid");
    }
    const offset = Math.min(request.offset ?? 0, FREE_SEARCH_MAX_OFFSET);
    const limit = Math.min(request.limit ?? FREE_SEARCH_PAGE_LIMIT, FREE_SEARCH_PAGE_LIMIT);
    const requested = request.editions ? [...new Set(request.editions)] : [...approved];

    // One time limit for everything below, also cancelled when the caller goes away.
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;

    // 4. who is asking (a missing salt means we cannot rate limit: refuse rather than search unmetered)
    const salt = deps.env["RATE_LIMIT_SALT"]?.trim() ?? "";
    if (!salt) {
      done({ outcome: "not_configured" });
      return failure("unavailable");
    }
    const authorization = ctx.authorization ?? ctx.headers.get("authorization");
    const identity: Identity = await resolveIdentity({
      headers: ctx.headers,
      socketIp: ctx.socketIp,
      onVercel: deps.onVercel,
      authorization,
      salt,
      verifyToken: deps.verifyToken,
    });
    const caller = { subjectKind: identity.kind, editions: requested.length } as const;

    // 5. which editions can be searched right now (cached; one cheap read)
    let active: string[];
    const cache = deps.editionsCache;
    if (cache.value && deps.now() - cache.at < EDITIONS_CACHE_MS) {
      active = cache.value;
    } else {
      try {
        active = (await deps.store.listActiveEditions(signal)).filter((code) =>
          approved.includes(code),
        );
        cache.value = active;
        cache.at = deps.now();
      } catch (error) {
        const kind = error instanceof StoreError ? error.kind : "unavailable";
        done({
          outcome: `editions_${kind}`,
          ...caller,
          ...(error instanceof StoreError && error.code ? { errorCode: error.code } : {}),
        });
        return failure(kind === "timeout" ? "timeout" : "unavailable");
      }
    }
    const searched = requested.filter((code) => active.includes(code));
    if (searched.length === 0) {
      done({ outcome: "preparing", ...caller });
      return { ok: true, response: PREPARING };
    }

    // 6. rate limit BEFORE the search (fail closed: an unreadable counter is a refusal)
    const limits = config.limits;
    const quota = await deps.store.consumeQuota(
      {
        subject: identity.subject,
        minuteLimit: identity.kind === "user" ? limits.userMinute : limits.guestMinute,
        dayLimit: identity.kind === "user" ? limits.userDay : limits.guestDay,
        globalMinuteLimit: limits.globalMinute,
      },
      signal,
    );
    if (!quota) {
      done({ outcome: "quota_unavailable", ...caller });
      return failure("unavailable");
    }
    if (!quota.allowed) {
      done({ outcome: `denied_${quota.reason ?? "limit"}`, ...caller });
      // The shared ceiling is not the person's fault and not worth explaining: same answer as "busy".
      return failure("limit", quota.retryAfterSeconds);
    }

    // 7. the search itself
    let rows: SearchRow[];
    try {
      rows = await deps.store.search(
        {
          query: checked.query,
          editions: searched,
          limit,
          offset,
          repair: request.repair !== false,
        },
        signal,
      );
    } catch (error) {
      const kind = error instanceof StoreError ? error.kind : "unavailable";
      done({
        outcome: `search_${kind}`,
        ...caller,
        page: offset / FREE_SEARCH_PAGE_LIMIT,
        ...(error instanceof StoreError && error.code ? { errorCode: error.code } : {}),
      });
      return failure(kind === "timeout" ? "timeout" : "unavailable");
    }

    // 8. canonical, translation-aware results
    const results = rows.flatMap((row) => {
      const hit = toHit(row);
      return hit ? [hit] : [];
    });
    const total = rows[0] ? Math.max(0, Number(rows[0].total_count) || 0) : 0;
    const corrected = rows[0]?.corrected_query ?? undefined;
    const response: FreeSearchResponse = {
      status: "ready",
      results,
      total,
      offset,
      ...pagingFor(total, offset, results.length),
      searchedEditions: searched,
      ...(corrected ? { correctedQuery: corrected } : {}),
    };
    done({
      outcome: "ok",
      ...caller,
      page: offset / FREE_SEARCH_PAGE_LIMIT,
      results: results.length,
    });
    return { ok: true, response };
  } catch (error) {
    // Unexpected: class and code only. The message could carry database detail or parameters.
    const code =
      typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : undefined;
    console.error(
      "[free-search] unexpected failure:",
      error instanceof Error ? error.name : "unknown",
      code ?? "",
    );
    return failure("unavailable");
  }
}
