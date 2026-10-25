import type { ParsedReference } from "./parse-reference";
import { BibleServiceError, type Verse, type VerseRef } from "./types";

type GetVerse = (ref: VerseRef, translation: string) => Promise<Verse | null>;

/**
 * Whether a spoken reference points at a real verse in the edition. Chapter-only references and
 * lookups that fail (offline, provider error) count as existing: the reader shows its own states
 * for those, and only a confirmed missing verse should stop the voice screen from navigating.
 */
export async function referenceExists(
  reference: ParsedReference,
  translation: string,
  getVerse: GetVerse,
): Promise<boolean> {
  if (reference.verse === undefined) return true;
  try {
    const verse = await getVerse(
      {
        bookId: reference.bookId,
        bookName: reference.bookName,
        chapter: reference.chapter,
        verse: reference.verse,
      },
      translation,
    );
    return verse !== null;
  } catch (error) {
    return !(error instanceof BibleServiceError && error.kind === "reference");
  }
}
