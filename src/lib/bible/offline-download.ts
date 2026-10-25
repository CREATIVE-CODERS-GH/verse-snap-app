import { BIBLE_BOOKS, fromApiBookId } from "./books";
import { chapterFromApiContent } from "./helloao-provider";
import { OFFLINE_FORMAT_VERSION, type DownloadRecord, type OfflineStorage } from "./offline-store";
import { resolveTranslation } from "./translations";
import type { Chapter } from "./types";

/*
 * Downloads a whole translation from HelloAO (one file per translation) into the on-device store.
 * Only editions whose rights allow it are offered; the rest stay online-only.
 */

/** Editions that can be downloaded for offline reading. BSB, KJAV, BBE and FBV wait for their rights. */
export const OFFLINE_DOWNLOADABLE: readonly string[] = ["WEB", "ASV"];

export function canDownloadOffline(code: string): boolean {
  return OFFLINE_DOWNLOADABLE.includes(code);
}

const BASE_URL = "https://bible.helloao.org/api";
const BATCH = 40;
/** Used only to draw progress when the server does not say how big the file is. */
const ESTIMATED_BYTES = 7_000_000;
/** Every complete English edition here has about 31,100 verses; far fewer means a broken file. */
const MIN_VERSES = 30_000;

export const EXPECTED_CHAPTERS = BIBLE_BOOKS.reduce((sum, book) => sum + book.chapters, 0);

export type DownloadPhase = "downloading" | "saving" | "verifying";

export interface DownloadProgress {
  phase: DownloadPhase;
  /** Overall progress from 0 to 1. */
  fraction: number;
}

export type OfflineDownloadErrorKind =
  "unsupported" | "network" | "data" | "storage" | "verify" | "cancelled";

export class OfflineDownloadError extends Error {
  readonly kind: OfflineDownloadErrorKind;
  constructor(kind: OfflineDownloadErrorKind, message: string) {
    super(message);
    this.name = "OfflineDownloadError";
    this.kind = kind;
  }
}

export interface DownloadOptions {
  storage: OfflineStorage;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

function throwIfCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new OfflineDownloadError("cancelled", "Download cancelled");
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function readBody(
  response: Response,
  signal: AbortSignal | undefined,
  report: (fraction: number) => void,
): Promise<string> {
  const total = Number(response.headers.get("content-length")) || ESTIMATED_BYTES;
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    report(1);
    return text;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    throwIfCancelled(signal);
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    report(Math.min(received / total, 0.99));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  report(1);
  return new TextDecoder().decode(bytes);
}

/** Every chapter of the file in the app's shape; anything that is not a real chapter is rejected. */
function convert(json: unknown, code: string): Chapter[] {
  const books = (json as { books?: unknown } | null)?.books;
  if (!Array.isArray(books)) throw new OfflineDownloadError("data", "Unexpected Bible file");
  const chapters: Chapter[] = [];
  for (const rawBook of books as { id?: unknown; chapters?: unknown }[]) {
    const book = typeof rawBook?.id === "string" ? fromApiBookId(rawBook.id) : undefined;
    if (!book || !Array.isArray(rawBook.chapters)) continue;
    for (const entry of rawBook.chapters as {
      chapter?: { number?: unknown; content?: unknown };
    }[]) {
      const number = entry?.chapter?.number;
      const content = entry?.chapter?.content;
      if (typeof number !== "number" || !Array.isArray(content)) continue;
      const chapter = chapterFromApiContent(
        { bookId: book.id, bookName: book.name, chapter: number },
        content,
        code,
      );
      if (chapter && chapter.verses.length > 0) chapters.push(chapter);
    }
  }
  return chapters;
}

/** Throws unless every chapter of every book is present with text. */
function checkComplete(chapters: readonly Chapter[]): number {
  const seen = new Set<string>();
  let verses = 0;
  for (const chapter of chapters) {
    seen.add(`${chapter.bookId}/${chapter.chapter}`);
    verses += chapter.verses.length;
  }
  for (const book of BIBLE_BOOKS) {
    for (let number = 1; number <= book.chapters; number++) {
      if (!seen.has(`${book.id}/${number}`)) {
        throw new OfflineDownloadError("verify", `Missing ${book.name} ${number}`);
      }
    }
  }
  if (seen.size !== EXPECTED_CHAPTERS || verses < MIN_VERSES) {
    throw new OfflineDownloadError("verify", "The Bible file is incomplete");
  }
  return verses;
}

/**
 * Downloads, stores and verifies one translation. The "downloaded" record is written last; if
 * anything fails or is cancelled, whatever was stored is removed and nothing is marked downloaded.
 */
export async function downloadTranslation(
  code: string,
  { storage, fetchImpl = fetch, onProgress, signal }: DownloadOptions,
): Promise<DownloadRecord> {
  if (!canDownloadOffline(code)) {
    throw new OfflineDownloadError("unsupported", "This translation can’t be downloaded");
  }
  const existing = await storage.getDownload(code);
  if (existing && existing.version === OFFLINE_FORMAT_VERSION) return existing;

  const report = (phase: DownloadPhase, fraction: number) => onProgress?.({ phase, fraction });
  let storedAny = false;
  try {
    throwIfCancelled(signal);
    report("downloading", 0);
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}/${resolveTranslation(code).apiId}/complete.json`, {
        ...(signal ? { signal } : {}),
      });
    } catch {
      throwIfCancelled(signal);
      throw new OfflineDownloadError("network", "Couldn’t reach the Bible service");
    }
    if (!response.ok) {
      throw new OfflineDownloadError("network", `The Bible service answered ${response.status}`);
    }
    let text: string;
    try {
      text = await readBody(response, signal, (f) => report("downloading", f * 0.6));
    } catch (error) {
      if (error instanceof OfflineDownloadError) throw error;
      throw new OfflineDownloadError("network", "The download was interrupted");
    }
    let chapters: Chapter[];
    try {
      chapters = convert(JSON.parse(text), code);
    } catch (error) {
      if (error instanceof OfflineDownloadError) throw error;
      throw new OfflineDownloadError("data", "Unexpected Bible file");
    }
    // Check the file itself before keeping a single chapter of it.
    const verses = checkComplete(chapters);

    let bytes = 0;
    for (let start = 0; start < chapters.length; start += BATCH) {
      throwIfCancelled(signal);
      const batch = chapters.slice(start, start + BATCH);
      for (const chapter of batch) bytes += JSON.stringify(chapter).length;
      try {
        storedAny = true;
        await storage.putChapters(code, batch);
      } catch {
        throw new OfflineDownloadError("storage", "Not enough space to store this Bible");
      }
      report("saving", 0.6 + 0.35 * Math.min((start + batch.length) / chapters.length, 1));
      await yieldToUi();
    }

    throwIfCancelled(signal);
    report("verifying", 0.95);
    if ((await storage.countChapters(code)) !== EXPECTED_CHAPTERS) {
      throw new OfflineDownloadError("verify", "Some chapters were not stored");
    }
    // Read one chapter of every book back, to be sure what was stored can be read.
    for (const book of BIBLE_BOOKS) {
      const back = await storage.getChapter(code, book.id, 1);
      if (!back || back.verses.length === 0) {
        throw new OfflineDownloadError("verify", `Could not read ${book.name} back`);
      }
    }
    const record: DownloadRecord = {
      translation: code,
      chapters: EXPECTED_CHAPTERS,
      verses,
      bytes,
      at: new Date().toISOString(),
      version: OFFLINE_FORMAT_VERSION,
    };
    await storage.markComplete(record);
    report("verifying", 1);
    return record;
  } catch (error) {
    if (storedAny) await storage.removeTranslation(code).catch(() => {});
    if (error instanceof OfflineDownloadError) throw error;
    throw new OfflineDownloadError("storage", "The download could not be saved");
  }
}
