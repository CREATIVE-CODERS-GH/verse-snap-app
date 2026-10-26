/** What gets read aloud, in order. Pure data: nothing here touches the browser. */

export interface NarrationItem {
  /** The exact text handed to the speech engine. */
  text: string;
  /** The verse this item reads, or null for the chapter title. */
  verse: number | null;
}

export interface NarrationQueue {
  /** Identifies who started it, so a screen can tell whether the current reading is its own. */
  id: string;
  /** Short label such as "Psalm 23" for a future player. */
  label: string;
  /** Present for chapter readings; lets the reader match the active verse to what is on screen. */
  chapter: { translation: string; bookId: string; chapter: number } | null;
  items: readonly NarrationItem[];
}

export interface ChapterSource {
  id: string;
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verses: readonly { verse: number; text: string }[];
}

/**
 * A whole chapter: the chapter title once ("Psalm 23"), then each verse's text. Verse numbers are
 * not read, and the text is exactly what the selected translation shows (nothing is added or
 * reworded). Verses with no text are skipped.
 */
export function chapterQueue(source: ChapterSource): NarrationQueue {
  const label = `${source.bookName} ${source.chapter}`;
  const items: NarrationItem[] = [{ text: label, verse: null }];
  for (const verse of source.verses) {
    const text = verse.text.trim();
    if (text) items.push({ text, verse: verse.verse });
  }
  return {
    id: source.id,
    label,
    chapter: { translation: source.translation, bookId: source.bookId, chapter: source.chapter },
    items,
  };
}

/** One piece of text, read as given (a verse with its reference, a comparison, a saved verse). */
export function singleQueue(id: string, text: string): NarrationQueue {
  return { id, label: "", chapter: null, items: [{ text, verse: null }] };
}

/** The index to move to from `index` by `step`, or null when that runs off either end. */
export function stepIndex(queue: NarrationQueue, index: number, step: 1 | -1): number | null {
  const next = index + step;
  return next >= 0 && next < queue.items.length ? next : null;
}
