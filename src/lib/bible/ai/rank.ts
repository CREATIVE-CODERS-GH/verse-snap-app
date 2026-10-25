import { parseReference } from "../parse-reference";
import { bibleService } from "../service";
import type { Verse, VerseRef } from "../types";
import { MAX_CANDIDATES, MAX_RESULTS } from "./prompt";
import type { ReferenceCandidate, ScriptureSearchResult } from "./types";

// Verification and ranking of AI-proposed references. The model only proposes
// references; every verse returned is fetched from the configured Bible source
// and dropped if it does not resolve. Logic moved unchanged from search.functions.ts.

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "that",
  "to",
  "in",
  "is",
  "it",
  "for",
  "verse",
  "bible",
  "about",
  "says",
  "say",
  "where",
  "what",
  "which",
  "does",
  "god",
]);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return true;
}

/** Exact wording wins, then overlapping words, then the order suggested upstream. */
export function score(query: string, verse: Verse, order: number): number {
  const text = normalise(verse.text);
  const cleaned = normalise(query);
  // The upstream ordering carries the meaning of the query, so it leads;
  // wording overlap only nudges close calls.
  let value = Math.max(0, MAX_CANDIDATES - order) * 10;
  if (cleaned && text.includes(cleaned)) value += 1000;

  const words = cleaned.split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  if (words.length > 0) {
    const textWords = text.split(" ").map(stem);
    const hits = words.filter((word) => {
      const queryWord = stem(word);
      return textWords.some(
        (textWord) =>
          textWord === queryWord || (queryWord.length >= 5 && withinOneEdit(queryWord, textWord)),
      );
    }).length;
    value += Math.round((hits / words.length) * 40);
    if (hits === words.length) value += 20;
  }
  return value;
}

type GetVerse = (ref: VerseRef, translation: string) => Promise<Verse | null>;

/** Resolves proposed references against the Bible source and returns them ranked. */
export async function resolveAndRank(
  query: string,
  translation: string,
  candidates: readonly ReferenceCandidate[],
  getVerse: GetVerse = (ref, edition) => bibleService.getVerse(ref, edition),
): Promise<ScriptureSearchResult[]> {
  const seen = new Set<string>();
  const verses: Array<{ verse: Verse; order: number }> = [];

  await Promise.all(
    candidates.slice(0, MAX_CANDIDATES).map(async (candidate, order) => {
      const reference = parseReference(`${candidate.book} ${candidate.chapter}:${candidate.verse}`);
      if (!reference || reference.verse === undefined) return;
      const key = `${reference.bookId}-${reference.chapter}-${reference.verse}`;
      if (seen.has(key)) return;
      seen.add(key);
      try {
        // Scripture text always comes from the Bible source, never the model.
        const verse = await getVerse(
          {
            bookId: reference.bookId,
            bookName: reference.bookName,
            chapter: reference.chapter,
            verse: reference.verse,
          },
          translation,
        );
        if (verse) verses.push({ verse, order });
      } catch {
        /* an unreachable verse is simply left out of the results */
      }
    }),
  );

  return verses
    .sort((a, b) => score(query, b.verse, b.order) - score(query, a.verse, a.order))
    .slice(0, MAX_RESULTS)
    .map(({ verse }) => ({
      translation: verse.translation,
      bookId: verse.bookId,
      bookName: verse.bookName,
      chapter: verse.chapter,
      verse: verse.verse,
      reference: verse.reference,
      text: verse.text,
    }));
}
