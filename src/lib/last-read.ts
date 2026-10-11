export interface LastRead {
  translation: string;
  bookId: string;
  chapter: number;
}

const STORAGE_KEY = "versesnap.last-read.v1";

const DEFAULT_LAST_READ: LastRead = { translation: "KJAV", bookId: "john", chapter: 1 };

export function getLastRead(): LastRead {
  if (typeof window === "undefined") return DEFAULT_LAST_READ;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAST_READ;
    const parsed = JSON.parse(raw) as Partial<LastRead>;
    if (
      typeof parsed.translation === "string" &&
      typeof parsed.bookId === "string" &&
      typeof parsed.chapter === "number" &&
      Number.isInteger(parsed.chapter) &&
      parsed.chapter > 0
    ) {
      return { translation: parsed.translation, bookId: parsed.bookId, chapter: parsed.chapter };
    }
    return DEFAULT_LAST_READ;
  } catch {
    return DEFAULT_LAST_READ;
  }
}

export function setLastRead(location: LastRead): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch {
    /* ignore unwritable storage */
  }
}
