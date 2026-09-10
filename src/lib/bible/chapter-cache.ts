import type { Chapter } from "./types";

const STORAGE_KEY = "versesnap.bible.chapters.v1";
const MAX_ENTRIES = 24;

interface CacheEntry {
  key: string;
  at: number;
  chapter: Chapter;
}

function read(): CacheEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as CacheEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: CacheEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage full or unavailable — caching is best effort */
  }
}

function cacheKey(translation: string, bookId: string, chapter: number): string {
  return `${translation}/${bookId}/${chapter}`;
}

/**
 * A small on-device store of recently read chapters so a verse that was opened
 * before can still be shown when the connection drops. Only scripture text is
 * kept, capped to the most recent chapters.
 */
export const chapterCache = {
  get(translation: string, bookId: string, chapter: number): Chapter | null {
    const key = cacheKey(translation, bookId, chapter);
    return read().find((entry) => entry.key === key)?.chapter ?? null;
  },

  put(translation: string, chapter: Chapter): void {
    const key = cacheKey(translation, chapter.bookId, chapter.chapter);
    const next = [
      { key, at: Date.now(), chapter },
      ...read().filter((entry) => entry.key !== key),
    ].slice(0, MAX_ENTRIES);
    write(next);
  },
};
