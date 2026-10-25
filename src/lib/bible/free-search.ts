import { BIBLE_TRANSLATIONS } from "./translations";
import {
  FREE_SEARCH_PAGE_LIMIT,
  nextOffset,
  type FreeSearchHit,
  type FreeSearchRequest,
  type FreeSearchResponse,
  type FreeSearchServerResult,
  type FreeSearchStatus,
} from "./free-search-protocol";

export type { FreeSearchHit, FreeSearchResponse, FreeSearchStatus };

/**
 * The free (no AI, no cost) Bible text search, as the search screen sees it.
 *
 * The screen talks to a `FreeSearchProvider`. In the app that is the server function
 * (`createServerFreeSearchProvider`); it answers "preparing" until the index is switched on, which the
 * screen shows as "Free Bible search is being prepared." Tests and the dev-only browser hook use
 * `free-search-mock.ts`. Nothing here holds a key, and nothing starts AI.
 *
 * Search covers every licensed and indexed edition by default. Every result names the edition its
 * match was found in, and editions that were not searched are reported separately: an edition that
 * cannot be searched is never presented as having no matching verses.
 */

export const FREE_SEARCH_PREPARING_MESSAGE = "Free Bible search is being prepared.";
export const SMART_SEARCH_LABEL = "Try Smart Search";

/**
 * Smart Search (paid AI) stays switched off during development, so its button is only offered when
 * this build flag is set. The server-side kill switch (AI_SEARCH_ENABLED) is separate and unchanged.
 */
export const SMART_SEARCH_OFFERED = import.meta.env["VITE_SMART_SEARCH_OFFERED"] === "true";

export interface FreeSearchInput {
  query: string;
  /** Edition codes to search. Omitted: every indexed edition. */
  editions?: readonly string[] | undefined;
  /** Rows per page (the server clamps it to 25). */
  limit: number;
  /** Where the page starts (0, 25, 50 …; the server serves up to 1,000). */
  offset?: number | undefined;
  /** false: search the words as typed, without typo repair. */
  repair?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface FreeSearchProvider {
  search(input: FreeSearchInput): Promise<FreeSearchResponse>;
}

export type FreeSearchErrorKind = "network" | "limit" | "timeout" | "failed";
const FREE_SEARCH_ERROR_KINDS: readonly string[] = ["network", "limit", "timeout", "failed"];

/** What a provider throws. Only a kind: no query text and no provider error text. */
export class FreeSearchError extends Error {
  constructor(
    readonly kind: FreeSearchErrorKind,
    readonly retryAfterSeconds?: number,
  ) {
    super(kind);
    this.name = "FreeSearchError";
  }
}

/** The kind of a thrown error, for choosing the message; unknown errors count as a failed search. */
export function classifyFreeSearchError(error: unknown): FreeSearchErrorKind {
  if (error instanceof FreeSearchError) return error.kind;
  // Also recognised by name, so an error built in another bundle (or a test hook) still classifies.
  const named = error as { name?: unknown; kind?: unknown } | null;
  if (named?.name === "FreeSearchError" && FREE_SEARCH_ERROR_KINDS.includes(named.kind as never)) {
    return named.kind as FreeSearchErrorKind;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return "network";
  }
  return "failed";
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Reports "preparing" with nothing searched: the state until the index exists. */
export const preparingProvider: FreeSearchProvider = {
  search: async () => ({
    status: "preparing",
    results: [],
    total: 0,
    offset: 0,
    hasMore: false,
    limitReached: false,
    searchedEditions: [],
  }),
};

/** How the browser calls the server function (see free-search.functions.ts). */
export type RunFreeSearch = (payload: {
  data: FreeSearchRequest;
  signal?: AbortSignal;
}) => Promise<FreeSearchServerResult>;

/**
 * The provider backed by the server function. A failed result becomes a typed error; a network
 * failure stays an error the screen can classify. An aborted search rejects with an AbortError so the
 * query library drops it instead of showing it.
 */
export function createServerFreeSearchProvider(run: RunFreeSearch): FreeSearchProvider {
  return {
    async search(input) {
      const data: FreeSearchRequest = {
        query: input.query,
        offset: input.offset ?? 0,
        limit: input.limit,
        ...(input.repair === false ? { repair: false } : {}),
        ...(input.editions
          ? { editions: input.editions as NonNullable<FreeSearchRequest["editions"]> }
          : {}),
      };
      const result = await run({ data, ...(input.signal ? { signal: input.signal } : {}) });
      if (result.ok) return result.response;
      switch (result.error) {
        case "limit":
          throw new FreeSearchError("limit", result.retryAfterSeconds);
        case "timeout":
          throw new FreeSearchError("timeout");
        default:
          throw new FreeSearchError("failed");
      }
    },
  };
}

declare global {
  var __verseSnapFreeSearch: FreeSearchProvider | undefined;
}

/**
 * The provider the screen uses. In development only, a provider installed on
 * `globalThis.__verseSnapFreeSearch` takes over so browser tests can supply results without a
 * backend; production builds never look at it. Without a server function the screen shows "preparing".
 */
export function getFreeSearchProvider(run?: RunFreeSearch): FreeSearchProvider {
  if (import.meta.env.DEV && globalThis.__verseSnapFreeSearch) {
    return globalThis.__verseSnapFreeSearch;
  }
  return run ? createServerFreeSearchProvider(run) : preparingProvider;
}

/** Rows asked for per request; the screen reveals them 10 at a time. */
export const FREE_SEARCH_LIMIT = FREE_SEARCH_PAGE_LIMIT;
export const FREE_SEARCH_PAGE_SIZE = 10;

export const FREE_SEARCH_QUERY_KEY = "free-search";

/** Same search, same key: case and spacing do not make a new request. */
export function freeSearchKey(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Options for useInfiniteQuery: one request per page of 25, the next page only when asked. Nothing is
 * stored on the device (queries are private); results live in memory for the page session, nothing
 * refetches on its own, a failure is never retried automatically, and the abort signal reaches the
 * provider so a superseded search is cancelled.
 */
export function freeSearchInfiniteOptions(input: {
  provider: FreeSearchProvider;
  query: string;
  enabled: boolean;
  /** false: the person chose their original wording; typos are not repaired. */
  repair?: boolean;
}) {
  const { provider, query } = input;
  const repair = input.repair !== false;
  return {
    queryKey: [FREE_SEARCH_QUERY_KEY, freeSearchKey(query), repair ? "repaired" : "exact"] as const,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      provider.search({
        query,
        limit: FREE_SEARCH_LIMIT,
        offset: pageParam,
        signal,
        ...(repair ? {} : { repair: false }),
      }),
    initialPageParam: 0,
    getNextPageParam: (last: FreeSearchResponse) => nextOffset(last),
    enabled: input.enabled && query.trim().length > 0,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    retry: false as const,
  };
}

/** Catalogue editions that were not searched (not licensed for indexing, or not imported yet). */
export function unindexedEditions(searchedEditions: readonly string[]): string[] {
  const searched = new Set(searchedEditions);
  return BIBLE_TRANSLATIONS.map((item) => item.code).filter((code) => !searched.has(code));
}

/** "BBE", "BBE and FBV", "KJAV, BBE and FBV". */
export function formatEditionList(codes: readonly string[]): string {
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/**
 * The note that keeps "not searched" apart from "no match". Null when everything was searched, and
 * while the index is still being prepared (that state has its own message).
 */
export function unindexedNotice(
  response: Pick<FreeSearchResponse, "status" | "searchedEditions">,
): string | null {
  if (response.status !== "ready") return null;
  const missing = unindexedEditions(response.searchedEditions);
  if (missing.length === 0) return null;
  return `Full-text search isn't available yet for ${formatEditionList(missing)}.`;
}

/** What a "no verses found" screen names as searched, or null when nothing was searched. */
export function searchedSummary(searchedEditions: readonly string[]): string | null {
  return searchedEditions.length === 0 ? null : formatEditionList([...searchedEditions]);
}

/** The slice of `results` to render now: never more than `visible`, however many came back. */
export function pageOfResults<T>(results: readonly T[], visible: number): T[] {
  return results.slice(0, Math.max(0, visible));
}

/** Where a result opens: its own edition, book, chapter and verse. */
export function resultRouteParams(item: FreeSearchHit) {
  return {
    translation: item.translation,
    book: item.bookId,
    chapter: String(item.chapter),
    verse: String(item.verse),
  };
}

/** A stable list key: the same verse in two editions is two different rows. */
export function resultKey(item: FreeSearchHit): string {
  return `${item.translation}-${item.bookId}-${item.chapter}-${item.verse}`;
}

/**
 * "Showing 10 of 395 verses", or "395 verses" once everything is shown. When the matches exceed what
 * the search can serve, the text says so and suggests narrowing the search.
 */
export function resultSummary(shown: number, total: number, limitReached: boolean): string {
  const format = (n: number) => n.toLocaleString("en-US");
  if (limitReached) {
    return `Showing ${format(shown)} of ${format(total)} verses. Refine your search to narrow the results.`;
  }
  const noun = total === 1 ? "verse" : "verses";
  return shown >= total
    ? `${format(total)} ${noun}`
    : `Showing ${format(shown)} of ${format(total)} ${noun}`;
}
