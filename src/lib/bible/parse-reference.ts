import { BIBLE_BOOKS, type BibleBook } from "./books";
export interface ParsedReference {
  bookId: string;
  bookName: string;
  chapter: number;
  verse?: number;
}

const ORDINAL_BOOK_NUMBERS: Record<string, string> = {
  first: "1",
  second: "2",
  third: "3",
  i: "1",
  ii: "2",
  iii: "3",
};

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[.,'"]/g, " ")
    .replace(/\bpsalms\b/g, "psalm")
    .replace(/\brevelations\b/g, "revelation")
    .replace(/\bsong of songs\b/g, "song of solomon")
    .replace(/\s+/g, " ")
    .trim();
}

function matchBook(raw: string): BibleBook | undefined {
  const key = raw.replace(/\s+/g, "");
  const exact = BIBLE_BOOKS.find(
    (book) => book.id === key || book.name.toLowerCase().replace(/\s+/g, "") === key,
  );
  if (exact) return exact;

  const byAlias = BIBLE_BOOKS.filter((book) => book.aliases.includes(key));
  if (byAlias.length === 1) return byAlias[0];

  // Prefix match, e.g. "philipp" -> Philippians. Only when unambiguous.
  if (key.length >= 3) {
    const prefixed = BIBLE_BOOKS.filter((book) =>
      book.name.toLowerCase().replace(/\s+/g, "").startsWith(key),
    );
    if (prefixed.length === 1) return prefixed[0];
  }
  return undefined;
}

function parseSpokenNumber(words: string[]): number | null {
  if (words.length === 0) return null;
  if (words.length === 1 && /^\d{1,3}$/.test(words[0] ?? "")) {
    return Number(words[0]);
  }

  const filtered = words.filter((word) => word !== "and");
  if (filtered.length === 0) return null;

  let value = 0;
  let usedHundred = false;
  for (const word of filtered) {
    const small = SMALL_NUMBERS[word];
    if (small !== undefined) {
      value += small;
      continue;
    }
    const tens = TENS[word];
    if (tens !== undefined) {
      value += tens;
      continue;
    }
    if (word === "hundred" && !usedHundred && value > 0 && value < 10) {
      value *= 100;
      usedHundred = true;
      continue;
    }
    return null;
  }

  return value > 0 && value <= 999 ? value : null;
}

function findBookAtStart(words: string[]): { book: BibleBook; rest: string[] } | null {
  for (let length = Math.min(4, words.length - 1); length >= 1; length -= 1) {
    const raw = words.slice(0, length).join(" ");
    const book = matchBook(raw);
    if (book) return { book, rest: words.slice(length) };
  }
  return null;
}

function makeReference(
  book: BibleBook,
  chapter: number | null,
  verse?: number | null,
): ParsedReference | null {
  if (chapter === null || chapter < 1 || chapter > book.chapters) return null;
  if (verse === null || (verse !== undefined && (verse < 1 || verse > 176))) return null;
  return verse === undefined
    ? { bookId: book.id, bookName: book.name, chapter }
    : { bookId: book.id, bookName: book.name, chapter, verse };
}

function parseNumberPortion(book: BibleBook, words: string[]): ParsedReference | null {
  const chapterMarker = words.indexOf("chapter");
  const verseMarker = words.findIndex((word) => word === "verse" || word === "verses");

  if (chapterMarker >= 0 || verseMarker >= 0) {
    const chapterStart = chapterMarker >= 0 ? chapterMarker + 1 : 0;
    const chapterEnd = verseMarker >= 0 ? verseMarker : words.length;
    const chapter = parseSpokenNumber(words.slice(chapterStart, chapterEnd));
    const verse = verseMarker >= 0 ? parseSpokenNumber(words.slice(verseMarker + 1)) : undefined;
    return makeReference(book, chapter, verse);
  }

  const isSingleCompoundNumber = words.length === 1
    || (words.length === 2 && TENS[words[0] ?? ""] !== undefined && SMALL_NUMBERS[words[1] ?? ""] !== undefined)
    || words.includes("hundred");
  if (isSingleCompoundNumber) {
    const whole = parseSpokenNumber(words);
    if (whole !== null && whole <= book.chapters) return makeReference(book, whole);
  }

  // Prefer the longest valid chapter phrase so "Psalm twenty three one"
  // becomes Psalm 23:1 rather than Psalm 20:4.
  for (let split = words.length - 1; split >= 1; split -= 1) {
    const chapter = parseSpokenNumber(words.slice(0, split));
    const verse = parseSpokenNumber(words.slice(split));
    const reference = makeReference(book, chapter, verse);
    if (reference) return reference;
  }

  const whole = parseSpokenNumber(words);
  if (whole !== null && whole <= book.chapters) return makeReference(book, whole);

  return null;
}

/**
 * Parses a spoken or typed Bible reference.
 * Handles: "John 3:16", "john 3 16", "Jn 3v16", "1 Corinthians 13:4",
 * "John chapter 3 verse 16", "psalm 23".
 */
export function parseReference(input: string): ParsedReference | null {
  if (!input) return null;

  let text = normalise(input).replace(/(\d)\s*[v:]\s*(\d)/g, "$1 verse $2");

  // Leading ordinal words: "first john 1 9" -> "1 john 1 9"
  const words = text.split(" ");
  const firstWord = words[0];
  if (firstWord && ORDINAL_BOOK_NUMBERS[firstWord]) {
    words[0] = ORDINAL_BOOK_NUMBERS[firstWord] as string;
    text = words.join(" ");
  }

  const matched = findBookAtStart(text.split(" "));
  if (!matched) return null;
  return parseNumberPortion(matched.book, matched.rest);
}
