import { parseReference } from "./parse-reference";
import { sampleProvider } from "./sample-provider";
import type { BibleProvider, Translation, Verse, VerseRef } from "./types";

/**
 * The single place the UI talks to for scripture.
 * Change `provider` to switch Bible sources; screens stay untouched.
 */
const provider: BibleProvider = sampleProvider;

export const DEFAULT_TRANSLATION = "KJV";

export const bibleService = {
  parseReference,

  listTranslations(): Promise<Translation[]> {
    return provider.listTranslations();
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

export type { Translation, Verse, VerseRef };
