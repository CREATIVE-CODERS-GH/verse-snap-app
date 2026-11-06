import { parseReference } from "./parse-reference";
import { findReferences } from "./find-references";
import { BIBLE_BOOKS } from "./books";
import { chapterCache } from "./chapter-cache";
import { helloAoProvider } from "./helloao-provider";
import { youVersionProvider } from "./youversion-provider";
import { getYouVersionEdition, isRestrictedTranslation, readerTranslations } from "./translations";
import { getOfflineChapter } from "./offline-manager";
import {
  BibleServiceError,
  type BibleProvider,
  type Chapter,
  type Translation,
  type Verse,
  type VerseRef,
  coversVerse,
} from "./types";

/**
 * The single place the UI talks to for scripture.
 * Change `provider` to switch Bible sources; screens stay untouched.
 * Chapters are cached on the device so recently read verses survive a dropped
 * connection.
 */
const provider: BibleProvider = helloAoProvider;

/**
 * Licensed editions (YouVersion: NIV, AMP) are read live and never persisted: no offline download,
 * no on-device chapter cache, no search index. Everything else keeps using HelloAO unchanged.
 */
function licensedProvider(translation: string): BibleProvider | null {
  if (!isRestrictedTranslation(translation)) return null;
  if (!getYouVersionEdition(translation))
    throw new BibleServiceError("translation", "That translation is not available.");
  return youVersionProvider;
}

export const DEFAULT_TRANSLATION = "KJAV";

function isOffline(error: unknown): boolean {
  return error instanceof BibleServiceError && error.kind === "network";
}

async function loadChapter(
  ref: Omit<VerseRef, "verse">,
  translation: string,
): Promise<Chapter | null> {
  const licensed = licensedProvider(translation);
  if (licensed) return licensed.getChapter(ref, translation);
  // A translation downloaded for offline reading is read from the device, without the network.
  const downloaded = await getOfflineChapter(translation, ref.bookId, ref.chapter);
  if (downloaded) return downloaded;
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

/** The verse before or after one, from a downloaded translation (crossing chapters and books). */
async function offlineNeighbour(
  chapter: Chapter,
  ref: VerseRef,
  direction: -1 | 1,
  translation: string,
): Promise<Verse | null> {
  const index = chapter.verses.findIndex((verse) => verse.verse === ref.verse);
  if (index < 0) return null;
  const inside = chapter.verses[index + direction];
  if (inside) return inside;
  let bookIndex = BIBLE_BOOKS.findIndex((book) => book.id === ref.bookId);
  let number = ref.chapter + direction;
  const book = BIBLE_BOOKS[bookIndex];
  if (!book) return null;
  if (number < 1 || number > book.chapters) {
    bookIndex += direction;
    const next = BIBLE_BOOKS[bookIndex];
    if (!next) return null;
    number = direction === 1 ? 1 : next.chapters;
  }
  const target = BIBLE_BOOKS[bookIndex]!;
  const loaded = await getOfflineChapter(translation, target.id, number);
  return direction === 1 ? (loaded?.verses[0] ?? null) : (loaded?.verses.at(-1) ?? null);
}

export const bibleService = {
  parseReference,
  findReferences,

  listTranslations(): Promise<Translation[]> {
    return Promise.resolve(readerTranslations());
  },

  getChapter(
    ref: Omit<VerseRef, "verse">,
    translation: string = DEFAULT_TRANSLATION,
  ): Promise<Chapter | null> {
    return loadChapter(ref, translation);
  },

  async getVerse(ref: VerseRef, translation: string = DEFAULT_TRANSLATION): Promise<Verse | null> {
    const chapter = await loadChapter(ref, translation);
    return chapter?.verses.find((verse) => coversVerse(verse, ref.verse)) ?? null;
  },

  async getNeighbour(
    ref: VerseRef,
    direction: -1 | 1,
    translation: string = DEFAULT_TRANSLATION,
  ): Promise<Verse | null> {
    const licensed = licensedProvider(translation);
    if (licensed) return licensed.getNeighbour(ref, direction, translation);
    const local = await getOfflineChapter(translation, ref.bookId, ref.chapter);
    if (local) return offlineNeighbour(local, ref, direction, translation);
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
