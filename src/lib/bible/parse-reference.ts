import { BIBLE_BOOKS, type BibleBook } from "./books";
export interface ParsedReference {
  bookId: string;
  bookName: string;
  chapter: number;
  verse?: number;
  /**
   * End of a range. With `endChapter` unset it is the last verse of `chapter` ("John 3:16-18");
   * with `endChapter` set the range ends at that chapter ("John 3:16-4:2" sets endChapter 4 and
   * endVerse 2; "Psalm chapters 23-25" sets endChapter 25 and no endVerse).
   */
  endVerse?: number;
  endChapter?: number;
  /** A supported edition named in the query ("john 3:16 bsb"), as a catalogue code such as "BSB". */
  translation?: string;
  /** An edition named in the query that Verse Snap does not offer ("niv", "esv", ...). */
  unsupportedTranslation?: string;
  /** The query was only a book name; the reference points at chapter 1. */
  bookOnly?: boolean;
  /** The book name was recognised despite a misspelling. */
  corrected?: boolean;
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
    .replace(/([a-z])(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[a-z])/g, "$1 ")
    .replace(/(\d)\s*[:;.-]\s*(\d)/g, "$1 verse $2")
    .replace(/[-–—;,]/g, " ")
    .replace(/[.'"]/g, " ")
    .replace(/\bpsalms\b/g, "psalm")
    .replace(/\brevelations\b/g, "revelation")
    .replace(/\bsong of songs\b/g, "song of solomon")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
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

  // OCR commonly substitutes a single character in a book name (e.g. Psa1m).
  // Only accept a unique close match, so natural-language input is not guessed.
  if (key.length >= 4 && !/\d$/.test(key)) {
    const close = BIBLE_BOOKS.filter((book) => {
      const names = [book.id, book.name.toLowerCase().replace(/\s+/g, ""), ...book.aliases];
      return names.some((name) => name.length >= 4 && editDistance(key, name) <= 1);
    });
    if (close.length === 1) return close[0];
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

  if (words.length === 2 && /^\d{1,3}$/.test(words[0] ?? "") && /^\d{1,3}$/.test(words[1] ?? "")) {
    return makeReference(book, Number(words[0]), Number(words[1]));
  }

  const isSingleCompoundNumber =
    words.length === 1 ||
    (words.length === 2 &&
      TENS[words[0] ?? ""] !== undefined &&
      SMALL_NUMBERS[words[1] ?? ""] !== undefined) ||
    words.includes("hundred");
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
 * The original parser. Its behaviour is frozen: everything it accepted keeps parsing to exactly the
 * same result (see the golden-file test). New forms are handled by parseExtended below, which only
 * runs when this returns null.
 */
function parseBasic(input: string): ParsedReference | null {
  if (!input) return null;

  let text = normalise(input).replace(/(\d)\s+v\s*(\d)/g, "$1 verse $2");

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

// =============================================================================================
// Extended grammar (hybrid search, Phase A)
//
// Handles forms the original parser rejects: verse and chapter ranges, single-chapter books
// ("3 John 4"), bare book names, edition suffixes ("John 3:16 BSB"), wrappers ("the book of ...",
// "Gospel of John", "St. John"), alternate separators, and common misspellings.
//
// Safety rules:
//  - It runs only when the original parser returned null, so nothing that used to parse changes
//    (one deliberate exception: an explicit "chapters 23-25" range, which the original misread
//    as a verse).
//  - It is deterministic and conservative: ordinary phrases that merely start with a book name
//    ("mark my words", "john the baptist", "acts of kindness", "job loss") never parse, because a
//    reference needs numbers and a bare book name must be the whole query.
// =============================================================================================

/** Common misspellings of the book part (without a leading number), mapped to the correct base name. */
const MISSPELLED_BASES: Record<string, string> = {
  phillipians: "philippians",
  philipians: "philippians",
  phillippians: "philippians",
  philippeans: "philippians",
  filipians: "philippians",
  phillipans: "philippians",
  ephesions: "ephesians",
  ephessians: "ephesians",
  ephesans: "ephesians",
  ephisians: "ephesians",
  galations: "galatians",
  galatains: "galatians",
  gallatians: "galatians",
  collosians: "colossians",
  colosians: "colossians",
  colossions: "colossians",
  collossians: "colossians",
  thesalonians: "thessalonians",
  thessalonains: "thessalonians",
  thessolonians: "thessalonians",
  thesolonians: "thessalonians",
  thessalonnians: "thessalonians",
  corintians: "corinthians",
  corinthinas: "corinthians",
  corinthans: "corinthians",
  corrinthians: "corinthians",
  corithians: "corinthians",
  corinthain: "corinthians",
  revalation: "revelation",
  reveleation: "revelation",
  revelaton: "revelation",
  deutronomy: "deuteronomy",
  deuteronmy: "deuteronomy",
  duteronomy: "deuteronomy",
  levitcus: "leviticus",
  leviticuss: "leviticus",
  levicitus: "leviticus",
  ecclesiates: "ecclesiastes",
  eclesiastes: "ecclesiastes",
  ecclesiasties: "ecclesiastes",
  ecclesistes: "ecclesiastes",
  isaih: "isaiah",
  isiah: "isaiah",
  isaia: "isaiah",
  jermiah: "jeremiah",
  jeramiah: "jeremiah",
  jeremia: "jeremiah",
  ezekial: "ezekiel",
  ezekeil: "ezekiel",
  ezeikel: "ezekiel",
  ezkiel: "ezekiel",
  habbakuk: "habakkuk",
  habakuk: "habakkuk",
  habbakkuk: "habakkuk",
  zephania: "zephaniah",
  zepheniah: "zephaniah",
  zachariah: "zechariah",
  zecharia: "zechariah",
  malachai: "malachi",
  malichi: "malachi",
  obediah: "obadiah",
  obadia: "obadiah",
  nehemia: "nehemiah",
  nehamiah: "nehemiah",
  hebrew: "hebrews",
  hebrwes: "hebrews",
  mathew: "matthew",
  mathews: "matthew",
  matthews: "matthew",
  philemen: "philemon",
  phillemon: "philemon",
  timoty: "timothy",
  timonthy: "timothy",
  timothey: "timothy",
  chronicals: "chronicles",
  cronicles: "chronicles",
  chronicle: "chronicles",
  lamentation: "lamentations",
  lamentaions: "lamentations",
  genisis: "genesis",
  genesys: "genesis",
  exodous: "exodus",
  exodas: "exodus",
  proverb: "proverbs",
  psalam: "psalm",
  psam: "psalm",
  pslam: "psalm",
  jeames: "james",
};

/** Books whose ids carry a leading number (1 Samuel, 2 Kings, 3 John, ...). */
const NUMBERED_BASES = new Set([
  "samuel",
  "kings",
  "chronicles",
  "corinthians",
  "thessalonians",
  "timothy",
  "peter",
  "john",
]);

function matchMisspelling(key: string): BibleBook | undefined {
  const numbered = /^([123])(.+)$/.exec(key);
  const prefix = numbered?.[1] ?? "";
  const base = numbered?.[2] ?? key;
  const fixed = MISSPELLED_BASES[base] ?? base;
  if (fixed === base && MISSPELLED_BASES[base] === undefined) return undefined;
  const id = NUMBERED_BASES.has(fixed) ? `${prefix}${fixed}` : fixed === "psalm" ? "psalms" : fixed;
  if (NUMBERED_BASES.has(fixed) && !prefix) return undefined; // "corinthians" alone is ambiguous
  if (!NUMBERED_BASES.has(fixed) && prefix) return undefined;
  return BIBLE_BOOKS.find((book) => book.id === id);
}

/**
 * Book lookup for the extended grammar.
 *  - "reference" mode (numbers follow): the original matcher, then known misspellings, then a bounded
 *    fuzzy match (edit distance 2, long names only, the single clear winner).
 *  - "bare" mode (the whole query is the book): only full names, ids, aliases of 3+ letters and known
 *    misspellings. No prefix or fuzzy guessing, so ordinary words are not mistaken for books.
 */
function matchBookExtended(
  raw: string,
  mode: "reference" | "bare",
): { book: BibleBook; corrected: boolean } | undefined {
  const key = raw.replace(/\s+/g, "");
  if (!key) return undefined;
  if (mode === "reference") {
    const direct = matchBook(raw);
    if (direct) return { book: direct, corrected: false };
  } else {
    const exact = BIBLE_BOOKS.find(
      (book) => book.id === key || book.name.toLowerCase().replace(/\s+/g, "") === key,
    );
    if (exact) return { book: exact, corrected: false };
    const aliased = BIBLE_BOOKS.filter((book) => key.length >= 3 && book.aliases.includes(key));
    if (aliased.length === 1 && aliased[0]) return { book: aliased[0], corrected: false };
  }
  const misspelt = matchMisspelling(key);
  if (misspelt) return { book: misspelt, corrected: true };

  if (mode === "reference" && key.length >= 8) {
    const scored = BIBLE_BOOKS.map((book) => {
      const names = [book.id, book.name.toLowerCase().replace(/\s+/g, "")].filter(
        (name) => name.length >= 8,
      );
      return { book, distance: Math.min(...names.map((name) => editDistance(key, name)), 99) };
    }).sort((a, b) => a.distance - b.distance);
    const best = scored[0];
    const next = scored[1];
    if (best && best.distance <= 2 && (!next || next.distance >= best.distance + 2)) {
      return { book: best.book, corrected: true };
    }
  }
  return undefined;
}

// ---- editions ------------------------------------------------------------------------------

const SUPPORTED_EDITION_NAMES: Array<[string, string]> = [
  ["king james version", "KJAV"],
  ["authorized version", "KJAV"],
  ["king james", "KJAV"],
  ["kjav", "KJAV"],
  ["kjv", "KJAV"],
  ["berean standard bible", "BSB"],
  ["berean standard", "BSB"],
  ["berean", "BSB"],
  ["bsb", "BSB"],
  ["world english bible", "WEB"],
  ["world english", "WEB"],
  ["web", "WEB"],
  ["american standard version", "ASV"],
  ["american standard", "ASV"],
  ["asv", "ASV"],
  ["bible in basic english", "BBE"],
  ["basic english", "BBE"],
  ["bbe", "BBE"],
  ["free bible version", "FBV"],
  ["fbv", "FBV"],
];

/** Well-known editions Verse Snap does not offer. Recognised so they are not mistaken for scripture words. */
const UNSUPPORTED_EDITION_NAMES = [
  "new international version",
  "english standard version",
  "new living translation",
  "new king james version",
  "the message",
  "amplified",
  "niv",
  "esv",
  "nlt",
  "nkjv",
  "nasb",
  "nasv",
  "csb",
  "hcsb",
  "msg",
  "amp",
  "ceb",
  "gnt",
  "cev",
  "nrsv",
  "rsv",
  "nrsvue",
  "ncv",
  "tlb",
  "isv",
  "lsb",
  "mev",
  "nirv",
  "tniv",
  "nab",
  "njb",
  "reb",
  "gnb",
  "tev",
];

const EDITION_PATTERNS: Array<{ regex: RegExp; code: string | null; name: string }> = [
  ...SUPPORTED_EDITION_NAMES.map(([name, code]) => ({ name, code })),
  ...UNSUPPORTED_EDITION_NAMES.map((name) => ({ name, code: null })),
]
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name, code }) => ({
    name,
    code,
    // "<reference> [,|(|-] [in|from [the]] [(]NAME[)]" at the very end, with a real boundary before NAME.
    regex: new RegExp(
      `^(.+?)[\\s,(\\[\\-]*(?:(?:in|from|using)\\s+(?:the\\s+)?)?(?<=[\\s,(\\[\\-\\d])[(\\[]?\\s*${name.replace(/ /g, "\\s+")}\\s*[)\\]]?\\s*$`,
    ),
  }));

function splitEdition(
  text: string,
): { core: string; translation?: string; unsupported?: string } | null {
  for (const pattern of EDITION_PATTERNS) {
    const match = pattern.regex.exec(text);
    const core = match?.[1]?.trim();
    if (!core || !/[a-z]/.test(core)) continue;
    return pattern.code
      ? { core, translation: pattern.code }
      : { core, unsupported: pattern.name.toUpperCase() };
  }
  return null;
}

// ---- wrappers, numbers and ranges ----------------------------------------------------------

const ORDINAL_WORDS: Record<string, string> = {
  first: "1",
  "1st": "1",
  i: "1",
  second: "2",
  "2nd": "2",
  ii: "2",
  third: "3",
  "3rd": "3",
  iii: "3",
};

/** Removes "the book of", "gospel according to", "St.", ... and rewrites long book titles. */
function stripWrappers(input: string): string {
  let t = input
    .replace(/[‐-―]/g, "-")
    .replace(/[“”‘’"]/g, " ")
    .replace(/(?<=[a-z])\.(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(
    /^(first|second|third|1st|2nd|3rd)\s+book\s+of\s+/,
    (_all, ordinal: string) => `${ORDINAL_WORDS[ordinal] ?? ordinal} `,
  );
  for (let pass = 0; pass < 2; pass += 1) {
    t = t
      .replace(
        /^(?:the\s+)?(?:gospel\s+(?:according\s+to|of)|books?\s+of|epistles?\s+of|letters?\s+of)\s+/,
        "",
      )
      .replace(/^(?:the\s+)?(?:saint|st)\s+/, "")
      .replace(/^the\s+(?=[a-z0-9])/, "");
  }
  return t
    .replace(/\bacts of the apostles\b/g, "acts")
    .replace(/\brevelation of (?:saint |st )?john(?: the divine)?\b/g, "revelation")
    .replace(/\brevelation of jesus christ\b/g, "revelation")
    .replace(/\blamentations of jeremiah\b/g, "lamentations")
    .replace(/\bsong of songs\b/g, "song of solomon")
    .replace(/\bpsalms\b/g, "psalm")
    .replace(/\brevelations\b/g, "revelation")
    .replace(/^(\d)(st|nd|rd)\b/, "$1");
}

interface TailShape {
  value: string;
  chapterWord: boolean;
  rangeWord: boolean;
}

/** Reduces the part after the book name to digits separated by ':' ' ' and '-'. */
function normaliseTail(tail: string): TailShape {
  const chapterWord = /\b(?:chapters?|chs?)\b/.test(tail);
  const rangeWord = /\b(?:to|through|thru|until|till)\b/.test(tail);
  const value = tail
    .replace(/\b(?:chapters?|chs?)\b/g, " ")
    .replace(/\b(?:verses?|vv?|vs|ver)\b/g, "v")
    .replace(/\s*\b(?:to|through|thru|until|till)\b\s*/g, "-")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/(\d)\s*v\s*(?=\d)/g, "$1:")
    .replace(/\bv\s*(?=\d)/g, " ")
    .replace(/(\d)\s*[.,;]\s*(?=\d)/g, "$1:")
    .replace(/\s*:\s*/g, ":")
    .replace(/(\d)\s*[a-c]\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return { value, chapterWord, rangeWord };
}

function build(
  book: BibleBook,
  chapter: number,
  verse?: number,
  endChapter?: number,
  endVerse?: number,
): ParsedReference | null {
  if (chapter < 1 || chapter > book.chapters) return null;
  if (verse !== undefined && (verse < 1 || verse > 176)) return null;
  if (endVerse !== undefined && (endVerse < 1 || endVerse > 176)) return null;
  if (endChapter !== undefined) {
    if (endChapter < chapter || endChapter > book.chapters) return null;
    if (endChapter === chapter) {
      if (verse === undefined || endVerse === undefined || endVerse <= verse) return null;
      return { bookId: book.id, bookName: book.name, chapter, verse, endVerse };
    }
    if (verse === undefined && endVerse !== undefined) return null;
  } else if (endVerse !== undefined && (verse === undefined || endVerse <= verse)) {
    return null;
  }
  return {
    bookId: book.id,
    bookName: book.name,
    chapter,
    ...(verse !== undefined ? { verse } : {}),
    ...(endChapter !== undefined ? { endChapter } : {}),
    ...(endVerse !== undefined ? { endVerse } : {}),
  };
}

function parseTail(book: BibleBook, shape: TailShape): ParsedReference | null {
  const v = shape.value;
  const n = (text: string | undefined) => Number(text);
  const single = book.chapters === 1;

  let m = /^(\d{1,3})$/.exec(v);
  if (m) return single && n(m[1]) > 1 ? build(book, 1, n(m[1])) : build(book, n(m[1]));

  m = /^(\d{1,3}):(\d{1,3})$/.exec(v);
  if (m) return build(book, n(m[1]), n(m[2]));

  m = /^(\d{1,3}):(\d{1,3})-(\d{1,3})$/.exec(v);
  if (m) return build(book, n(m[1]), n(m[2]), undefined, n(m[3]));

  m = /^(\d{1,3}):(\d{1,3})-(\d{1,3}):(\d{1,3})$/.exec(v);
  if (m) return build(book, n(m[1]), n(m[2]), n(m[3]), n(m[4]));

  m = /^(\d{1,3})-(\d{1,3})$/.exec(v);
  if (m) {
    if (single) return build(book, 1, n(m[1]), undefined, n(m[2]));
    if (shape.chapterWord || shape.rangeWord) return build(book, n(m[1]), undefined, n(m[2]));
    return null; // "John 3-16" is a verse separator and belongs to the original parser
  }

  m = /^(\d{1,3}) (\d{1,3})$/.exec(v);
  if (m) {
    if (single)
      return n(m[1]) === 1 ? build(book, 1, n(m[2])) : build(book, 1, n(m[1]), undefined, n(m[2]));
    return build(book, n(m[1]), n(m[2]));
  }

  m = /^(\d{1,3}) (\d{1,3})-(\d{1,3})$/.exec(v);
  if (m) return build(book, n(m[1]), n(m[2]), undefined, n(m[3]));

  m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(v);
  if (m) return build(book, n(m[1]), n(m[2]), undefined, n(m[3]));

  return null;
}

function parseExtended(text: string, mode: "reference" | "book"): ParsedReference | null {
  const t = stripWrappers(text)
    .replace(/([a-z])(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[a-z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  const words = t.split(" ");
  const first = words[0];
  if (first && ORDINAL_WORDS[first] && words.length > 1) words[0] = ORDINAL_WORDS[first] as string;

  const hasDigits = words.some((word) => /\d/.test(word));
  if (hasDigits) {
    for (let length = Math.min(4, words.length - 1); length >= 1; length -= 1) {
      const raw = words.slice(0, length).join(" ");
      const tail = words.slice(length).join(" ");
      if (!/\d/.test(tail)) continue;
      const matched = matchBookExtended(raw, "reference");
      if (!matched) continue;
      const reference = parseTail(matched.book, normaliseTail(tail));
      if (reference) return matched.corrected ? { ...reference, corrected: true } : reference;
    }
    // Numbers were present but no reference fits. A numbered book name ("1 John") may still be the whole query.
    if (mode !== "book") return null;
  }

  if (mode === "book" && words.length <= 4) {
    // The whole query must be the book name: nothing else may follow.
    const raw = words.join(" ");
    const matched = matchBookExtended(raw, "bare");
    if (matched) {
      return {
        bookId: matched.book.id,
        bookName: matched.book.name,
        chapter: 1,
        bookOnly: true,
        ...(matched.corrected ? { corrected: true } : {}),
      };
    }
  }
  return null;
}

function parseCore(text: string, mode: "reference" | "book"): ParsedReference | null {
  // "Psalm chapters 23-25" would be misread by the original parser as a verse.
  const explicitChapterRange = /\bchapters?\s*\d+\s*(?:-|–|—|to|through|thru)\s*\d+/.test(text);
  if (!explicitChapterRange) {
    const basic = parseBasic(text);
    if (basic) return basic;
  }
  return parseExtended(text, mode);
}

function parseWithEdition(input: string, mode: "reference" | "book"): ParsedReference | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  if (!lower || lower.length > 100) return null;

  const split = splitEdition(lower);
  if (split) {
    const reference = parseCore(split.core, mode);
    if (reference) {
      return {
        ...reference,
        ...(split.translation ? { translation: split.translation } : {}),
        ...(split.unsupported ? { unsupportedTranslation: split.unsupported } : {}),
      };
    }
  }
  return parseCore(lower, mode);
}

/**
 * Parses a spoken or typed Bible reference.
 * Handles: "John 3:16", "john 3 16", "Jn 3v16", "1 Corinthians 13:4", "John chapter 3 verse 16",
 * "psalm 23", ranges ("Psalm 23:1-6", "John 3:16-4:2", "Psalm 23 to 25"), single-chapter books
 * ("3 John 4"), edition suffixes ("John 3:16 BSB"), wrappers ("the book of ...", "St. John"),
 * and common misspellings ("Phillipians 4:13").
 * A bare book name is NOT a reference here; see parseReferenceOrBook.
 */
export function parseReference(input: string): ParsedReference | null {
  return parseWithEdition(input, "reference");
}

/**
 * Like parseReference, and additionally accepts a query that is only a book name ("Ruth",
 * "the book of John"), returned as chapter 1 with bookOnly set. The book name must be the
 * whole query, so "mark my words" or "job loss" are never read as books.
 */
export function parseReferenceOrBook(input: string): ParsedReference | null {
  return parseWithEdition(input, "book");
}
