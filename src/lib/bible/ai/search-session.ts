import type { ScriptureSearchResponse, ScriptureSearchResult } from "./types";

/**
 * Browser-side memory for AI search, so a paid result is never paid for twice by accident.
 *
 * 1. Successful results are saved in sessionStorage (this tab only, cleared when it closes) for one
 *    hour, keyed by translation and normalized query. A reload or a dev-server restart restores the
 *    result with no request.
 * 2. Only successful, well-formed responses are ever saved. Failures, tokens, account data and
 *    anything else are never written. What is saved is the public scripture text the user saw.
 * 3. Whatever is read back is validated again before it is trusted.
 * 4. "Paid search intent" lives only in this module's memory, so a reload clears it: a URL that
 *    carries a search never starts a paid request by itself, only an action in the current page does.
 */

export const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
export const MAX_SAVED_SEARCHES = 20;
const MAX_RESULTS_SAVED = 8;
const CLOCK_SKEW_MS = 60 * 1000;
const PREFIX = "versesnap.aisearch.v1:";

/** The slice of Storage this module needs (also what tests substitute). */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserSessionStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined; // storage blocked (private mode, policy)
  }
}

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function searchKey(query: string, translation: string): string {
  return `${translation}::${normalizeQuery(query)}`;
}

export interface SavedSearch {
  response: ScriptureSearchResponse;
  savedAt: number;
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 200;
}

function isValidResult(value: unknown): value is ScriptureSearchResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    isText(item["translation"], 12) &&
    isText(item["bookId"], 40) &&
    isText(item["bookName"], 60) &&
    isCount(item["chapter"]) &&
    isCount(item["verse"]) &&
    isText(item["reference"], 100) &&
    isText(item["text"], 4000)
  );
}

function entryName(query: string, translation: string): string {
  return `${PREFIX}${searchKey(query, translation)}`;
}

function removeQuietly(storage: StorageLike, name: string): void {
  try {
    storage.removeItem(name);
  } catch {
    /* ignore */
  }
}

/** Returns a saved successful result, or null when there is none, it expired, or it is not valid. */
export function readSavedSearch(
  storage: StorageLike | undefined,
  query: string,
  translation: string,
  now: number = Date.now(),
): SavedSearch | null {
  if (!storage || !normalizeQuery(query)) return null;
  const name = entryName(query, translation);
  let raw: string | null;
  try {
    raw = storage.getItem(name);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const savedAt = parsed?.["savedAt"];
    const results = parsed?.["results"];
    const valid =
      parsed !== null &&
      typeof parsed === "object" &&
      parsed["v"] === 1 &&
      parsed["translation"] === translation &&
      typeof savedAt === "number" &&
      Number.isFinite(savedAt) &&
      now - savedAt <= SEARCH_CACHE_TTL_MS &&
      savedAt <= now + CLOCK_SKEW_MS &&
      Array.isArray(results) &&
      results.length <= MAX_RESULTS_SAVED &&
      results.every(isValidResult);
    if (valid) {
      return {
        savedAt: savedAt as number,
        response: { results: results as ScriptureSearchResult[], failed: false },
      };
    }
  } catch {
    /* fall through to removal */
  }
  removeQuietly(storage, name);
  return null;
}

/** Saves a successful response. Returns false (and writes nothing) for anything else. */
export function saveSearch(
  storage: StorageLike | undefined,
  query: string,
  translation: string,
  response: ScriptureSearchResponse,
  now: number = Date.now(),
): boolean {
  if (!storage || !normalizeQuery(query)) return false;
  if (response.failed) return false;
  if (!Array.isArray(response.results) || response.results.length > MAX_RESULTS_SAVED) return false;
  if (!response.results.every(isValidResult)) return false;
  try {
    // Only these fields are stored: the results the user saw and when they were saved.
    storage.setItem(
      entryName(query, translation),
      JSON.stringify({
        v: 1,
        translation,
        savedAt: now,
        results: response.results.map((item) => ({
          translation: item.translation,
          bookId: item.bookId,
          bookName: item.bookName,
          chapter: item.chapter,
          verse: item.verse,
          reference: item.reference,
          text: item.text,
        })),
      }),
    );
    pruneSavedSearches(storage, now);
    return true;
  } catch {
    return false; // storage full or blocked: the search still works, it just is not remembered
  }
}

/** Removes expired or unreadable entries and keeps at most MAX_SAVED_SEARCHES, newest first. */
export function pruneSavedSearches(storage: StorageLike, now: number = Date.now()): void {
  try {
    const entries: Array<{ name: string; savedAt: number }> = [];
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index);
      if (!name?.startsWith(PREFIX)) continue;
      let savedAt = Number.NaN;
      try {
        savedAt = Number(
          (JSON.parse(storage.getItem(name) ?? "null") as { savedAt?: unknown } | null)?.savedAt,
        );
      } catch {
        /* unreadable */
      }
      entries.push({ name, savedAt });
    }
    const keep = entries
      .filter(
        (entry) => Number.isFinite(entry.savedAt) && now - entry.savedAt <= SEARCH_CACHE_TTL_MS,
      )
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_SAVED_SEARCHES);
    const keepNames = new Set(keep.map((entry) => entry.name));
    for (const entry of entries) if (!keepNames.has(entry.name)) removeQuietly(storage, entry.name);
  } catch {
    /* best effort */
  }
}

// --- paid-search intent (memory only: gone after any reload) ---------------------------------

const intents = new Set<string>();

/** Records that the user, in this page session, asked for this search. */
export function allowPaidSearch(query: string, translation: string): void {
  if (normalizeQuery(query)) intents.add(searchKey(query, translation));
}

export function isPaidSearchAllowed(query: string, translation: string): boolean {
  return intents.has(searchKey(query, translation));
}

/** For tests: forget all intent, as a page reload does. */
export function resetPaidSearchIntent(): void {
  intents.clear();
}
