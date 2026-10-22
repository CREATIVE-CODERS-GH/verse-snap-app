import { groupOfBook } from "./book-groups";
import { BIBLE_BOOKS, findBook, fromApiBookId, toApiBookId } from "./books";

/*
 * Scripture cross-references from HelloAO's "open-cross-ref" dataset: the OpenBible.info
 * cross-references (mostly the Treasury of Scripture Knowledge, ranked by community votes),
 * licensed CC BY 4.0. The dataset holds only references, one JSON file per chapter; passage text
 * always comes from the Bible service in the reader's translation.
 */

export const CROSS_REF_BASE_URL = "https://bible.helloao.org/api/d/open-cross-ref";

/** Credit shown wherever the data is used (CC BY 4.0 needs the source, licence and any changes). */
export const CROSS_REF_ATTRIBUTION = {
  source: "OpenBible.info",
  sourceUrl: "https://www.openbible.info/labs/cross-references/",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  basedOn: "the Treasury of Scripture Knowledge",
  changes:
    "Reformatted by HelloAO and ranked by community votes; shortened for display in Verse Snap.",
} as const;

/** How many related passages each surface shows (the dataset has dozens for popular verses). */
export const EXPLORER_LIMIT = 25;
export const SHEET_LIMIT = 10;
export const CHIP_LIMIT = 6;

const REQUEST_TIMEOUT_MS = 10_000;

export interface CrossPassage {
  /** Our book id, for example "ephesians". */
  book: string;
  bookName: string;
  chapter: number;
  /** First and last verse (the same for a single verse). */
  from: number;
  to: number;
  /** The dataset's community-vote score; higher is a stronger connection. */
  score: number;
}

export interface CrossGroup {
  id: "ot" | "nt";
  title: string;
  icon: "ot" | "nt";
  passages: CrossPassage[];
}

export type CrossReferenceErrorKind = "network" | "data";

export class CrossReferenceError extends Error {
  readonly kind: CrossReferenceErrorKind;
  constructor(kind: CrossReferenceErrorKind, message: string) {
    super(message);
    this.name = "CrossReferenceError";
    this.kind = kind;
  }
}

const BOOK_ORDER = new Map(BIBLE_BOOKS.map((book, index) => [book.id, index]));
const bookOrder = (bookId: string): number => BOOK_ORDER.get(bookId) ?? 999;

const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/**
 * Reads one chapter file: verse number to its related passages, best first. Anything that cannot be
 * mapped to a real chapter in our books (unknown book, impossible chapter or verse, no positive
 * score) is dropped; ranges are kept as written; the same passage listed twice keeps its best
 * score; a verse is never listed as related to itself.
 */
export function parseChapterCrossRefs(
  json: unknown,
  anchorBookId: string,
  anchorChapter: number,
): Map<number, CrossPassage[]> {
  const content = (json as { chapter?: { content?: unknown } } | null)?.chapter?.content;
  if (!Array.isArray(content)) {
    throw new CrossReferenceError("data", "Unexpected cross-reference data");
  }
  const result = new Map<number, CrossPassage[]>();
  for (const entry of content as { verse?: unknown; references?: unknown }[]) {
    if (!isInt(entry?.verse) || entry.verse < 1 || !Array.isArray(entry.references)) continue;
    const anchorVerse = entry.verse;
    const best = new Map<string, CrossPassage>();
    for (const raw of entry.references as Record<string, unknown>[]) {
      const book = typeof raw["book"] === "string" ? fromApiBookId(raw["book"]) : undefined;
      const chapter = raw["chapter"];
      const verse = raw["verse"];
      const score = raw["score"];
      if (!book || !isInt(chapter) || !isInt(verse) || typeof score !== "number") continue;
      if (!(score > 0) || chapter < 1 || chapter > book.chapters || verse < 1) continue;
      const end = raw["endVerse"];
      const to = isInt(end) && end > verse ? end : verse;
      if (
        book.id === anchorBookId &&
        chapter === anchorChapter &&
        anchorVerse >= verse &&
        anchorVerse <= to
      ) {
        continue;
      }
      const key = `${book.id}:${chapter}:${verse}-${to}`;
      const known = best.get(key);
      if (!known || score > known.score) {
        best.set(key, { book: book.id, bookName: book.name, chapter, from: verse, to, score });
      }
    }
    const ranked = [...best.values()].sort(
      (a, b) =>
        b.score - a.score ||
        bookOrder(a.book) - bookOrder(b.book) ||
        a.chapter - b.chapter ||
        a.from - b.from,
    );
    result.set(anchorVerse, ranked);
  }
  return result;
}

/** Loads and parses one chapter's cross-references. A chapter with no file has none. */
export async function fetchChapterCrossRefs(
  bookId: string,
  chapter: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, CrossPassage[]>> {
  const apiBook = toApiBookId(bookId);
  const book = findBook(bookId);
  if (!apiBook || !book || !isInt(chapter) || chapter < 1 || chapter > book.chapters) {
    return new Map();
  }
  let response: Response;
  try {
    response = await fetchImpl(`${CROSS_REF_BASE_URL}/${apiBook}/${chapter}.json`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CrossReferenceError("network", "Couldn’t reach the cross-reference service");
  }
  if (response.status === 404) return new Map();
  if (!response.ok) {
    throw new CrossReferenceError("network", `Cross-reference service answered ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new CrossReferenceError("data", "Unexpected cross-reference data");
  }
  return parseChapterCrossRefs(json, bookId, chapter);
}

/** The best `limit` passages, and how many there are in all. */
export function rankPassages(
  passages: readonly CrossPassage[],
  limit: number,
): { items: CrossPassage[]; total: number } {
  return { items: passages.slice(0, Math.max(0, limit)), total: passages.length };
}

/** Old Testament and New Testament groups (empty ones left out); order within a group is the rank. */
export function groupByTestament(passages: readonly CrossPassage[]): CrossGroup[] {
  const groups: CrossGroup[] = [
    { id: "nt", title: "New Testament", icon: "nt", passages: [] },
    { id: "ot", title: "Old Testament", icon: "ot", passages: [] },
  ];
  for (const passage of passages) {
    const testament = groupOfBook(passage.book)?.testament;
    groups.find((group) => group.id === testament)?.passages.push(passage);
  }
  // The testament with the strongest top match comes first.
  const filled = groups.filter((group) => group.passages.length > 0);
  return filled.sort((a, b) => (b.passages[0]?.score ?? 0) - (a.passages[0]?.score ?? 0));
}

export function passageLabel(
  passage: Pick<CrossPassage, "bookName" | "chapter" | "from" | "to">,
): string {
  return `${passage.bookName} ${passage.chapter}:${passage.from}${passage.to !== passage.from ? `–${passage.to}` : ""}`;
}

/**
 * A passage as it exists in one edition. The dataset's verse numbers can run past the end of a
 * chapter (a range that overshoots, or an edition that ends the chapter sooner): the end verse is
 * clamped to the chapter's last verse, and a passage that starts after it is not available.
 * `lastVerse` is unknown until the chapter has loaded, and then the passage is kept as it is.
 */
export function fitPassage(
  passage: CrossPassage,
  lastVerse: number | undefined,
): { available: boolean; passage: CrossPassage } {
  if (lastVerse === undefined) return { available: true, passage };
  if (passage.from > lastVerse) return { available: false, passage };
  if (passage.to <= lastVerse) return { available: true, passage };
  return { available: true, passage: { ...passage, to: lastVerse } };
}

export function testamentOf(bookId: string): "OT" | "NT" | undefined {
  const testament = groupOfBook(bookId)?.testament;
  return testament === "ot" ? "OT" : testament === "nt" ? "NT" : undefined;
}

/** A chip in the chapter verse sheet's cross-reference row. */
export interface CrossRefChip {
  label: string;
  /** "OT" or "NT". */
  hint: string;
  dot: "primary" | "secondary" | "tertiary";
  target: { book: string; chapter: number; verse: number };
}

export function toChips(passages: readonly CrossPassage[], limit = CHIP_LIMIT): CrossRefChip[] {
  return passages.slice(0, limit).map((passage) => ({
    label: passageLabel(passage),
    hint: testamentOf(passage.book) ?? "",
    dot: testamentOf(passage.book) === "OT" ? "secondary" : "primary",
    target: { book: passage.book, chapter: passage.chapter, verse: passage.from },
  }));
}
