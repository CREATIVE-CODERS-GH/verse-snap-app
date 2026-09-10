import { BIBLE_BOOKS, type BibleBook } from "./books";
import type { VerseRef } from "./types";

const NUMBER_WORDS: Record<string, string> = {
  first: "1",
  second: "2",
  third: "3",
  one: "1",
  two: "2",
  three: "3",
  i: "1",
  ii: "2",
  iii: "3",
};

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchBook(raw: string): BibleBook | undefined {
  const key = raw.replace(/\s+/g, "");
  const exact = BIBLE_BOOKS.find(
    (book) => book.id === key || book.name.toLowerCase().replace(/\s+/g, "") === key,
  );
  if (exact) return exact;

  const byAlias = BIBLE_BOOKS.find((book) => book.aliases.includes(key));
  if (byAlias) return byAlias;

  // Prefix match, e.g. "philipp" -> Philippians. Only when unambiguous.
  if (key.length >= 3) {
    const prefixed = BIBLE_BOOKS.filter((book) =>
      book.name.toLowerCase().replace(/\s+/g, "").startsWith(key),
    );
    if (prefixed.length === 1) return prefixed[0];
  }
  return undefined;
}

/**
 * Parses a spoken or typed Bible reference.
 * Handles: "John 3:16", "john 3 16", "Jn 3v16", "1 Corinthians 13:4",
 * "John chapter 3 verse 16", "psalm 23".
 */
export function parseReference(input: string): VerseRef | null {
  if (!input) return null;

  let text = normalise(input)
    .replace(/\bchapter\b/g, " ")
    .replace(/\bverses?\b/g, " ")
    .replace(/(\d)\s*[v:.-]\s*(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  // Leading ordinal words: "first john 1 9" -> "1 john 1 9"
  const words = text.split(" ");
  const firstWord = words[0];
  if (firstWord && NUMBER_WORDS[firstWord]) {
    words[0] = NUMBER_WORDS[firstWord] as string;
    text = words.join(" ");
  }

  const match = text.match(/^([0-9]?\s?[a-z][a-z\s]*?)\s+(\d{1,3})(?:\s+(\d{1,3}))?$/);
  if (!match || !match[1] || !match[2]) return null;

  const book = matchBook(match[1].trim());
  if (!book) return null;


  const chapter = Number(match[2]);
  const verse = match[3] ? Number(match[3]) : 1;
  if (chapter < 1 || chapter > book.chapters) return null;
  if (verse < 1 || verse > 176) return null;

  return { bookId: book.id, bookName: book.name, chapter, verse };
}
