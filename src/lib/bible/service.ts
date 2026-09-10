import { parseReference } from "./parse-reference";
import { findReferences } from "./find-references";
import { chapterCache } from "./chapter-cache";
import { helloAoProvider } from "./helloao-provider";
import {
  BibleServiceError,
  type BibleProvider,
  type Chapter,
  type Translation,
  type Verse,
  type VerseRef,
} from "./types";

/**
 * The single place the UI talks to for scripture.
 * Change `provider` to switch Bible sources; screens stay untouched.
 * Chapters are cached on the device so recently read verses survive a dropped
 * connection.
 */
const provider: BibleProvider = helloAoProvider;

export const DEFAULT_TRANSLATION = "KJAV";

function isOffline(error: unknown): boolean {
  return error instanceof BibleServiceError && error.kind === "network";
}

async function loadChapter(
  ref: Omit<VerseRef, "verse">,
  translation: string,
): Promise<Chapter | null> {
  try {
    const chapter = await provider.getChapter(ref, translation);
    if (chapter) chapterCache.put(translation, chapter);
    return chapter;
  } catch (error) {
    if (isOffline(error)) {
      const cached = chapterCache.get(translation, ref.bookId, ref.chapter);
      if (cached) return cached;
    }
    throw error;
  }
}

export const bibleService = {
  parseReference,
  findReferences,

  listTranslations(): Promise<Translation[]> {
    return provider.listTranslations();
  },

  getChapter(
    ref: Omit<VerseRef, "verse">,
    translation: string = DEFAULT_TRANSLATION,
  ): Promise<Chapter | null> {
    return loadChapter(ref, translation);
  },

  async getVerse(ref: VerseRef, translation: string = DEFAULT_TRANSLATION): Promise<Verse | null> {
    const chapter = await loadChapter(ref, translation);
    return chapter?.verses.find((verse) => verse.verse === ref.verse) ?? null;
  },

  async getNeighbour(
    ref: VerseRef,
    direction: -1 | 1,
    translation: string = DEFAULT_TRANSLATION,
  ): Promise<Verse | null> {
    try {
      return await provider.getNeighbour(ref, direction, translation);
    } catch (error) {
      if (!isOffline(error)) throw error;
      const cached = chapterCache.get(translation, ref.bookId, ref.chapter);
      const index = cached?.verses.findIndex((verse) => verse.verse === ref.verse) ?? -1;
      return index >= 0 ? (cached?.verses[index + direction] ?? null) : null;
    }
  },
};

export type { Chapter, Translation, Verse, VerseRef };
