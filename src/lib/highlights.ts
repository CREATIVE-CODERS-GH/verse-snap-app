import { supabase } from "@/integrations/supabase/client";
import { ACCOUNT_HIGHLIGHTS_ENABLED } from "./highlights-schema";
import { assertStillSignedInAs } from "./session-guard";

/*
 * Verse highlights: one colour per verse, per translation (a highlight belongs to the edition it
 * was made in). Guests keep theirs on this device; signed-in highlights live in the account's
 * RLS-protected `highlights` table and are read fresh on every device. Clearing a highlight
 * deletes it. Account highlights are never stored on the device.
 */

/** The five approved highlight tones ("clear" removes a highlight and is never stored). */
export const HIGHLIGHT_COLORS = ["amber", "sage", "sky", "rose", "lilac"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(value: unknown): value is HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor);
}

export interface HighlightRef {
  translation: string;
  bookId: string;
  chapter: number;
  verse: number;
}

export interface GuestHighlight extends HighlightRef {
  id: string;
  color: HighlightColor;
  at: string;
}

/** One highlighted verse, as listed in Saved → Highlights. */
export interface SavedHighlight extends HighlightRef {
  color: HighlightColor;
  /** When it was last set (ISO). */
  at: string;
}

/** Verse number to colour, for one chapter of one translation. */
export type ChapterHighlights = Record<number, HighlightColor>;

export const GUEST_HIGHLIGHTS_KEY = "versesnap.highlights.v1";
/** The account table's unique key: the upsert conflict target. */
export const HIGHLIGHT_KEY = "user_id,translation,book_id,chapter,verse";

export function highlightId(ref: HighlightRef): string {
  return `${ref.translation}/${ref.bookId}/${ref.chapter}/${ref.verse}`;
}

function isGuestHighlight(value: unknown): value is GuestHighlight {
  const item = value as Partial<GuestHighlight> | null;
  return (
    !!item &&
    typeof item.translation === "string" &&
    typeof item.bookId === "string" &&
    typeof item.chapter === "number" &&
    typeof item.verse === "number" &&
    isHighlightColor(item.color) &&
    item.id === highlightId(item as HighlightRef)
  );
}

function readGuest(): GuestHighlight[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_HIGHLIGHTS_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isGuestHighlight) : [];
  } catch {
    return [];
  }
}

function writeGuest(entries: GuestHighlight[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GUEST_HIGHLIGHTS_KEY, JSON.stringify(entries));
}

/** Direct access to this device's guest highlights, for the guest-to-account merge. */
export const guestHighlights = {
  all(): GuestHighlight[] {
    return readGuest();
  },
  /** Removes only the given ids, re-reading first so changes made meanwhile are kept. */
  remove(ids: readonly string[]): void {
    const drop = new Set(ids);
    writeGuest(readGuest().filter((entry) => !drop.has(entry.id)));
  },
};

export const highlights = {
  /** Whether highlights are kept for this person: always for guests; accounts once enabled. */
  persists(userId?: string): boolean {
    return !userId || ACCOUNT_HIGHLIGHTS_ENABLED;
  },

  /** Every highlight this person has, newest first (the Saved → Highlights hub). */
  async list(userId?: string): Promise<SavedHighlight[]> {
    if (!userId) {
      return readGuest()
        .map(({ translation, bookId, chapter, verse, color, at }) => ({
          translation,
          bookId,
          chapter,
          verse,
          color,
          at,
        }))
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    }
    if (!ACCOUNT_HIGHLIGHTS_ENABLED) return [];
    const { data, error } = await supabase
      .from("highlights")
      .select("translation, book_id, chapter, verse, color, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    const result: SavedHighlight[] = [];
    for (const row of data ?? []) {
      if (!isHighlightColor(row.color)) continue;
      result.push({
        translation: row.translation,
        bookId: row.book_id,
        chapter: row.chapter,
        verse: row.verse,
        color: row.color,
        at: row.updated_at,
      });
    }
    return result;
  },

  async forChapter(
    translation: string,
    bookId: string,
    chapter: number,
    userId?: string,
  ): Promise<ChapterHighlights> {
    const result: ChapterHighlights = {};
    if (!userId) {
      for (const entry of readGuest()) {
        if (
          entry.translation === translation &&
          entry.bookId === bookId &&
          entry.chapter === chapter
        )
          result[entry.verse] = entry.color;
      }
      return result;
    }
    if (!ACCOUNT_HIGHLIGHTS_ENABLED) return result;
    const { data, error } = await supabase
      .from("highlights")
      .select("verse, color")
      .eq("translation", translation)
      .eq("book_id", bookId)
      .eq("chapter", chapter);
    if (error) throw error;
    for (const row of data ?? []) if (isHighlightColor(row.color)) result[row.verse] = row.color;
    return result;
  },

  /** Highlights a verse, or changes its colour (one highlight per verse and translation). */
  async set(ref: HighlightRef, color: HighlightColor, userId?: string): Promise<void> {
    const at = new Date().toISOString();
    if (!userId) {
      const id = highlightId(ref);
      writeGuest([{ id, ...ref, color, at }, ...readGuest().filter((entry) => entry.id !== id)]);
      return;
    }
    if (!ACCOUNT_HIGHLIGHTS_ENABLED) return;
    await assertStillSignedInAs(userId);
    const { error } = await supabase.from("highlights").upsert(
      {
        user_id: userId,
        translation: ref.translation,
        book_id: ref.bookId,
        chapter: ref.chapter,
        verse: ref.verse,
        color,
        updated_at: at,
      },
      { onConflict: HIGHLIGHT_KEY },
    );
    if (error) throw error;
  },

  async remove(ref: HighlightRef, userId?: string): Promise<void> {
    if (!userId) {
      guestHighlights.remove([highlightId(ref)]);
      return;
    }
    if (!ACCOUNT_HIGHLIGHTS_ENABLED) return;
    await assertStillSignedInAs(userId);
    const { error } = await supabase
      .from("highlights")
      .delete()
      .eq("user_id", userId)
      .eq("translation", ref.translation)
      .eq("book_id", ref.bookId)
      .eq("chapter", ref.chapter)
      .eq("verse", ref.verse);
    if (error) throw error;
  },
};
