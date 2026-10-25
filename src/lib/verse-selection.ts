import type { Reflection } from "@/lib/journal";

/** How long a finger must rest on a verse to start choosing several verses. */
export const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling, not pressing. */
export const LONG_PRESS_MOVE_PX = 8;

/** Adds the verse to the choice, or removes it when it is already chosen. Always sorted. */
export function toggleVerse(chosen: readonly number[], verse: number): number[] {
  const next = chosen.includes(verse)
    ? chosen.filter((item) => item !== verse)
    : [...chosen, verse];
  return next.sort((a, b) => a - b);
}

export function selectionLabel(count: number): string {
  return `${count} verse${count === 1 ? "" : "s"} selected`;
}

/** The reflections of one chapter in one translation, by verse number. */
export function reflectionsByVerse(
  reflections: readonly Reflection[],
  translation: string,
  bookId: string,
  chapter: number,
): Map<number, Reflection> {
  const byVerse = new Map<number, Reflection>();
  for (const item of reflections) {
    if (item.translation === translation && item.bookId === bookId && item.chapter === chapter) {
      byVerse.set(item.verse, item);
    }
  }
  return byVerse;
}
