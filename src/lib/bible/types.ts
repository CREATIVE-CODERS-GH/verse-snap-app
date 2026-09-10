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

export interface Chapter {
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  reference: string;
  verses: Verse[];
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
  getChapter(ref: Omit<VerseRef, "verse">, translation: string): Promise<Chapter | null>;
  getVerse(ref: VerseRef, translation: string): Promise<Verse | null>;
  /** Returns the neighbouring verse, or null at the edges of available data. */
  getNeighbour(ref: VerseRef, direction: -1 | 1, translation: string): Promise<Verse | null>;
}

export class BibleServiceError extends Error {
  constructor(
    public readonly kind: "network" | "translation" | "reference" | "provider",
    message: string,
  ) {
    super(message);
    this.name = "BibleServiceError";
  }
}

export function formatReference(ref: VerseRef): string {
  return `${ref.bookName} ${ref.chapter}:${ref.verse}`;
}
