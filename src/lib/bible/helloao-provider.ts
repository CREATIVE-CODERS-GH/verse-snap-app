import { BIBLE_BOOKS, findBook, fromApiBookId, toApiBookId } from "./books";
import {
  BibleServiceError,
  formatReference,
  type BibleProvider,
  type Chapter,
  type Verse,
  type VerseRef,
} from "./types";
import { BIBLE_TRANSLATIONS, resolveTranslation } from "./translations";

const BASE_URL = "https://bible.helloao.org/api";

interface ApiBook {
  id: string;
  name?: string;
  commonName?: string;
  order?: number;
  numberOfChapters?: number;
}

interface ApiChapter {
  translation?: { id?: string; name?: string; shortName?: string; languageName?: string };
  book?: ApiBook;
  chapter?: { number?: number; content?: unknown[] };
}

const booksPromises = new Map<string, Promise<ApiBook[]>>();

function readableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readableText).join("");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  if (typeof item["text"] === "string") return item["text"];
  if (Array.isArray(item["content"])) return readableText(item["content"]);
  return "";
}

const REQUEST_TIMEOUT_MS = 12_000;

/** In-flight requests are shared so the same passage is never fetched twice at once. */
const inFlight = new Map<string, Promise<unknown | null>>();

async function fetchJson(url: string): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new BibleServiceError("network", "Verse Snap couldn't reach the Bible right now.");
  }
  if (response.status === 404) return null;
  if (!response.ok)
    throw new BibleServiceError("provider", "Verse Snap couldn't retrieve that passage.");
  try {
    return await response.json();
  } catch {
    throw new BibleServiceError("provider", "Verse Snap received an unreadable response.");
  }
}

function requestJson(url: string): Promise<unknown | null> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const pending = fetchJson(url).finally(() => inFlight.delete(url));
  inFlight.set(url, pending);
  return pending;
}

async function getBooks(translation: string): Promise<ApiBook[]> {
  const apiId = resolveTranslation(translation).apiId;
  const existing = booksPromises.get(apiId);
  if (existing) return existing;
  const pending = requestJson(`${BASE_URL}/${apiId}/books.json`).then((data) => {
    const books =
      data && typeof data === "object" ? (data as { books?: unknown }).books : undefined;
    if (!Array.isArray(books))
      throw new BibleServiceError("provider", "The Bible book list is unavailable.");
    return books.filter((book): book is ApiBook =>
      Boolean(book && typeof book === "object" && "id" in book),
    );
  }).catch((error: unknown) => {
    booksPromises.delete(apiId);
    throw error;
  });
  booksPromises.set(apiId, pending);
  return pending;
}

async function fetchChapter(
  ref: Omit<VerseRef, "verse">,
  translation: string,
): Promise<Chapter | null> {
  const edition = resolveTranslation(translation);
  const apiTranslation = edition.apiId;
  const apiBookId = toApiBookId(ref.bookId);
  const localBook = findBook(ref.bookId);
  if (!apiBookId || !localBook || !Number.isInteger(ref.chapter) || ref.chapter < 1) return null;

  const data = await requestJson(`${BASE_URL}/${apiTranslation}/${apiBookId}/${ref.chapter}.json`);
  if (!data || typeof data !== "object") return null;
  const response = data as ApiChapter;
  const content = response.chapter?.content;
  if (!Array.isArray(content))
    throw new BibleServiceError("provider", "The chapter text is unavailable.");

  const verses = content.flatMap((block): Verse[] => {
    if (!block || typeof block !== "object") return [];
    const item = block as { type?: unknown; number?: unknown; content?: unknown };
    if (item.type !== "verse" || typeof item.number !== "number") return [];
    const verseRef: VerseRef = { ...ref, bookName: localBook.name, verse: item.number };
    const text = readableText(item.content).replace(/\s+/g, " ").trim();
    return text
      ? [{ ...verseRef, translation: edition.code, text, reference: formatReference(verseRef) }]
      : [];
  });

  return {
    translation: edition.code,
    bookId: localBook.id,
    bookName: localBook.name,
    chapter: ref.chapter,
    reference: `${localBook.name} ${ref.chapter}`,
    verses,
  };
}

export const helloAoProvider: BibleProvider = {
  async listTranslations() {
    return BIBLE_TRANSLATIONS.map(({ code, name, language }) => ({ code, name, language }));
  },
  async getChapter(ref, translation) {
    return fetchChapter(ref, translation);
  },
  async getVerse(ref, translation) {
    const chapter = await fetchChapter(ref, translation);
    return chapter?.verses.find((verse) => verse.verse === ref.verse) ?? null;
  },
  async getNeighbour(ref, direction, translation) {
    const chapter = await fetchChapter(ref, translation);
    if (!chapter) return null;
    const index = chapter.verses.findIndex((verse) => verse.verse === ref.verse);
    if (index < 0) return null;
    const neighbour = chapter.verses[index + direction];
    if (neighbour) return neighbour;

    const books = await getBooks(translation);
    const apiBookId = toApiBookId(ref.bookId);
    const apiBookIndex = books.findIndex((book) => book.id.toUpperCase() === apiBookId);
    const apiBook = books[apiBookIndex];
    if (!apiBook) return null;

    let targetBook = apiBook;
    let targetChapter = ref.chapter + direction;
    const chapterCount = apiBook.numberOfChapters ?? findBook(ref.bookId)?.chapters ?? 0;
    if (targetChapter < 1 || targetChapter > chapterCount) {
      targetBook = books[apiBookIndex + direction] as ApiBook;
      if (!targetBook) return null;
      targetChapter = direction === 1 ? 1 : (targetBook.numberOfChapters ?? 1);
    }
    const localTarget =
      fromApiBookId(targetBook.id) ?? BIBLE_BOOKS[targetBook.order ? targetBook.order - 1 : -1];
    if (!localTarget) return null;
    const target = await fetchChapter(
      { bookId: localTarget.id, bookName: localTarget.name, chapter: targetChapter },
      translation,
    );
    return direction === 1 ? (target?.verses[0] ?? null) : (target?.verses.at(-1) ?? null);
  },
};
