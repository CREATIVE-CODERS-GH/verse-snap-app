import { supabase } from "@/integrations/supabase/client";
import { guestHighlights, HIGHLIGHT_KEY, type GuestHighlight } from "./highlights";
import { ACCOUNT_HIGHLIGHTS_ENABLED } from "./highlights-schema";
import { ACCOUNT_HISTORY_V2, HISTORY_ENTRY_KEY } from "./history-schema";
import {
  BODY_MAX,
  ensureAccountNotebooks,
  GUEST_DEFAULT_NOTEBOOK_ID,
  guestJournal,
  TAGS_MAX,
  TITLE_MAX,
  type GuestJournal,
  type Reflection,
} from "./journal";
import { ACCOUNT_JOURNAL_ENABLED } from "./journal-schema";
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
 *  - Journal (once ACCOUNT_JOURNAL_ENABLED): the device's notebooks join the account's (matched by
 *    name; General joins General), and reflections are insert-or-ignore on the one-per-verse key.
 *    A reflection whose verse already has a note in the account is NOT overwritten: it stays on
 *    the device (visible when signed out) and isn't offered to that account again.
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

export interface NotebookRow {
  id: string;
  user_id: string;
  name: string;
  is_default: false;
  created_at: string;
  updated_at: string;
}

export interface ReflectionRow {
  id: string;
  user_id: string;
  notebook_id: string;
  translation: string;
  book_id: string;
  chapter: number;
  verse: number;
  title: string;
  body: string;
  tags: string[];
  posture: string | null;
  is_private: boolean;
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
  /** The account's notebooks (creating its General notebook if needed). */
  accountNotebooks(userId: string): Promise<{ id: string; name: string; isDefault: boolean }[]>;
  /** Adds notebooks with the device's ids; ones already added (a retry) are left unchanged. */
  insertNotebooks(rows: NotebookRow[]): Promise<void>;
  /** Adds reflections; a verse that already has a note in the account is left unchanged. */
  insertReflections(rows: ReflectionRow[]): Promise<void>;
  /** Which of these reflection ids are now in the account. */
  reflectionIds(ids: string[]): Promise<Set<string>>;
}

export interface MergeOptions {
  /** The account table holds chapter entries (defaults to ACCOUNT_HISTORY_V2). */
  accountHistoryV2?: boolean;
  /** The account highlights table exists (defaults to ACCOUNT_HIGHLIGHTS_ENABLED). */
  accountHighlights?: boolean;
  /** The account journal tables exist (defaults to ACCOUNT_JOURNAL_ENABLED). */
  accountJournal?: boolean;
}

/** What to count: the switches above, and who is signing in (for notes kept on the device). */
export interface MergeScope extends MergeOptions {
  userId?: string;
}

export interface GuestStoreLike {
  saved(): LibraryEntry[];
  history(): HistoryEntry[];
  removeSaved(ids: readonly string[]): void;
  removeHistory(ids: readonly string[]): void;
  highlights(): GuestHighlight[];
  removeHighlights(ids: readonly string[]): void;
  journal(): GuestJournal;
  removeReflections(ids: readonly string[]): void;
  removeNotebooks(ids: readonly string[]): void;
  /** Reflections kept on the device because this account already had a note for the verse. */
  keptReflections(userId: string): string[];
  markKeptReflections(userId: string, ids: readonly string[]): void;
}

const KEPT_PREFIX = "versesnap.guest-merge.kept.";

function readKept(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(KEPT_PREFIX + userId) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** This device's guest data: Saved, History and highlights. */
export const guestDevice: GuestStoreLike = {
  saved: () => guestStore.saved(),
  history: () => guestStore.history(),
  removeSaved: (ids) => guestStore.removeSaved(ids),
  removeHistory: (ids) => guestStore.removeHistory(ids),
  highlights: () => guestHighlights.all(),
  removeHighlights: (ids) => guestHighlights.remove(ids),
  journal: () => guestJournal.read(),
  removeReflections: (ids) => guestJournal.removeReflections(ids),
  removeNotebooks: (ids) => guestJournal.removeNotebooks(ids),
  keptReflections: (userId) => readKept(userId),
  markKeptReflections: (userId, ids) => {
    if (typeof window === "undefined" || ids.length === 0) return;
    const kept = new Set([...readKept(userId), ...ids]);
    window.localStorage.setItem(KEPT_PREFIX + userId, JSON.stringify([...kept]));
  },
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
  /** Reflections added (only when the account journal exists). */
  reflectionsAdded: number;
  /** Reflections left on the device because the account already has a note for that verse. */
  reflectionsKept: number;
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

const validForAccount = (reflection: Reflection) =>
  (reflection.title.trim() !== "" || reflection.body.trim() !== "") &&
  reflection.title.length <= TITLE_MAX &&
  reflection.body.length <= BODY_MAX &&
  reflection.tags.length <= TAGS_MAX;

/**
 * The guest reflections that can be added to an account (none until the journal tables exist):
 * not ones already kept on the device for this account, and only ones the account can store.
 */
export function mergeableReflections(
  store: GuestStoreLike = guestDevice,
  accountJournal = ACCOUNT_JOURNAL_ENABLED,
  userId?: string,
): Reflection[] {
  if (!accountJournal) return [];
  const kept = new Set(userId ? store.keptReflections(userId) : []);
  return store.journal().reflections.filter((item) => !kept.has(item.id) && validForAccount(item));
}

/** What could be added to an account: saved verses, history and (when supported) highlights and
 * reflections. */
export function mergeableCounts(store: GuestStoreLike = guestDevice, scope: MergeScope = {}) {
  const {
    accountHistoryV2 = ACCOUNT_HISTORY_V2,
    accountHighlights = ACCOUNT_HIGHLIGHTS_ENABLED,
    accountJournal = ACCOUNT_JOURNAL_ENABLED,
    userId,
  } = scope;
  const saved = store.saved().length;
  const entries = mergeableHistory(store, accountHistoryV2);
  const history = entries.filter((entry) => entry.kind === "verse").length;
  const chapters = entries.length - history;
  const highlights = mergeableHighlights(store, accountHighlights).length;
  const reflections = mergeableReflections(store, accountJournal, userId).length;
  return {
    saved,
    history,
    chapters,
    highlights,
    reflections,
    total: saved + history + chapters + highlights + reflections,
  };
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
    accountJournal = ACCOUNT_JOURNAL_ENABLED,
  }: MergeOptions = {},
): Promise<MergeResult> {
  const counts = mergeableCounts(store, {
    accountHistoryV2,
    accountHighlights,
    accountJournal,
    userId: expectedUserId,
  });
  const leftover = () =>
    store.saved().length +
    store.history().length +
    store.highlights().length +
    store.journal().reflections.length;
  const none = {
    savedAdded: 0,
    historyAdded: 0,
    chaptersAdded: 0,
    highlightsAdded: 0,
    reflectionsAdded: 0,
    reflectionsKept: 0,
  };
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
  let reflectionsAdded = 0;
  let reflectionsKept = 0;
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

    // 6. Journal, once the account tables exist.
    const reflections = mergeableReflections(store, accountJournal, expectedUserId);
    if (reflections.length > 0) {
      if (!(await stillSameUser())) throw new Error("account changed");
      // Notebooks: General joins the account's General; others join an account notebook with the
      // same name (any case), or are added with the device's id (so a retry finds them).
      const accountNotebooks = await backend.accountNotebooks(expectedUserId);
      const accountDefault = accountNotebooks.find((item) => item.isDefault);
      if (!accountDefault) throw new Error("no default notebook");
      const byName = new Map(accountNotebooks.map((item) => [item.name.toLowerCase(), item.id]));
      const notebookFor = new Map<string, string>([[GUEST_DEFAULT_NOTEBOOK_ID, accountDefault.id]]);
      const newNotebooks: NotebookRow[] = [];
      const used = new Set(reflections.map((item) => item.notebookId));
      for (const notebook of store.journal().notebooks) {
        if (notebook.isDefault || !used.has(notebook.id)) continue;
        const existing = byName.get(notebook.name.toLowerCase());
        if (existing) notebookFor.set(notebook.id, existing);
        else {
          notebookFor.set(notebook.id, notebook.id);
          newNotebooks.push({
            id: notebook.id,
            user_id: expectedUserId,
            name: notebook.name,
            is_default: false,
            created_at: notebook.createdAt,
            updated_at: notebook.updatedAt,
          });
        }
      }
      if (newNotebooks.length > 0) {
        if (!(await stillSameUser())) throw new Error("account changed");
        await backend.insertNotebooks(newNotebooks);
      }

      for (const batch of chunks(reflections, MERGE_BATCH_SIZE)) {
        if (!(await stillSameUser())) throw new Error("account changed");
        await backend.insertReflections(
          batch.map((item) => ({
            id: item.id,
            user_id: expectedUserId,
            notebook_id: notebookFor.get(item.notebookId) ?? accountDefault.id,
            translation: item.translation,
            book_id: item.bookId,
            chapter: item.chapter,
            verse: item.verse,
            title: item.title,
            body: item.body,
            tags: item.tags,
            posture: item.posture,
            is_private: item.isPrivate,
            created_at: item.createdAt,
            updated_at: item.updatedAt,
          })),
        );
        // Only notes the account now holds under their own id leave the device; a verse that
        // already had an account note keeps the device's copy.
        const inAccount = await backend.reflectionIds(batch.map((item) => item.id));
        const added = batch.filter((item) => inAccount.has(item.id)).map((item) => item.id);
        const kept = batch.filter((item) => !inAccount.has(item.id)).map((item) => item.id);
        store.removeReflections(added);
        store.markKeptReflections(expectedUserId, kept);
        reflectionsAdded += added.length;
        reflectionsKept += kept.length;
      }

      // Device notebooks that were merged and no longer hold any device reflections.
      const stillUsed = new Set(store.journal().reflections.map((item) => item.notebookId));
      store.removeNotebooks(
        [...notebookFor.keys()].filter(
          (id) => id !== GUEST_DEFAULT_NOTEBOOK_ID && !stillUsed.has(id),
        ),
      );
    }
  } catch (error) {
    return {
      status: "partial",
      savedAdded,
      historyAdded,
      chaptersAdded,
      highlightsAdded,
      reflectionsAdded,
      reflectionsKept,
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
    reflectionsAdded,
    reflectionsKept,
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
  async accountNotebooks(userId) {
    return ensureAccountNotebooks(userId);
  },
  async insertNotebooks(rows) {
    const { error } = await supabase
      .from("notebooks")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  },
  async insertReflections(rows) {
    const { error } = await supabase.from("reflections").upsert(rows, {
      onConflict: "user_id,translation,book_id,chapter,verse",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  },
  async reflectionIds(ids) {
    const { data, error } = await supabase.from("reflections").select("id").in("id", ids);
    if (error) throw error;
    return new Set((data ?? []).map((row) => row.id));
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
