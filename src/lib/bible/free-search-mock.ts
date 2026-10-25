import { analyzeQuery } from "./search-router";
import {
  FreeSearchError,
  type FreeSearchErrorKind,
  type FreeSearchHit,
  type FreeSearchInput,
  type FreeSearchProvider,
  type FreeSearchResponse,
} from "./free-search";
import { FREE_SEARCH_MAX_OFFSET, FREE_SEARCH_PAGE_LIMIT, pagingFor } from "./free-search-protocol";

/**
 * An in-memory free-search provider over a small verse list. It is the executable description of how
 * the real index behaves (search_bible() in supabase/migrations/20261023000000_bible_search_index.sql):
 *
 *  - tier 3: the query's words appear consecutively in the verse (a phrase match);
 *  - tier 2: every content word appears, in any order;
 *  - tier 1: some content words appear, kept ONLY when no verse contains all of them;
 *  - stronger tiers rank first, then more content words matched, then Bible order;
 *  - only the requested editions that are indexed are searched (translation isolation);
 *  - the match is reported in the edition it was found in, and the same verse in two editions is two hits;
 *  - paging: pages of at most 25, exact `total`, nothing beyond offset 1,000;
 *  - `corrections` stands in for typo repair (a misspelled word is replaced and reported).
 *
 * It holds fixture text only. It never imports or ships a complete Bible translation.
 */

export interface MockVerse extends FreeSearchHit {
  /** Position in Bible order, to keep ties stable. */
  order?: number;
}

export interface MockProviderOptions {
  verses: readonly MockVerse[];
  /** Editions this mock has an index for. */
  indexedEditions: readonly string[];
  /** Throw this kind of error instead of answering. */
  failWith?: FreeSearchErrorKind;
  /** Pretend the index is not installed. */
  preparing?: boolean;
  /** Typo repair: misspelled word (lower case) -> word to search for. */
  corrections?: Readonly<Record<string, string>>;
  /** Called for every search, so tests can see what was asked. */
  onSearch?: (input: FreeSearchInput) => void;
  /** Wait this long (cancellable) before answering. */
  delayMs?: number;
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z']+/g) ?? [];

function tierOf(
  verseWords: readonly string[],
  queryWords: readonly string[],
  content: readonly string[],
): { tier: 0 | 1 | 2 | 3; matched: number } {
  if (queryWords.length === 0) return { tier: 0, matched: 0 };
  const verseSet = new Set(verseWords);
  const matched = content.filter((word) => verseSet.has(word)).length;
  const joined = ` ${verseWords.join(" ")} `;
  if (queryWords.length > 1 && joined.includes(` ${queryWords.join(" ")} `)) {
    return { tier: 3, matched };
  }
  if (content.length > 0 && matched === content.length) return { tier: 2, matched };
  if (matched > 0) return { tier: 1, matched };
  return { tier: 0, matched };
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function createMockFreeSearchProvider(options: MockProviderOptions): FreeSearchProvider {
  const indexed = new Set(options.indexedEditions);
  return {
    async search(input) {
      options.onSearch?.(input);
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (options.delayMs) await wait(options.delayMs, input.signal);
      if (options.failWith) throw new FreeSearchError(options.failWith);
      const offset = input.offset ?? 0;
      if (options.preparing) {
        return {
          status: "preparing",
          results: [],
          total: 0,
          offset,
          hasMore: false,
          limitReached: false,
          searchedEditions: [],
        };
      }

      const requested = input.editions ?? [...indexed];
      const searched = requested.filter((code) => indexed.has(code));
      const original = input.query.trim().replace(/\s+/g, " ");
      const repaired =
        input.repair === false
          ? original
          : original
              .split(" ")
              .map((word) => options.corrections?.[word.toLowerCase()] ?? word)
              .join(" ");
      const queryWords = words(repaired);
      const content = analyzeQuery(repaired).contentWords;

      const hits: { verse: MockVerse; tier: number; matched: number }[] = [];
      for (const verse of options.verses) {
        if (!searched.includes(verse.translation)) continue;
        const { tier, matched } = tierOf(words(verse.text), queryWords, content);
        if (tier > 0) hits.push({ verse, tier, matched });
      }
      // Some-words matches are a fallback: dropped as soon as any verse has every word.
      const strongest = hits.some((hit) => hit.tier >= 2);
      const kept = strongest ? hits.filter((hit) => hit.tier >= 2) : hits;
      kept.sort(
        (a, b) =>
          b.tier - a.tier ||
          b.matched - a.matched ||
          (a.verse.order ?? 0) - (b.verse.order ?? 0) ||
          a.verse.translation.localeCompare(b.verse.translation),
      );

      const limit = Math.max(0, Math.min(input.limit, FREE_SEARCH_PAGE_LIMIT));
      const page =
        offset > FREE_SEARCH_MAX_OFFSET
          ? []
          : kept.slice(offset, offset + limit).map(({ verse }) => {
              const { order: _order, ...hit } = verse;
              return hit;
            });
      const response: FreeSearchResponse = {
        status: "ready",
        results: page,
        total: kept.length,
        offset,
        ...pagingFor(kept.length, offset, page.length),
        searchedEditions: searched,
        ...(repaired !== original ? { correctedQuery: repaired } : {}),
      };
      return response;
    },
  };
}
