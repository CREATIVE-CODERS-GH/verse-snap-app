import { groupOfBook } from "@/lib/bible/book-groups";
import { findBook } from "@/lib/bible/books";
import type { Reflection } from "@/lib/journal";

/*
 * Helpers for the Saved hubs (Verses, Highlights, Notes). Pure functions only: the screens in
 * components/saved-hubs.tsx and routes/saved.tsx do the loading and drawing.
 */

export type SavedTab = "verses" | "highlights" | "notes";

export function parseSavedTab(value: unknown): SavedTab {
  return value === "highlights" || value === "notes" ? value : "verses";
}

/** The placeholder Stitch uses for each hub's search bar. */
export const SEARCH_PLACEHOLDERS: Record<SavedTab, string> = {
  verses: "Search saved verses, books, or topics...",
  highlights: "Search highlighted passages, words, or tags...",
  notes: "Search thoughts, tags, or scriptures...",
};

/** Shelf filters for the Verses hub, taken from the book groups the Books screen already uses. */
export type ShelfFilter = "all" | "ot" | "nt" | "gospels";

export const SHELF_LABELS: Record<ShelfFilter, string> = {
  all: "All Verses",
  ot: "Old Testament",
  nt: "New Testament",
  gospels: "Gospels & Acts",
};

export function matchesShelf(bookId: string, filter: ShelfFilter): boolean {
  if (filter === "all") return true;
  const group = groupOfBook(bookId);
  if (filter === "gospels") return group?.id === "gospels-acts";
  return group?.testament === filter;
}

export function verseReference(item: { bookId: string; chapter: number; verse: number }): string {
  return `${findBook(item.bookId)?.name ?? item.bookId} ${item.chapter}:${item.verse}`;
}

/** "just now", "5 min ago", "2 hrs ago", "Yesterday" or "Oct 24". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && then.toDateString() === now.toDateString()) {
    return `${hours} ${hours === 1 ? "hr" : "hrs"} ago`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return "Yesterday";
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The reflections written on one verse (any translation), newest first. */
export function notesOnVerse(
  reflections: readonly Reflection[],
  key: { bookId: string; chapter: number; verse: number },
): Reflection[] {
  return reflections
    .filter(
      (item) =>
        item.bookId === key.bookId && item.chapter === key.chapter && item.verse === key.verse,
    )
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** Tags in use, most used first (ties alphabetical), at most `limit`. */
export function tagCounts(
  reflections: readonly Reflection[],
  limit = 8,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of reflections) {
    for (const tag of new Set(item.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
