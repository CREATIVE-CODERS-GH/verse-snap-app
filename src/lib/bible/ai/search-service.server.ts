import { DEFAULT_TRANSLATION } from "../service";
import { resolveTranslation } from "../translations";
import { readAiSearchConfig, type AiSearchConfig } from "./config.server";
import { isOnVercel } from "./client-ip.server";
import {
  createSupabaseTokenVerifier,
  resolveIdentity,
  type Identity,
  type TokenVerifier,
} from "./identity.server";
import { checkQuery } from "./input";
import { MAX_CANDIDATES } from "./prompt";
import { createProvider } from "./providers/index.server";
import {
  consumeQuota,
  supabaseConsumeRpc,
  type ConsumeRpc,
  type QuotaDecision,
} from "./quota.server";
import { resolveAndRank } from "./rank";
import {
  AiProviderError,
  type AiStatus,
  type ReferenceCandidate,
  type ReferenceProvider,
  type ScriptureSearchResponse,
  type ScriptureSearchResult,
} from "./types";

/**
 * The server-side orchestrator for AI Bible search. Order of work (each step can stop the request):
 *  1. kill switch  2. query rules  3. translation  4. provider and secrets present
 *  5. who is asking  6. database quota (fail closed)  7. result cache  8. provider call
 *  9. HelloAO verification and ranking.
 * The quota is consumed BEFORE the cache is read, so repeating a query cannot dodge the limits.
 * Messages returned to the browser are fixed strings; provider and database errors never leave here.
 */

export const MESSAGES = {
  notConfigured: "Scripture search is not configured.",
  unavailable: "Scripture search is unavailable right now.",
  translation: "That translation isn't available for search.",
  guestDaily: "You've used today's free searches. Sign in for more, or try again tomorrow.",
  userDaily: "You've reached today's search limit. Please try again tomorrow.",
} as const;

export function retryMessage(seconds: number): string {
  const wait = seconds < 60 ? `${Math.max(1, Math.ceil(seconds))} seconds` : "a minute";
  return `Too many searches just now. Try again in ${wait}.`;
}

type Env = Record<string, string | undefined>;

export interface RequestContext {
  headers: { get(name: string): string | null };
  socketIp: string | undefined;
}

export interface UsageLog {
  event: "ai_search";
  outcome: string;
  cached: boolean;
  subjectKind?: "user" | "guest";
  /** Edition code only (for example "KJAV"); never the search text. */
  translation?: string;
  /** Whether the request carried a bearer token (not the token itself). */
  tokenPresent?: boolean;
  provider?: string;
  model?: string;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number | null;
  candidates?: number;
}

export interface SearchServiceDeps {
  readConfig: () => AiSearchConfig;
  env: Env;
  onVercel: boolean;
  createProvider: (config: AiSearchConfig, env: Env) => ReferenceProvider | null;
  verifyToken: TokenVerifier;
  consumeRpc: ConsumeRpc;
  resolveAndRank: (
    query: string,
    translation: string,
    candidates: readonly ReferenceCandidate[],
  ) => Promise<ScriptureSearchResult[]>;
  cache: Map<string, ScriptureSearchResponse>;
  log: (entry: UsageLog) => void;
}

const CACHE_LIMIT = 100;
const sharedCache = new Map<string, ScriptureSearchResponse>();

export function defaultDeps(): SearchServiceDeps {
  return {
    readConfig: () => readAiSearchConfig(),
    env: process.env,
    onVercel: isOnVercel(),
    createProvider,
    verifyToken: createSupabaseTokenVerifier(),
    consumeRpc: supabaseConsumeRpc,
    resolveAndRank: (query, translation, candidates) =>
      resolveAndRank(query, translation, candidates),
    cache: sharedCache,
    // Numbers and outcomes only: never the query, the caller, or any key.
    log: (entry) => console.info("[ai-search]", JSON.stringify(entry)),
  };
}

function fail(errorMessage: string, aiStatus?: AiStatus): ScriptureSearchResponse {
  return { results: [], failed: true, errorMessage, ...(aiStatus ? { aiStatus } : {}) };
}

function cacheKey(query: string, translation: string): string {
  return `${translation}::${query.toLowerCase()}`;
}

function quotaMessage(
  decision: Extract<QuotaDecision, { allowed: false }>,
  identity: Identity,
): string {
  switch (decision.reason) {
    case "minute":
      return retryMessage(decision.retryAfterSeconds);
    case "day":
      return identity.kind === "user" ? MESSAGES.userDaily : MESSAGES.guestDaily;
    default:
      return MESSAGES.unavailable; // global caps and "could not check": no detail for the browser
  }
}

export async function runAiSearch(
  input: { query: string; translation?: string | undefined },
  ctx: RequestContext & { authorization?: string | null },
  deps: SearchServiceDeps = defaultDeps(),
): Promise<ScriptureSearchResponse> {
  try {
    const config = deps.readConfig();
    if (!config.enabled) {
      deps.log({ event: "ai_search", outcome: "disabled", cached: false });
      return fail(MESSAGES.notConfigured, "off");
    }

    const checked = checkQuery(input.query);
    if (!checked.ok) return fail(checked.message);
    const query = checked.query;

    let translation: string;
    try {
      translation = resolveTranslation(input.translation ?? DEFAULT_TRANSLATION).code;
    } catch {
      return fail(MESSAGES.translation);
    }

    const salt = deps.env["RATE_LIMIT_SALT"]?.trim() ?? "";
    const provider = deps.createProvider(config, deps.env);
    if (!provider || !salt) {
      deps.log({ event: "ai_search", outcome: "not_configured", cached: false });
      return fail(MESSAGES.notConfigured, "off");
    }

    const authorization = ctx.authorization ?? ctx.headers.get("authorization");
    const identity = await resolveIdentity({
      headers: ctx.headers,
      socketIp: ctx.socketIp,
      onVercel: deps.onVercel,
      authorization,
      salt,
      verifyToken: deps.verifyToken,
    });
    // Safe to log: the kind of caller, the edition, and whether a token was sent. No text, address or token.
    const caller = {
      subjectKind: identity.kind,
      translation,
      tokenPresent: /^Bearer\s+\S+/i.test(authorization ?? ""),
    } as const;

    const decision = await consumeQuota(identity, config.limits, deps.consumeRpc);
    if (!decision.allowed) {
      deps.log({
        event: "ai_search",
        outcome: `denied_${decision.reason}`,
        cached: false,
        ...caller,
      });
      return fail(
        quotaMessage(decision, identity),
        decision.reason === "unavailable" ? "unavailable" : "limit",
      );
    }

    const key = cacheKey(query, translation);
    const cached = deps.cache.get(key);
    if (cached) {
      deps.log({ event: "ai_search", outcome: "ok", cached: true, ...caller });
      return cached;
    }

    let candidates: ReferenceCandidate[];
    try {
      const found = await provider.findCandidates({ query, maxCandidates: MAX_CANDIDATES });
      candidates = found.candidates;
      deps.log({
        event: "ai_search",
        outcome: "ok",
        cached: false,
        ...caller,
        provider: provider.id,
        model: config.model,
        effort: config.effort,
        candidates: candidates.length,
        ...(found.usage
          ? {
              inputTokens: found.usage.inputTokens,
              outputTokens: found.usage.outputTokens,
              reasoningTokens: found.usage.reasoningTokens,
              estimatedCostUsd: found.usage.estimatedCostUsd,
            }
          : {}),
      });
    } catch (error) {
      const kind = error instanceof AiProviderError ? error.kind : "unavailable";
      deps.log({
        event: "ai_search",
        outcome: `provider_${kind}`,
        cached: false,
        ...caller,
        provider: provider.id,
        model: config.model,
        effort: config.effort,
      });
      if (kind === "refused") return { results: [], failed: false, source: "ai", aiStatus: "used" };
      return kind === "not_configured"
        ? fail(MESSAGES.notConfigured, "off")
        : fail(MESSAGES.unavailable, "unavailable");
    }

    const results = await deps.resolveAndRank(query, translation, candidates);
    const response: ScriptureSearchResponse = {
      results,
      failed: false,
      source: "ai",
      aiStatus: "used",
    };
    if (deps.cache.size >= CACHE_LIMIT) {
      const oldest = deps.cache.keys().next().value;
      if (oldest !== undefined) deps.cache.delete(oldest);
    }
    deps.cache.set(key, response);
    return response;
  } catch (error) {
    // Unexpected: log the error type only (its message could carry provider or database detail).
    console.error(
      "[ai-search] unexpected failure:",
      error instanceof Error ? error.name : "unknown",
    );
    return fail(MESSAGES.unavailable, "unavailable");
  }
}
