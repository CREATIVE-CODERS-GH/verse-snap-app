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
  async listSaved(): Promise<LibraryEntry[]> {
    const { data, error } = await supabase
      .from("saved_verses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toEntry(row as Row, "created_at"));
  },

  async isSaved(ref: VerseRef, translation: string): Promise<boolean> {
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

  async save(verse: Verse, userId: string): Promise<void> {
    const { error } = await supabase
      .from("saved_verses")
      .upsert(payload(verse, userId), { onConflict: "user_id,translation,book_id,chapter,verse" });
    if (error) throw error;
  },

  async unsave(ref: VerseRef, translation: string): Promise<void> {
    const { error } = await supabase
      .from("saved_verses")
      .delete()
      .eq("translation", translation)
      .eq("book_id", ref.bookId)
      .eq("chapter", ref.chapter)
      .eq("verse", ref.verse);
    if (error) throw error;
  },

  async removeSaved(id: string): Promise<void> {
    const { error } = await supabase.from("saved_verses").delete().eq("id", id);
    if (error) throw error;
  },

  async listHistory(limit = 100): Promise<LibraryEntry[]> {
    const { data, error } = await supabase
      .from("history")
      .select("*")
      .order("viewed_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row) => toEntry(row as Row, "viewed_at"));
  },

  async recordView(verse: Verse, userId: string): Promise<void> {
    const { error } = await supabase.from("history").insert(payload(verse, userId));
    if (error) throw error;
  },

  async clearHistory(userId: string): Promise<void> {
    const { error } = await supabase.from("history").delete().eq("user_id", userId);
    if (error) throw error;
  },
};
