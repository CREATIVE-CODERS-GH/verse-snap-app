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
  /** Set when one passage of text spans several verses (a bridged "3-4"): the last verse it covers. */
  through?: number;
}

/** True when this verse's text is the one for verse number `n` (exactly, or inside a bridged range). */
export function coversVerse(verse: Pick<Verse, "verse" | "through">, n: number): boolean {
  return (
    verse.verse === n || (verse.through !== undefined && n > verse.verse && n <= verse.through)
  );
}

export interface Chapter {
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  reference: string;
  verses: Verse[];
}

/** The publisher notice a licensed edition must show wherever its text is displayed. */
export interface TranslationAttribution {
  notice: string;
  linkLabel: string;
  linkUrl: string;
}

export interface Translation {
  code: string;
  name: string;
  language: string;
  /** Present only on licensed (YouVersion) editions. */
  attribution?: TranslationAttribution;
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
