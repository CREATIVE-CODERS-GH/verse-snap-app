import { findBook } from "./books";
import { SAMPLE_KJV } from "./sample-data";
import { formatReference, type BibleProvider, type Translation, type Verse, type VerseRef } from "./types";

const TRANSLATIONS: Translation[] = [{ code: "KJV", name: "King James Version", language: "English" }];

function build(ref: VerseRef, translation: string, text: string): Verse {
  return { ...ref, translation, text, reference: formatReference(ref) };
}

/**
 * Reads from the bundled sample text. Used until the live provider is enabled.
 */
export const sampleProvider: BibleProvider = {
  async listTranslations() {
    return TRANSLATIONS;
  },

  async getVerse(ref, translation) {
    const book = findBook(ref.bookId);
    if (!book) return null;
    const chapter = SAMPLE_KJV[`${ref.bookId}.${ref.chapter}`];
    const text = chapter?.[ref.verse];
    if (!text) return null;
    return build({ ...ref, bookName: book.name }, translation, text);
  },

  async getNeighbour(ref, direction, translation) {
    const chapter = SAMPLE_KJV[`${ref.bookId}.${ref.chapter}`];
    if (!chapter) return null;
    const verses = Object.keys(chapter)
      .map(Number)
      .sort((a, b) => a - b);
    const index = verses.indexOf(ref.verse);
    if (index === -1) return null;
    const nextVerse = verses[index + direction];
    if (nextVerse === undefined) return null;
    return this.getVerse({ ...ref, verse: nextVerse }, translation);
  },
};
