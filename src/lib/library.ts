import { supabase } from "@/integrations/supabase/client";
import type { Verse, VerseRef } from "./bible/service";
import { ACCOUNT_HISTORY_V2, HISTORY_ENTRY_KEY } from "./history-schema";

/** A saved verse (always a single verse). */
export interface LibraryEntry {
  id: string;
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
  verseText: string;
  at: string;
}

/** A history entry: a single verse that was opened, or a chapter that was read. */
export type HistoryEntry =
  | (LibraryEntry & { kind: "verse" })
  | (Omit<LibraryEntry, "verse"> & { kind: "chapter"; verse: null });

/** A chapter visit, recorded from the chapter reader (no verse position is invented). */
export interface ChapterVisit {
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
}

interface Row {
  id: string;
  translation: string;
  book_id: string;
  book_name: string;
  chapter: number;
  /** Null only for a chapter entry in `history`. */
  verse: number | null;
  verse_text: string;
  created_at?: string;
  viewed_at?: string;
  /** `history` only, once the chapter-entries migration is applied. */
  kind?: string;
}

/*
 * Guest ("this device") storage. Used only while nobody is signed in. Signed-in reads and writes go
 * to the account's Supabase tables; guest data is never shown to, or written by, a signed-in person
 * until they choose to add it to their account (see guest-merge.ts).
 */
export const GUEST_SAVED_KEY = "versesnap.library.saved.v1";
export const GUEST_HISTORY_KEY = "versesnap.library.history.v1";
const HISTORY_LIMIT = 100;

function verseKey(ref: VerseRef, translation: string): string {
  return `${translation}/${ref.bookId}/${ref.chapter}/${ref.verse}`;
}

export function chapterKey(visit: Omit<ChapterVisit, "bookName">): string {
  return `chapter:${visit.translation}/${visit.bookId}/${visit.chapter}`;
}

function readList(key: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeList(key: string, entries: unknown[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(entries));
}

function isEntry(value: unknown): value is LibraryEntry {
  const item = value as Partial<LibraryEntry> | null;
  return (
    !!item &&
    typeof item.id === "string" &&
    typeof item.translation === "string" &&
    typeof item.bookId === "string" &&
    typeof item.chapter === "number"
  );
}

/** Normalises stored history: entries written before chapter visits existed are verse entries. */
function toHistoryEntry(value: unknown): HistoryEntry | null {
  if (!isEntry(value)) return null;
  const item = value as LibraryEntry & { kind?: string };
  if (item.kind === "chapter") return { ...item, kind: "chapter", verse: null };
  if (typeof item.verse !== "number") return null;
  return { ...item, kind: "verse" };
}

/** Direct access to the guest lists, for the guest-to-account merge and its tests. */
export const guestStore = {
  saved(): LibraryEntry[] {
    return readList(GUEST_SAVED_KEY).filter(
      (item): item is LibraryEntry => isEntry(item) && typeof item.verse === "number",
    );
  },
  history(): HistoryEntry[] {
    return readList(GUEST_HISTORY_KEY)
      .map(toHistoryEntry)
      .filter((item): item is HistoryEntry => item !== null);
  },
  /** Removes only the given ids, re-reading first so changes made meanwhile are kept. */
  removeSaved(ids: readonly string[]): void {
    const drop = new Set(ids);
    writeList(
      GUEST_SAVED_KEY,
      readList(GUEST_SAVED_KEY).filter((item) => !(isEntry(item) && drop.has(item.id))),
    );
  },
  removeHistory(ids: readonly string[]): void {
    const drop = new Set(ids);
    writeList(
      GUEST_HISTORY_KEY,
      readList(GUEST_HISTORY_KEY).filter((item) => !(isEntry(item) && drop.has(item.id))),
    );
  },
  clearAll(): void {
    writeList(GUEST_SAVED_KEY, []);
    writeList(GUEST_HISTORY_KEY, []);
  },
};

function localEntry(verse: Verse): LibraryEntry {
  return {
    id: verseKey(verse, verse.translation),
    translation: verse.translation,
    bookId: verse.bookId,
    bookName: verse.bookName,
    chapter: verse.chapter,
    verse: verse.verse,
    verseText: verse.text,
    at: new Date().toISOString(),
  };
}

function baseEntry(row: Row, timeField: "created_at" | "viewed_at"): Omit<LibraryEntry, "verse"> {
  return {
    id: row.id,
    translation: row.translation,
    bookId: row.book_id,
    bookName: row.book_name,
    chapter: row.chapter,
    verseText: row.verse_text,
    at: row[timeField] ?? new Date().toISOString(),
  };
}

/** saved_verses.verse is NOT NULL. */
function toSaved(row: Row): LibraryEntry {
  return { ...baseEntry(row, "created_at"), verse: row.verse as number };
}

/** Rows from before the chapter-entries migration have no `kind`: they are verse entries. */
function toHistory(row: Row): HistoryEntry {
  const base = baseEntry(row, "viewed_at");
  return row.kind === "chapter" || row.verse === null
    ? { ...base, kind: "chapter", verse: null }
    : { ...base, kind: "verse", verse: row.verse };
}

function payload(verse: Verse, userId: string) {
  return {
    user_id: userId,
    translation: verse.translation,
    book_id: verse.bookId,
    book_name: verse.bookName,
    chapter: verse.chapter,
    verse: verse.verse,
    verse_text: verse.text,
  };
}

function pushHistory(entry: HistoryEntry): void {
  const rest = guestStore.history().filter((item) => item.id !== entry.id);
  writeList(GUEST_HISTORY_KEY, [entry, ...rest].slice(0, HISTORY_LIMIT));
}

/**
 * Saved verses and reading history for the signed-in person, or for this device when nobody is
 * signed in. Screens use this module; they never query the database directly.
 */
export const library = {
  async listSaved(userId?: string): Promise<LibraryEntry[]> {
    if (!userId) return guestStore.saved();
    const { data, error } = await supabase
      .from("saved_verses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toSaved(row as Row));
  },

  async isSaved(ref: VerseRef, translation: string, userId?: string): Promise<boolean> {
    if (!userId) {
      const key = verseKey(ref, translation);
      return guestStore.saved().some((entry) => entry.id === key);
    }
    const { data, error } = await supabase
      .from("saved_verses")
      .select("id")
      .eq("translation", translation)
      .eq("book_id", ref.bookId)
      .eq("chapter", ref.chapter)
      .eq("verse", ref.verse)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },

  async save(verse: Verse, userId?: string): Promise<void> {
    if (!userId) {
      const entry = localEntry(verse);
      writeList(GUEST_SAVED_KEY, [
        entry,
        ...guestStore.saved().filter((item) => item.id !== entry.id),
      ]);
      return;
    }
    const { error } = await supabase
      .from("saved_verses")
      .upsert(payload(verse, userId), { onConflict: "user_id,translation,book_id,chapter,verse" });
    if (error) throw error;
  },

  async unsave(ref: VerseRef, translation: string, userId?: string): Promise<void> {
    if (!userId) {
      guestStore.removeSaved([verseKey(ref, translation)]);
      return;
    }
    const { error } = await supabase
      .from("saved_verses")
      .delete()
      .eq("translation", translation)
      .eq("book_id", ref.bookId)
      .eq("chapter", ref.chapter)
      .eq("verse", ref.verse);
    if (error) throw error;
  },

  async removeSaved(id: string, userId?: string): Promise<void> {
    if (!userId) {
      guestStore.removeSaved([id]);
      return;
    }
    const { error } = await supabase.from("saved_verses").delete().eq("id", id);
    if (error) throw error;
  },

  async listHistory(limit = 100, userId?: string): Promise<HistoryEntry[]> {
    if (!userId) return guestStore.history().slice(0, limit);
    const { data, error } = await supabase
      .from("history")
      .select("*")
      .order("viewed_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => toHistory(row as Row));
  },

  async recordView(verse: Verse, userId?: string): Promise<void> {
    if (!userId) {
      pushHistory({ ...localEntry(verse), kind: "verse" });
      return;
    }
    const versePayload = payload(verse, userId);
    if (ACCOUNT_HISTORY_V2) {
      // One atomic statement on the table's entry key: moves the verse to the top, never duplicates.
      const { error } = await supabase
        .from("history")
        .upsert(
          { ...versePayload, kind: "verse", viewed_at: new Date().toISOString() },
          { onConflict: HISTORY_ENTRY_KEY },
        );
      if (error) throw error;
      return;
    }
    const { error: removeError } = await supabase
      .from("history")
      .delete()
      .eq("user_id", userId)
      .eq("translation", verse.translation)
      .eq("book_id", verse.bookId)
      .eq("chapter", verse.chapter)
      .eq("verse", verse.verse);
    if (removeError) throw removeError;
    const { error } = await supabase.from("history").insert(versePayload);
    if (error) throw error;
  },

  /**
   * Records that a chapter was read: one entry per chapter and translation, moved to the top when
   * read again. Signed in, this needs the chapter-entries migration (see history-schema.ts) and is
   * skipped until it is switched on. Returns whether anything was recorded.
   */
  async recordChapterVisit(visit: ChapterVisit, userId?: string): Promise<boolean> {
    if (userId) {
      if (!ACCOUNT_HISTORY_V2) return false;
      const { error } = await supabase.from("history").upsert(
        {
          user_id: userId,
          kind: "chapter",
          translation: visit.translation,
          book_id: visit.bookId,
          book_name: visit.bookName,
          chapter: visit.chapter,
          verse: null,
          verse_text: "",
          viewed_at: new Date().toISOString(),
        },
        { onConflict: HISTORY_ENTRY_KEY },
      );
      if (error) throw error;
      return true;
    }
    pushHistory({
      id: chapterKey(visit),
      kind: "chapter",
      translation: visit.translation,
      bookId: visit.bookId,
      bookName: visit.bookName,
      chapter: visit.chapter,
      verse: null,
      verseText: "",
      at: new Date().toISOString(),
    });
    return true;
  },

  async clearHistory(userId?: string): Promise<void> {
    if (!userId) {
      writeList(GUEST_HISTORY_KEY, []);
      return;
    }
    const { error } = await supabase.from("history").delete().eq("user_id", userId);
    if (error) throw error;
  },
};
