import { useEffect, useSyncExternalStore } from "react";
import {
  cancelDownload,
  downloadedCodes,
  ensureOfflineReady,
  entryOf,
  getServerSnapshot,
  getSnapshot,
  removeDownload,
  startDownload,
  subscribe,
  type OfflineEntry,
} from "./offline-manager";

/** The downloaded translations and their download state, kept up to date in any component. */
export function useOfflineDownloads() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    void ensureOfflineReady();
  }, []);
  return {
    ready: snapshot.ready,
    supported: snapshot.supported,
    entry: (code: string): OfflineEntry => entryOf(code, snapshot),
    downloaded: downloadedCodes(snapshot),
    start: (code: string) => void startDownload(code),
    cancel: cancelDownload,
    remove: (code: string) => void removeDownload(code),
  };
}
