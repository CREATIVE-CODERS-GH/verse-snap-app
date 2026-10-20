import { supabase } from "@/integrations/supabase/client";
import { guestHighlights, HIGHLIGHT_KEY, type GuestHighlight } from "./highlights";
import { ACCOUNT_HIGHLIGHTS_ENABLED } from "./highlights-schema";
import { ACCOUNT_HISTORY_V2, HISTORY_ENTRY_KEY } from "./history-schema";
import { guestStore, type HistoryEntry, type LibraryEntry } from "./library";

/*
 * Guest-to-account merge: adds Saved verses and History kept on this device (while signed out) to
 * the signed-in account's existing, RLS-protected tables, with the person's own session (never the
 * service-role key).
 *
 * Safety rules
 *  - Runs only after the person chooses "Add to my account" (a shared device could otherwise
 *    hand one person's guest data to whoever signs in next).
 *  - The signed-in user is confirmed with the server before any write, and re-checked before every
 *    batch; if the account changes mid-way, the merge stops.
 *  - Saved: insert-or-ignore on the table's unique key, so existing account rows (and their dates)
 *    are never overwritten and retries create no duplicates.
 *  - History: only entries the account doesn't already have are inserted, keeping the original time
 *    (insert-or-ignore on the table's entry key once the chapter-entries migration is applied).
 *  - Guest items are removed from the device only after the server confirms their batch. A failure
 *    or interruption leaves the rest on the device, so the merge can simply be run again.
 *  - Chapter visits are added only once the account table can hold them (ACCOUNT_HISTORY_V2);
 *    until then they stay on the device.
 *  - Highlights (once ACCOUNT_HIGHLIGHTS_ENABLED): insert-or-ignore on the one-per-verse key, so a
 *    verse the account already highlighted keeps the account's colour; until enabled they stay on
 *    the device.
 */

export const MERGE_BATCH_SIZE = 50;

export interface SavedRow {
  user_id: string;
  translation: string;
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  verse_text: string;
  created_at: string;
}

export interface HistoryRow {
  user_id: string;
  translation: string;
  book_id: string;
  book_name: string;
  chapter: number;
  /** Null for a chapter entry. */
  verse: number | null;
  verse_text: string;
  viewed_at: string;
  /** Sent only once the chapter-entries migration is applied (the column doesn't exist before). */
  kind?: "verse" | "chapter";
}

export interface HighlightRow {
  user_id: string;
  translation: string;
  book_id: string;
  chapter: number;
  verse: number;
  color: string;
  created_at: string;
  updated_at: string;
}

/** The few database operations the merge needs, so the rules can be tested without a server. */
export interface MergeBackend {
  /** The user confirmed by the auth server for the current session, or null. */
  verifiedUserId(): Promise<string | null>;
  /** The user in the local session right now (cheap; re-checked between batches). */
  sessionUserId(): Promise<string | null>;
  upsertSaved(rows: SavedRow[]): Promise<void>;
  /** Keys (translation/book/chapter/verse) of the account's history rows for these books. */
  existingHistoryKeys(bookIds: string[]): Promise<Set<string>>;
  /** Adds rows; once the migration is applied, rows already in the account are left unchanged. */
  insertHistory(rows: HistoryRow[]): Promise<void>;
  /** Adds highlights; a verse the account already highlighted is left unchanged. */
  insertHighlights(rows: HighlightRow[]): Promise<void>;
}

export interface MergeOptions {
  /** The account table holds chapter entries (defaults to ACCOUNT_HISTORY_V2). */
  accountHistoryV2?: boolean;
  /** The account highlights table exists (defaults to ACCOUNT_HIGHLIGHTS_ENABLED). */
  accountHighlights?: boolean;
}

export interface GuestStoreLike {
  saved(): LibraryEntry[];
  history(): HistoryEntry[];
  removeSaved(ids: readonly string[]): void;
  removeHistory(ids: readonly string[]): void;
  highlights(): GuestHighlight[];
  removeHighlights(ids: readonly string[]): void;
}

/** This device's guest data: Saved, History and highlights. */
export const guestDevice: GuestStoreLike = {
  saved: () => guestStore.saved(),
  history: () => guestStore.history(),
  removeSaved: (ids) => guestStore.removeSaved(ids),
  removeHistory: (ids) => guestStore.removeHistory(ids),
  highlights: () => guestHighlights.all(),
  removeHighlights: (ids) => guestHighlights.remove(ids),
};

export type MergeStatus = "done" | "partial" | "aborted" | "nothing";

export interface MergeResult {
  status: MergeStatus;
  savedAdded: number;
  historyAdded: number;
  /** Chapter visits added (only when the account table holds chapter entries). */
  chaptersAdded: number;
  /** Highlights added (only when the account highlights table exists). */
  highlightsAdded: number;
  /** Guest items still on the device afterwards (failed batches, and chapter visits if kept). */
  remaining: number;
  error?: string;
}

type VerseHistory = Extract<HistoryEntry, { kind: "verse" }>;
type ChapterHistory = Extract<HistoryEntry, { kind: "chapter" }>;

/** The guest History entries that can be added to an account (chapters only after the migration). */
export function mergeableHistory(
  store: GuestStoreLike = guestDevice,
  accountHistoryV2 = ACCOUNT_HISTORY_V2,
): HistoryEntry[] {
  return store
    .history()
    .filter((entry) => entry.kind === "verse" || (accountHistoryV2 && entry.kind === "chapter"));
}

/** The guest highlights that can be added to an account (none until the table exists). */
export function mergeableHighlights(
  store: GuestStoreLike = guestDevice,
  accountHighlights = ACCOUNT_HIGHLIGHTS_ENABLED,
): GuestHighlight[] {
  return accountHighlights ? store.highlights() : [];
}

/** What could be added to an account: saved verses, history and (when supported) highlights. */
export function mergeableCounts(
  store: GuestStoreLike = guestDevice,
  accountHistoryV2 = ACCOUNT_HISTORY_V2,
  accountHighlights = ACCOUNT_HIGHLIGHTS_ENABLED,
) {
  const saved = store.saved().length;
  const entries = mergeableHistory(store, accountHistoryV2);
  const history = entries.filter((entry) => entry.kind === "verse").length;
  const chapters = entries.length - history;
  const highlights = mergeableHighlights(store, accountHighlights).length;
  return { saved, history, chapters, highlights, total: saved + history + chapters + highlights };
}

const keyOf = (item: { translation: string; bookId: string; chapter: number; verse: number }) =>
  `${item.translation}/${item.bookId}/${item.chapter}/${item.verse}`;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : "Unknown error";
}

export async function mergeGuestLibrary(
  expectedUserId: string,
  backend: MergeBackend,
  store: GuestStoreLike = guestDevice,
  {
    accountHistoryV2 = ACCOUNT_HISTORY_V2,
    accountHighlights = ACCOUNT_HIGHLIGHTS_ENABLED,
  }: MergeOptions = {},
): Promise<MergeResult> {
  const counts = mergeableCounts(store, accountHistoryV2, accountHighlights);
  const leftover = () => store.saved().length + store.history().length + store.highlights().length;
  const none = { savedAdded: 0, historyAdded: 0, chaptersAdded: 0, highlightsAdded: 0 };
  if (counts.total === 0) return { status: "nothing", ...none, remaining: leftover() };

  // 1. Confirm who is signed in with the server before writing anything.
  let verified: string | null = null;
  try {
    verified = await backend.verifiedUserId();
  } catch (error) {
    return {
      status: "aborted",
      ...none,
      remaining: leftover(),
      error: message(error),
    };
  }
  if (!verified || verified !== expectedUserId) {
    return {
      status: "aborted",
      ...none,
      remaining: leftover(),
      error: "account mismatch",
    };
  }
  const stillSameUser = async () => (await backend.sessionUserId()) === expectedUserId;

  let savedAdded = 0;
  let historyAdded = 0;
  let chaptersAdded = 0;
  let highlightsAdded = 0;
  // Before the migration the table has no `kind` column, so it isn't sent.
  const kind = <K extends "verse" | "chapter">(value: K) =>
    accountHistoryV2 ? { kind: value } : {};

  try {
    // 2. Saved verses: insert-or-ignore, then clear each confirmed batch from the device.
    for (const batch of chunks(store.saved(), MERGE_BATCH_SIZE)) {
      if (!(await stillSameUser())) throw new Error("account changed");
      await backend.upsertSaved(
        batch.map((entry) => ({
          user_id: expectedUserId,
          translation: entry.translation,
          book_id: entry.bookId,
          book_name: entry.bookName,
          chapter: entry.chapter,
          verse: entry.verse,
          verse_text: entry.verseText,
          created_at: entry.at,
        })),
      );
      store.removeSaved(batch.map((entry) => entry.id));
      savedAdded += batch.length;
    }

    // 3. Verse history: skip verses the account already has (and repeats on the device).
    const verses = store.history().filter((entry): entry is VerseHistory => entry.kind === "verse");
    if (verses.length > 0) {
      if (!(await stillSameUser())) throw new Error("account changed");
      const existing = await backend.existingHistoryKeys([...new Set(verses.map((v) => v.bookId))]);
      for (const batch of chunks(verses, MERGE_BATCH_SIZE)) {
        if (!(await stillSameUser())) throw new Error("account changed");
        const fresh = batch.filter((entry) => {
          const key = keyOf(entry);
          if (existing.has(key)) return false;
          existing.add(key);
          return true;
        });
        if (fresh.length > 0) {
          await backend.insertHistory(
            fresh.map((entry) => ({
              user_id: expectedUserId,
              translation: entry.translation,
              book_id: entry.bookId,
              book_name: entry.bookName,
              chapter: entry.chapter,
              verse: entry.verse,
              verse_text: entry.verseText,
              viewed_at: entry.at,
              ...kind("verse"),
            })),
          );
        }
        // Rows already in the account count as merged: they are safe to remove from the device.
        store.removeHistory(batch.map((entry) => entry.id));
        historyAdded += fresh.length;
      }
    }

    // 4. Chapter visits, once the account table holds them: insert-or-ignore on the entry key, so
    //    a chapter the account already has keeps its own time, and retries add nothing.
    if (accountHistoryV2) {
      const chapters = store
        .history()
        .filter((entry): entry is ChapterHistory => entry.kind === "chapter");
      for (const batch of chunks(chapters, MERGE_BATCH_SIZE)) {
        if (!(await stillSameUser())) throw new Error("account changed");
        await backend.insertHistory(
          batch.map((entry) => ({
            user_id: expectedUserId,
            translation: entry.translation,
            book_id: entry.bookId,
            book_name: entry.bookName,
            chapter: entry.chapter,
            verse: null,
            verse_text: "",
            viewed_at: entry.at,
            ...kind("chapter"),
          })),
        );
        store.removeHistory(batch.map((entry) => entry.id));
        chaptersAdded += batch.length;
      }
    }

    // 5. Highlights, once the account table exists: insert-or-ignore on the one-per-verse key, so
    //    the account's own colour wins and retries add nothing.
    for (const batch of chunks(mergeableHighlights(store, accountHighlights), MERGE_BATCH_SIZE)) {
      if (!(await stillSameUser())) throw new Error("account changed");
      await backend.insertHighlights(
        batch.map((entry) => ({
          user_id: expectedUserId,
          translation: entry.translation,
          book_id: entry.bookId,
          chapter: entry.chapter,
          verse: entry.verse,
          color: entry.color,
          created_at: entry.at,
          updated_at: entry.at,
        })),
      );
      store.removeHighlights(batch.map((entry) => entry.id));
      highlightsAdded += batch.length;
    }
  } catch (error) {
    return {
      status: "partial",
      savedAdded,
      historyAdded,
      chaptersAdded,
      highlightsAdded,
      remaining: leftover(),
      error: message(error),
    };
  }

  return {
    status: "done",
    savedAdded,
    historyAdded,
    chaptersAdded,
    highlightsAdded,
    remaining: leftover(),
  };
}

/** The real backend: the signed-in person's own Supabase session (RLS applies to every call). */
export const supabaseMergeBackend: MergeBackend = {
  async verifiedUserId() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user?.id ?? null;
  },
  async sessionUserId() {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  },
  async upsertSaved(rows) {
    const { error } = await supabase.from("saved_verses").upsert(rows, {
      onConflict: "user_id,translation,book_id,chapter,verse",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  },
  async existingHistoryKeys(bookIds) {
    const { data, error } = await supabase
      .from("history")
      .select("translation, book_id, chapter, verse")
      .in("book_id", bookIds)
      .limit(5000);
    if (error) throw error;
    return new Set(
      (data ?? []).map((row) => `${row.translation}/${row.book_id}/${row.chapter}/${row.verse}`),
    );
  },
  async insertHistory(rows) {
    const { error } = ACCOUNT_HISTORY_V2
      ? await supabase
          .from("history")
          .upsert(rows, { onConflict: HISTORY_ENTRY_KEY, ignoreDuplicates: true })
      : await supabase.from("history").insert(rows);
    if (error) throw error;
  },
  async insertHighlights(rows) {
    const { error } = await supabase
      .from("highlights")
      .upsert(rows, { onConflict: HIGHLIGHT_KEY, ignoreDuplicates: true });
    if (error) throw error;
  },
};

/**
 * Runs the merge once at a time per browser (also across tabs, where Web Locks exist), so a double
 * tap or a second tab can't send the same batch twice.
 */
let running: Promise<MergeResult> | null = null;
export function runGuestMerge(expectedUserId: string): Promise<MergeResult> {
  if (running) return running;
  const task = (): Promise<MergeResult> => mergeGuestLibrary(expectedUserId, supabaseMergeBackend);
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
  // The lock is held until the callback's promise settles; the result is passed out separately.
  const started: Promise<MergeResult> = locks
    ? new Promise((resolve, reject) => {
        void locks.request("versesnap-guest-merge", () => task().then(resolve, reject));
      })
    : task();
  const current = started.finally(() => {
    running = null;
  });
  running = current;
  return current;
}
