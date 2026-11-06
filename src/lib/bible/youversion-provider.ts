import { BIBLE_BOOKS, findBook } from "./books";
import { getYouVersionChapter } from "./youversion.functions";
import type { YouVersionChapterRequest, YouVersionChapterResult } from "./youversion-protocol";
import { readerTranslations } from "./translations";
import {
  BibleServiceError,
  coversVerse,
  formatReference,
  type BibleProvider,
  type Chapter,
  type Verse,
  type VerseRef,
} from "./types";

/**
 * Licensed editions (NIV, AMP) served through the YouVersion Platform.
 *
 * Runs in the browser but only ever talks to Verse Snap's own server function; the API key and the
 * YouVersion API stay on the server. Nothing is cached here. React Query keeps a licensed chapter only
 * while a screen is showing it (query-policy.ts sets gcTime 0 and staleTime 0 for these editions), and
 * nothing is ever written to localStorage, IndexedDB or the service worker cache: see service.ts and
 * docs/audit/YOUVERSION_YV1.md.
 */

export type ChapterLoader = (request: YouVersionChapterRequest) => Promise<YouVersionChapterResult>;

const defaultLoader: ChapterLoader = (request) => getYouVersionChapter({ data: request });

export function createYouVersionProvider(load: ChapterLoader = defaultLoader): BibleProvider {
  /**
   * NO chapter memo: the caching permission for licensed text is unconfirmed, so nothing is kept after
   * a request finishes. Only requests for the same chapter that are in flight at the same moment share
   * one call, and the entry is removed the instant it settles (success or failure). That keeps a screen
   * that asks for several verses of one chapter at once to a single request, without retaining text.
   */
  const inFlight = new Map<string, Promise<Chapter | null>>();

  function fetchChapter(
    ref: Omit<VerseRef, "verse">,
    translation: string,
  ): Promise<Chapter | null> {
    const key = `${translation}/${ref.bookId}/${ref.chapter}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = loadChapter(ref, translation).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  async function loadChapter(
    ref: Omit<VerseRef, "verse">,
    translation: string,
  ): Promise<Chapter | null> {
    const book = findBook(ref.bookId);
    if (!book || !Number.isInteger(ref.chapter) || ref.chapter < 1 || ref.chapter > book.chapters)
      return null;

    let result: YouVersionChapterResult;
    try {
      result = await load({ translation, bookId: book.id, chapter: ref.chapter });
    } catch {
      throw new BibleServiceError("network", "Verse Snap couldn't reach the Bible right now.");
    }
    if (!result.ok) {
      if (result.kind === "reference") return null;
      throw new BibleServiceError(result.kind, result.message);
    }

    const verses = result.verses.map((item): Verse => {
      const verseRef: VerseRef = {
        bookId: book.id,
        bookName: book.name,
        chapter: ref.chapter,
        verse: item.verse,
      };
      return {
        ...verseRef,
        translation,
        text: item.text,
        reference: formatReference(verseRef),
        ...(item.through ? { through: item.through } : {}),
      };
    });
    return {
      translation,
      bookId: book.id,
      bookName: book.name,
      chapter: ref.chapter,
      reference: `${book.name} ${ref.chapter}`,
      verses,
    };
  }

  return {
    async listTranslations() {
      return readerTranslations();
    },
    getChapter: fetchChapter,
    async getVerse(ref, translation) {
      const chapter = await fetchChapter(ref, translation);
      return chapter?.verses.find((verse) => coversVerse(verse, ref.verse)) ?? null;
    },
    async getNeighbour(ref, direction, translation) {
      const chapter = await fetchChapter(ref, translation);
      if (!chapter) return null;
      const index = chapter.verses.findIndex((verse) => coversVerse(verse, ref.verse));
      if (index < 0) return null;
      const inside = chapter.verses[index + direction];
      if (inside) return inside;

      let bookIndex = BIBLE_BOOKS.findIndex((book) => book.id === ref.bookId);
      let number = ref.chapter + direction;
      const current = BIBLE_BOOKS[bookIndex];
      if (!current) return null;
      if (number < 1 || number > current.chapters) {
        bookIndex += direction;
        const next = BIBLE_BOOKS[bookIndex];
        if (!next) return null;
        number = direction === 1 ? 1 : next.chapters;
      }
      const target = BIBLE_BOOKS[bookIndex]!;
      const loaded = await fetchChapter(
        { bookId: target.id, bookName: target.name, chapter: number },
        translation,
      );
      return direction === 1 ? (loaded?.verses[0] ?? null) : (loaded?.verses.at(-1) ?? null);
    },
  };
}

export const youVersionProvider: BibleProvider = createYouVersionProvider();
