import { toApiBookId } from "./books";

/**
 * Verse Snap book id ("john") to the USFM code YouVersion uses ("JHN").
 *
 * Verse Snap's existing book table already carries standard USFM codes for the HelloAO API; this
 * wrapper names that fact and youversion.test.ts pins the whole table to the USFM standard, so a
 * future change to the HelloAO table cannot silently break the YouVersion mapping.
 */
export function toUsfmBookId(bookId: string): string | undefined {
  return toApiBookId(bookId);
}
