import { z } from "zod";
import type { ScriptureSearchResult } from "./ai/types";

/**
 * The contract between the browser and the free-search server function. Safe to import from browser
 * code (no secrets, no server modules): request shape, the one place the rules for a query live, and
 * the result types.
 */

/** Editions the free search may ever cover. KJAV (pending rights), BBE and FBV (excluded) are absent
 * on purpose; the database enforces the same gate (bible_sources.license_status). */
export const FREE_SEARCH_EDITIONS = ["WEB", "BSB", "ASV"] as const;
export type FreeSearchEdition = (typeof FREE_SEARCH_EDITIONS)[number];

export const FREE_SEARCH_MIN_QUERY = 2;
export const FREE_SEARCH_MAX_QUERY = 200;
/** One page, and the deepest offset the database serves (search_bible returns nothing beyond it). */
export const FREE_SEARCH_PAGE_LIMIT = 25;
export const FREE_SEARCH_MAX_OFFSET = 1000;
/** Rows a person can ever reach for one search: the last page starts at the maximum offset. */
export const FREE_SEARCH_MAX_REACHABLE = FREE_SEARCH_MAX_OFFSET + FREE_SEARCH_PAGE_LIMIT;

/**
 * Shape check only. The size cap stops absurd payloads; the real query rules (length, characters)
 * run in the service so a bad query gets a plain answer, not a validation failure. Unknown keys are
 * rejected, and so is any edition outside the allow-list.
 */
export const freeSearchRequestSchema = z
  .object({
    query: z.string().max(2000),
    editions: z
      .array(z.enum(FREE_SEARCH_EDITIONS))
      .min(1)
      .max(FREE_SEARCH_EDITIONS.length)
      .optional(),
    offset: z.number().int().min(0).max(FREE_SEARCH_MAX_OFFSET).optional(),
    limit: z.number().int().min(1).max(FREE_SEARCH_PAGE_LIMIT).optional(),
    /** false: search the words exactly as typed, without typo repair. */
    repair: z.boolean().optional(),
  })
  .strict();
export type FreeSearchRequest = z.infer<typeof freeSearchRequestSchema>;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export type QueryCheck = { ok: true; query: string } | { ok: false };

/** Normalises a query (Unicode NFC, control characters and runs of space become one space) and checks its length. */
export function normalizeFreeQuery(raw: string): QueryCheck {
  const query = raw.normalize("NFC").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (query.length < FREE_SEARCH_MIN_QUERY || query.length > FREE_SEARCH_MAX_QUERY) {
    return { ok: false };
  }
  return { ok: true, query };
}

/** A verse that matched; `translation` is the canonical edition code it was found in. */
export type FreeSearchHit = ScriptureSearchResult;

export type FreeSearchStatus = "preparing" | "ready";

export interface FreeSearchResponse {
  status: FreeSearchStatus;
  /** This page, best match first. */
  results: FreeSearchHit[];
  /** Exact number of matching verses, not just this page. */
  total: number;
  /** Where this page started. */
  offset: number;
  /** More rows can be fetched (and are reachable). */
  hasMore: boolean;
  /** There are more matches than the 1,025 rows the search can serve. */
  limitReached: boolean;
  /** Canonical codes of the editions that were actually searched. */
  searchedEditions: string[];
  /** The query after typo repair, when it changed. */
  correctedQuery?: string | undefined;
}

export type FreeSearchFailure = "invalid" | "limit" | "timeout" | "unavailable";

/** What the server function returns. Errors are values, never thrown, so no internal text can leak. */
export type FreeSearchServerResult =
  | { ok: true; response: FreeSearchResponse }
  | { ok: false; error: FreeSearchFailure; retryAfterSeconds?: number };

/** The page after this one starts where this one ended. */
export function nextOffset(response: Pick<FreeSearchResponse, "offset" | "results" | "hasMore">) {
  return response.hasMore ? response.offset + response.results.length : undefined;
}

export function pagingFor(total: number, offset: number, returned: number) {
  const end = offset + returned;
  return {
    hasMore: returned > 0 && end < total && end < FREE_SEARCH_MAX_REACHABLE,
    limitReached: total > FREE_SEARCH_MAX_REACHABLE && end >= FREE_SEARCH_MAX_REACHABLE,
  };
}
