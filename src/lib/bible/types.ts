export interface VerseRef {
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
}

export interface Verse extends VerseRef {
  translation: string;
  text: string;
  /** Human readable reference, e.g. "John 3:16" */
  reference: string;
}

export interface Translation {
  code: string;
  name: string;
  language: string;
}

/**
 * Everything the UI is allowed to know about scripture data.
 * Swapping providers means writing a new BibleProvider, nothing else.
 */
export interface BibleProvider {
  listTranslations(): Promise<Translation[]>;
  getVerse(ref: VerseRef, translation: string): Promise<Verse | null>;
  /** Returns the neighbouring verse, or null at the edges of available data. */
  getNeighbour(ref: VerseRef, direction: -1 | 1, translation: string): Promise<Verse | null>;
}

export function formatReference(ref: VerseRef): string {
  return `${ref.bookName} ${ref.chapter}:${ref.verse}`;
}
