import {
  canDownloadOffline,
  downloadTranslation,
  OfflineDownloadError,
  type DownloadPhase,
} from "./offline-download";
import {
  indexedDbStorage,
  indexedDbSupported,
  OFFLINE_FORMAT_VERSION,
  type DownloadRecord,
  type OfflineStorage,
} from "./offline-store";
import type { Chapter } from "./types";

/*
 * What the app knows about downloaded translations, shared by the translation popup and the Reader.
 * A download keeps running when the popup is closed; the state lives here, not in a component.
 */

export type OfflineStatus = "idle" | "downloading" | "downloaded" | "failed";

export interface OfflineEntry {
  status: OfflineStatus;
  /** 0 to 1 while downloading. */
  fraction: number;
  phase?: DownloadPhase;
  record?: DownloadRecord;
  /** A short reason when the last attempt failed. */
  error?: string;
}

export interface OfflineSnapshot {
  /** The list of downloads has been read from the device. */
  ready: boolean;
  supported: boolean;
  entries: Readonly<Record<string, OfflineEntry>>;
}

const IDLE: OfflineEntry = { status: "idle", fraction: 0 };

let storage: OfflineStorage = indexedDbStorage;
let snapshot: OfflineSnapshot = { ready: false, supported: true, entries: {} };
let readyPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();

function publish(next: OfflineSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function setEntry(code: string, entry: OfflineEntry) {
  publish({ ...snapshot, entries: { ...snapshot.entries, [code]: entry } });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): OfflineSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: OfflineSnapshot = { ready: false, supported: true, entries: {} };
export function getServerSnapshot(): OfflineSnapshot {
  return SERVER_SNAPSHOT;
}

export function entryOf(code: string, from: OfflineSnapshot = snapshot): OfflineEntry {
  return from.entries[code] ?? IDLE;
}

/** Codes of the translations that are downloaded and can be read without the network. */
export function downloadedCodes(from: OfflineSnapshot = snapshot): string[] {
  return Object.keys(from.entries).filter((code) => from.entries[code]?.status === "downloaded");
}

/** Reads which translations are downloaded (once). Safe to call from anywhere, any number of times. */
export function ensureOfflineReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (storage === indexedDbStorage && !indexedDbSupported()) {
        publish({ ready: true, supported: false, entries: {} });
        return;
      }
      try {
        const records = await storage.listDownloads();
        const entries: Record<string, OfflineEntry> = {};
        for (const record of records) {
          if (record.version === OFFLINE_FORMAT_VERSION && canDownloadOffline(record.translation)) {
            entries[record.translation] = { status: "downloaded", fraction: 1, record };
          }
        }
        publish({ ready: true, supported: true, entries });
      } catch {
        publish({ ready: true, supported: false, entries: {} });
      }
    })();
  }
  return readyPromise;
}

const MESSAGES: Record<string, string> = {
  network: "Download failed. Check your connection and try again.",
  data: "Download failed. The Bible file was not valid.",
  verify: "Download failed. It could not be verified.",
  storage: "Not enough space to store this Bible.",
};

export async function startDownload(code: string): Promise<void> {
  if (!canDownloadOffline(code)) return;
  if (!snapshot.ready) await ensureOfflineReady();
  const current = entryOf(code);
  if (current.status === "downloading" || current.status === "downloaded") return;
  if (!snapshot.supported) {
    setEntry(code, {
      status: "failed",
      fraction: 0,
      error: "Offline storage isn’t available here.",
    });
    return;
  }
  const controller = new AbortController();
  controllers.set(code, controller);
  setEntry(code, { status: "downloading", fraction: 0, phase: "downloading" });
  // Ask the browser not to clear this data when space is tight (best effort).
  void navigator.storage?.persist?.().catch(() => {});
  let lastShown = -1;
  try {
    const record = await downloadTranslation(code, {
      storage,
      signal: controller.signal,
      onProgress: ({ phase, fraction }) => {
        const shown = Math.floor(fraction * 100);
        if (shown === lastShown) return;
        lastShown = shown;
        setEntry(code, { status: "downloading", fraction, phase });
      },
    });
    setEntry(code, { status: "downloaded", fraction: 1, record });
  } catch (error) {
    if (error instanceof OfflineDownloadError && error.kind === "cancelled") {
      setEntry(code, IDLE);
    } else {
      const kind = error instanceof OfflineDownloadError ? error.kind : "storage";
      setEntry(code, {
        status: "failed",
        fraction: 0,
        error: MESSAGES[kind] ?? "Download failed. Try again.",
      });
    }
  } finally {
    controllers.delete(code);
  }
}

export function cancelDownload(code: string): void {
  controllers.get(code)?.abort();
}

export async function removeDownload(code: string): Promise<void> {
  if (!snapshot.ready) await ensureOfflineReady();
  cancelDownload(code);
  // The popup stops showing it as downloaded at once; the text is removed right behind.
  setEntry(code, IDLE);
  try {
    await storage.removeTranslation(code);
  } catch {
    /* the record is already gone, so the Reader no longer uses what is left */
  }
}

/** A chapter from a downloaded translation, or null when that translation is not downloaded. */
export async function getOfflineChapter(
  translation: string,
  bookId: string,
  chapter: number,
): Promise<Chapter | null> {
  if (!canDownloadOffline(translation)) return null;
  await ensureOfflineReady();
  if (entryOf(translation).status !== "downloaded") return null;
  try {
    return await storage.getChapter(translation, bookId, chapter);
  } catch {
    return null;
  }
}

/** For tests: use another store and start from nothing. */
export function resetOfflineManagerForTests(next?: OfflineStorage) {
  storage = next ?? indexedDbStorage;
  snapshot = { ready: false, supported: true, entries: {} };
  readyPromise = null;
  controllers.clear();
  for (const listener of listeners) listener();
}
