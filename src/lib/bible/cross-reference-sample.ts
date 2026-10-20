/**
 * Thematic cross-references for the Cross References Explorer (Stitch Screen 27).
 *
 * NOT CONNECTED TO A SOURCE. Only Romans 12:2 has groups: the passages are the approved design's
 * choices and are real references; the theme titles and link labels are the design's wording. The
 * interface labels them "Sample content". Passage text is always fetched live from the Bible API —
 * no verse text lives here.
 */
export interface CrossPassage {
  book: string;
  bookName: string;
  chapter: number;
  /** First and last verse (the same for a single verse). */
  from: number;
  to: number;
  link: "Direct Link" | "Practical Focus" | "Theological Echo" | "Contrast" | "Foundation";
}

export interface CrossGroup {
  id: string;
  title: string;
  icon: "mind" | "world" | "offering";
  passages: CrossPassage[];
}

export interface CrossReferenceSet {
  theme: string;
  summary: string;
  groups: CrossGroup[];
}

const ROMANS_12_2: CrossReferenceSet = {
  theme: "Renewal of the Mind",
  summary:
    "Thematic connections centred on spiritual transformation, non-conformity, and discerning the good and perfect will of God.",
  groups: [
    {
      id: "mind",
      title: "Mind Renewal & New Nature",
      icon: "mind",
      passages: [
        {
          book: "ephesians",
          bookName: "Ephesians",
          chapter: 4,
          from: 23,
          to: 24,
          link: "Direct Link",
        },
        {
          book: "philippians",
          bookName: "Philippians",
          chapter: 4,
          from: 8,
          to: 8,
          link: "Practical Focus",
        },
        {
          book: "colossians",
          bookName: "Colossians",
          chapter: 3,
          from: 10,
          to: 10,
          link: "Theological Echo",
        },
      ],
    },
    {
      id: "world",
      title: "Non-Conformity to the World",
      icon: "world",
      passages: [
        { book: "1john", bookName: "1 John", chapter: 2, from: 15, to: 15, link: "Direct Link" },
        { book: "james", bookName: "James", chapter: 4, from: 4, to: 4, link: "Contrast" },
      ],
    },
    {
      id: "offering",
      title: "Discerning God’s Will & Living Sacrifice",
      icon: "offering",
      passages: [
        { book: "romans", bookName: "Romans", chapter: 12, from: 1, to: 1, link: "Foundation" },
        {
          book: "1thessalonians",
          bookName: "1 Thessalonians",
          chapter: 4,
          from: 3,
          to: 3,
          link: "Practical Focus",
        },
      ],
    },
  ],
};

export function getCrossReferences(
  bookId: string,
  chapter: number,
  verse: number,
): CrossReferenceSet | null {
  return bookId === "romans" && chapter === 12 && verse === 2 ? ROMANS_12_2 : null;
}

export function passageLabel(passage: CrossPassage): string {
  return `${passage.bookName} ${passage.chapter}:${passage.from}${passage.to !== passage.from ? `–${passage.to}` : ""}`;
}
