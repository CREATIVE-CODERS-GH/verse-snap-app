import { parseReference } from "./parse-reference";
import { helloAoProvider } from "./helloao-provider";
import type { BibleProvider, Chapter, Translation, Verse, VerseRef } from "./types";

/**
 * The single place the UI talks to for scripture.
 * Change `provider` to switch Bible sources; screens stay untouched.
 */
const provider: BibleProvider = helloAoProvider;

export const DEFAULT_TRANSLATION = "KJAV";

export const bibleService = {
  parseReference,

  listTranslations(): Promise<Translation[]> {
    return provider.listTranslations();
  },

  getChapter(
    ref: Omit<VerseRef, "verse">,
    translation: string = DEFAULT_TRANSLATION,
  ): Promise<Chapter | null> {
    return provider.getChapter(ref, translation);
  },

  getVerse(ref: VerseRef, translation: string = DEFAULT_TRANSLATION): Promise<Verse | null> {
    return provider.getVerse(ref, translation);
  },

  getNeighbour(
    ref: VerseRef,
    direction: -1 | 1,
    translation: string = DEFAULT_TRANSLATION,
  ): Promise<Verse | null> {
    return provider.getNeighbour(ref, direction, translation);
  },
};

export type { Chapter, Translation, Verse, VerseRef };
