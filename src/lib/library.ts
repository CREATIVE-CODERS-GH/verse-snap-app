import { supabase } from "@/integrations/supabase/client";
import type { Verse, VerseRef } from "./bible/service";

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

interface Row {
  id: string;
  translation: string;
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  verse_text: string;
  created_at?: string;
  viewed_at?: string;
}

const SAVED_STORAGE_KEY = "versesnap.library.saved.v1";
const HISTORY_STORAGE_KEY = "versesnap.library.history.v1";

function referenceKey(ref: VerseRef, translation: string): string {
  return `${translation}/${ref.bookId}/${ref.chapter}/${ref.verse}`;
}

function readLocal(key: string): LibraryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(key: string, entries: LibraryEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(entries));
}

function localEntry(verse: Verse): LibraryEntry {
  return {
    id: referenceKey(verse, verse.translation),
    translation: verse.translation,
    bookId: verse.bookId,
    bookName: verse.bookName,
    chapter: verse.chapter,
    verse: verse.verse,
    verseText: verse.text,
    at: new Date().toISOString(),
  };
}

function toEntry(row: Row, timeField: "created_at" | "viewed_at"): LibraryEntry {
  return {
    id: row.id,
    translation: row.translation,
    bookId: row.book_id,
    bookName: row.book_name,
    chapter: row.chapter,
    verse: row.verse,
    verseText: row.verse_text,
    at: row[timeField] ?? new Date().toISOString(),
  };
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

/**
 * Saved verses and reading history for the signed-in person.
 * Screens use this module; they never query the database directly.
 */
export const library = {
  async listSaved(userId?: string): Promise<LibraryEntry[]> {
    if (!userId) return readLocal(SAVED_STORAGE_KEY);
    const { data, error } = await supabase
      .from("saved_verses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toEntry(row as Row, "created_at"));
  },

  async isSaved(ref: VerseRef, translation: string, userId?: string): Promise<boolean> {
    if (!userId) {
      const key = referenceKey(ref, translation);
      return readLocal(SAVED_STORAGE_KEY).some((entry) => entry.id === key);
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
      writeLocal(SAVED_STORAGE_KEY, [entry, ...readLocal(SAVED_STORAGE_KEY).filter((item) => item.id !== entry.id)]);
      return;
    }
    const { error } = await supabase
      .from("saved_verses")
      .upsert(payload(verse, userId), { onConflict: "user_id,translation,book_id,chapter,verse" });
    if (error) throw error;
  },

  async unsave(ref: VerseRef, translation: string, userId?: string): Promise<void> {
    if (!userId) {
      const key = referenceKey(ref, translation);
      writeLocal(SAVED_STORAGE_KEY, readLocal(SAVED_STORAGE_KEY).filter((entry) => entry.id !== key));
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
      writeLocal(SAVED_STORAGE_KEY, readLocal(SAVED_STORAGE_KEY).filter((entry) => entry.id !== id));
      return;
    }
    const { error } = await supabase.from("saved_verses").delete().eq("id", id);
    if (error) throw error;
  },

  async listHistory(limit = 100, userId?: string): Promise<LibraryEntry[]> {
    if (!userId) return readLocal(HISTORY_STORAGE_KEY).slice(0, limit);
    const { data, error } = await supabase
      .from("history")
      .select("*")
      .order("viewed_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => toEntry(row as Row, "viewed_at"));
  },

  async recordView(verse: Verse, userId?: string): Promise<void> {
    if (!userId) {
      const entry = localEntry(verse);
      writeLocal(HISTORY_STORAGE_KEY, [entry, ...readLocal(HISTORY_STORAGE_KEY).filter((item) => item.id !== entry.id)].slice(0, 100));
      return;
    }
    const versePayload = payload(verse, userId);
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

  async clearHistory(userId?: string): Promise<void> {
    if (!userId) {
      writeLocal(HISTORY_STORAGE_KEY, []);
      return;
    }
    const { error } = await supabase.from("history").delete().eq("user_id", userId);
    if (error) throw error;
  },
};
