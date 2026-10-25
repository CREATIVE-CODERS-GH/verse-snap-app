/**
 * Original-language notes for the comparison view (Stitch Screen 25, "Greek Root Nuance").
 *
 * NOT CONNECTED TO A LEXICON. Only Romans 12:2 has notes, taken from standard Greek lexicons
 * (Strong's numbering); every other verse shows "not available yet". The interface labels these
 * notes as sample content. No verse text lives here.
 */
export interface RootNote {
  word: string;
  transliteration: string;
  strongs: string;
  form: string;
  gloss: string;
  meaning: string;
}

const ROMANS_12_2: RootNote[] = [
  {
    word: "μεταμορφοῦσθε",
    transliteration: "metamorphousthe",
    strongs: "G3339",
    form: "Imperative",
    gloss: "be transformed",
    meaning:
      "To change into another form; an ongoing change from the inside rather than a surface adjustment.",
  },
  {
    word: "δοκιμάζειν",
    transliteration: "dokimazein",
    strongs: "G1381",
    form: "Infinitive",
    gloss: "to test, to prove",
    meaning:
      "To examine and, having tested, to approve; why versions read “prove”, “discern” or “test and approve”.",
  },
];

export function getRootNotes(bookId: string, chapter: number, verse: number): RootNote[] {
  return bookId === "romans" && chapter === 12 && verse === 2 ? ROMANS_12_2 : [];
}

/** A short, general description of each catalogue edition's translation approach. */
export const TRANSLATION_APPROACH: Record<string, string> = {
  KJAV: "Historical Jacobean",
  BSB: "Formal & Readable",
  WEB: "Formal Equivalence",
  ASV: "Formal Equivalence",
  BBE: "Basic English",
  FBV: "Thought-for-Thought",
};
