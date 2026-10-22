import type { Chapter } from "./types";

/*
 * On-device storage for downloaded translations (IndexedDB). Only scripture text is kept: no
 * account data ever goes here. A translation counts as downloaded only once its "downloads" record
 * exists, and that record is written last, after every chapter has been stored and checked.
 */

export interface DownloadRecord {
  translation: string;
  chapters: number;
  verses: number;
  /** Approximate size of the stored text, in bytes. */
  bytes: number;
  /** ISO time the download finished. */
  at: string;
  /** Bumped if the stored format changes, so old downloads can be refreshed. */
  version: number;
}

export const OFFLINE_FORMAT_VERSION = 1;

export interface OfflineStorage {
  getChapter(translation: string, bookId: string, chapter: number): Promise<Chapter | null>;
  /** Stores a batch of chapters (replacing any with the same key). */
  putChapters(translation: string, chapters: readonly Chapter[]): Promise<void>;
  countChapters(translation: string): Promise<number>;
  getDownload(translation: string): Promise<DownloadRecord | null>;
  listDownloads(): Promise<DownloadRecord[]>;
  /** Marks the translation as downloaded. Call only after the chapters were stored and checked. */
  markComplete(record: DownloadRecord): Promise<void>;
  /** Removes the translation: its record first (so it stops counting as downloaded), then its text. */
  removeTranslation(translation: string): Promise<void>;
}

const DB_NAME = "versesnap-offline";
const DB_VERSION = 1;
const CHAPTERS = "chapters";
const DOWNLOADS = "downloads";

const chapterKey = (translation: string, bookId: string, chapter: number) =>
  `${translation}/${bookId}/${chapter}`;

export function indexedDbSupported(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(CHAPTERS)) {
          const store = db.createObjectStore(CHAPTERS, { keyPath: "key" });
          store.createIndex("translation", "translation", { unique: false });
        }
        if (!db.objectStoreNames.contains(DOWNLOADS)) {
          db.createObjectStore(DOWNLOADS, { keyPath: "translation" });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("Could not open offline storage"));
      open.onblocked = () => reject(new Error("Offline storage is blocked"));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** The real store, in the browser's IndexedDB. */
export const indexedDbStorage: OfflineStorage = {
  async getChapter(translation, bookId, chapter) {
    const db = await openDb();
    const row = await request<{ chapter: Chapter } | undefined>(
      db
        .transaction(CHAPTERS, "readonly")
        .objectStore(CHAPTERS)
        .get(chapterKey(translation, bookId, chapter)),
    );
    return row?.chapter ?? null;
  },

  async putChapters(translation, chapters) {
    if (chapters.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(CHAPTERS, "readwrite");
    const store = tx.objectStore(CHAPTERS);
    for (const chapter of chapters) {
      store.put({
        key: chapterKey(translation, chapter.bookId, chapter.chapter),
        translation,
        chapter,
      });
    }
    await transactionDone(tx);
  },

  async countChapters(translation) {
    const db = await openDb();
    return request(
      db
        .transaction(CHAPTERS, "readonly")
        .objectStore(CHAPTERS)
        .index("translation")
        .count(IDBKeyRange.only(translation)),
    );
  },

  async getDownload(translation) {
    const db = await openDb();
    const row = await request<DownloadRecord | undefined>(
      db.transaction(DOWNLOADS, "readonly").objectStore(DOWNLOADS).get(translation),
    );
    return row ?? null;
  },

  async listDownloads() {
    const db = await openDb();
    return request<DownloadRecord[]>(
      db.transaction(DOWNLOADS, "readonly").objectStore(DOWNLOADS).getAll(),
    );
  },

  async markComplete(record) {
    const db = await openDb();
    const tx = db.transaction(DOWNLOADS, "readwrite");
    tx.objectStore(DOWNLOADS).put(record);
    await transactionDone(tx);
  },

  async removeTranslation(translation) {
    const db = await openDb();
    // The record goes first: from this moment the translation is no longer "downloaded".
    const first = db.transaction(DOWNLOADS, "readwrite");
    first.objectStore(DOWNLOADS).delete(translation);
    await transactionDone(first);
    const second = db.transaction(CHAPTERS, "readwrite");
    const index = second.objectStore(CHAPTERS).index("translation");
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openKeyCursor(IDBKeyRange.only(translation));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return resolve();
        second.objectStore(CHAPTERS).delete(current.primaryKey);
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error ?? new Error("Could not remove the download"));
    });
    await transactionDone(second);
  },
};

/** A store in memory, for tests. */
export function createMemoryStorage(): OfflineStorage & {
  chapters: Map<string, Chapter>;
  downloads: Map<string, DownloadRecord>;
} {
  const chapters = new Map<string, Chapter>();
  const downloads = new Map<string, DownloadRecord>();
  return {
    chapters,
    downloads,
    async getChapter(translation, bookId, chapter) {
      return chapters.get(chapterKey(translation, bookId, chapter)) ?? null;
    },
    async putChapters(translation, batch) {
      for (const chapter of batch) {
        chapters.set(chapterKey(translation, chapter.bookId, chapter.chapter), chapter);
      }
    },
    async countChapters(translation) {
      return [...chapters.keys()].filter((key) => key.startsWith(`${translation}/`)).length;
    },
    async getDownload(translation) {
      return downloads.get(translation) ?? null;
    },
    async listDownloads() {
      return [...downloads.values()];
    },
    async markComplete(record) {
      downloads.set(record.translation, record);
    },
    async removeTranslation(translation) {
      downloads.delete(translation);
      for (const key of [...chapters.keys()]) {
        if (key.startsWith(`${translation}/`)) chapters.delete(key);
      }
    },
  };
}
