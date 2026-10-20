/**
 * Thematic cross-references offered in the verse annotation sheet (Stitch Screen 23).
 *
 * NOT CONNECTED TO A SOURCE. The three chips for Romans 12:2 are the sample copy from the approved
 * design (the passages are real, the short phrases beside them are the design's wording and are not
 * verified). Every other verse gets neutral placeholders. The interface labels all of it
 * "Sample content". No verse text lives here.
 */
export interface SampleCrossReference {
  label: string;
  hint: string;
  dot: "primary" | "secondary" | "tertiary";
  /** The passage to open, when it is a real reference in our reader. */
  target?: { book: string; chapter: number; verse: number };
}

const ROMANS_12_2: SampleCrossReference[] = [
  {
    label: "Ephesians 4:23",
    hint: "“renewed mind”",
    dot: "primary",
    target: { book: "ephesians", chapter: 4, verse: 23 },
  },
  {
    label: "Philippians 4:8",
    hint: "“think on these”",
    dot: "secondary",
    target: { book: "philippians", chapter: 4, verse: 8 },
  },
  {
    label: "Colossians 3:10",
    hint: "“new self”",
    dot: "tertiary",
    target: { book: "colossians", chapter: 3, verse: 10 },
  },
];

const PLACEHOLDERS: SampleCrossReference[] = [
  { label: "Related passage", hint: "(sample)", dot: "primary" },
  { label: "Related passage", hint: "(sample)", dot: "secondary" },
  { label: "Related passage", hint: "(sample)", dot: "tertiary" },
];

export interface SampleCrossReferences {
  /** The "(7)" in "Explore all (7)". */
  total: number;
  chips: SampleCrossReference[];
}

export function getSampleCrossReferences(
  bookId: string,
  chapter: number,
  verse: number,
): SampleCrossReferences {
  if (bookId === "romans" && chapter === 12 && verse === 2) {
    return { total: 7, chips: ROMANS_12_2 };
  }
  return { total: PLACEHOLDERS.length, chips: PLACEHOLDERS };
}
