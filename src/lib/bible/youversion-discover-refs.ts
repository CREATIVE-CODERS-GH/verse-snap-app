import { fromApiBookId } from "./books";

/**
 * A YouVersion passage id ("JHN.3.16", "PHP.4.6-7") as Verse Snap's own book, chapter and verse. Search
 * results arrive as these ids only; the text is fetched separately and only when it is shown.
 */
export interface DiscoverPassage {
  /** The id exactly as YouVersion sent it, used to fetch the text. */
  id: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
  /** Last verse of a range, when the passage is more than one verse. */
  endVerse?: number;
  /** "Philippians 4:6–7" */
  label: string;
}

const PASSAGE_ID = /^([1-3A-Z]{2}[A-Z0-9])\.(\d{1,3})\.(\d{1,3})(?:-(\d{1,3}))?$/;

/** The shape the browser may ask for, checked again on the server before it reaches YouVersion. */
export function isPassageId(value: string): boolean {
  return PASSAGE_ID.test(value);
}

/**
 * Parses one passage id, or returns null for anything Verse Snap cannot open (an unknown book, a
 * chapter-only id, a range that runs backwards). Such results are dropped rather than guessed at.
 */
export function parsePassageId(id: string): DiscoverPassage | null {
  const match = PASSAGE_ID.exec(id);
  if (!match) return null;
  const book = fromApiBookId(match[1] as string);
  if (!book) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  const endVerse = match[4] === undefined ? undefined : Number(match[4]);
  if (chapter < 1 || chapter > book.chapters || verse < 1) return null;
  if (endVerse !== undefined && endVerse <= verse) return null;
  const range = endVerse === undefined ? `${verse}` : `${verse}–${endVerse}`;
  return {
    id,
    bookId: book.id,
    bookName: book.name,
    chapter,
    verse,
    ...(endVerse === undefined ? {} : { endVerse }),
    label: `${book.name} ${chapter}:${range}`,
  };
}
