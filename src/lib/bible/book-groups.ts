import { BIBLE_BOOKS, type BibleBook } from "./books";

/** The way the Book & Chapter Index groups books (Stitch Screen 21). Pure data, no editorial claims. */
export type Testament = "ot" | "nt";

export interface BookGroup {
  id: string;
  testament: Testament;
  /** Chip and section-heading text. */
  label: string;
  /** What a single book of this group is called, shown under its name. */
  kind: string;
  bookIds: readonly string[];
}

export const BOOK_GROUPS: readonly BookGroup[] = [
  {
    id: "law",
    testament: "ot",
    label: "The Law",
    kind: "Law",
    bookIds: ["genesis", "exodus", "leviticus", "numbers", "deuteronomy"],
  },
  {
    id: "history",
    testament: "ot",
    label: "History",
    kind: "History",
    bookIds: [
      "joshua",
      "judges",
      "ruth",
      "1samuel",
      "2samuel",
      "1kings",
      "2kings",
      "1chronicles",
      "2chronicles",
      "ezra",
      "nehemiah",
      "esther",
    ],
  },
  {
    id: "wisdom",
    testament: "ot",
    label: "Wisdom & Poetry",
    kind: "Wisdom & Poetry",
    bookIds: ["job", "psalms", "proverbs", "ecclesiastes", "songofsolomon"],
  },
  {
    id: "major-prophets",
    testament: "ot",
    label: "Major Prophets",
    kind: "Major Prophet",
    bookIds: ["isaiah", "jeremiah", "lamentations", "ezekiel", "daniel"],
  },
  {
    id: "minor-prophets",
    testament: "ot",
    label: "Minor Prophets",
    kind: "Minor Prophet",
    bookIds: [
      "hosea",
      "joel",
      "amos",
      "obadiah",
      "jonah",
      "micah",
      "nahum",
      "habakkuk",
      "zephaniah",
      "haggai",
      "zechariah",
      "malachi",
    ],
  },
  {
    id: "gospels-acts",
    testament: "nt",
    label: "Gospels & Acts",
    kind: "Gospel & Acts",
    bookIds: ["matthew", "mark", "luke", "john", "acts"],
  },
  {
    id: "pauline",
    testament: "nt",
    label: "Pauline Epistles",
    kind: "Pauline Epistle",
    bookIds: [
      "romans",
      "1corinthians",
      "2corinthians",
      "galatians",
      "ephesians",
      "philippians",
      "colossians",
      "1thessalonians",
      "2thessalonians",
      "1timothy",
      "2timothy",
      "titus",
      "philemon",
    ],
  },
  {
    id: "general",
    testament: "nt",
    label: "General Epistles",
    kind: "General Epistle",
    bookIds: ["hebrews", "james", "1peter", "2peter", "1john", "2john", "3john", "jude"],
  },
  {
    id: "prophecy",
    testament: "nt",
    label: "Prophecy",
    kind: "Prophecy",
    bookIds: ["revelation"],
  },
];

export const TESTAMENT_LABEL: Record<Testament, string> = {
  ot: "Old Testament",
  nt: "New Testament",
};

export function groupsOf(testament: Testament): BookGroup[] {
  return BOOK_GROUPS.filter((group) => group.testament === testament);
}

export function groupOfBook(bookId: string): BookGroup | undefined {
  return BOOK_GROUPS.find((group) => group.bookIds.includes(bookId));
}

export function booksOfGroup(group: BookGroup): BibleBook[] {
  return group.bookIds
    .map((id) => BIBLE_BOOKS.find((book) => book.id === id))
    .filter((book): book is BibleBook => Boolean(book));
}

export function booksOfTestament(testament: Testament): BibleBook[] {
  return groupsOf(testament).flatMap(booksOfGroup);
}

/** The two-character badge shown on a collapsed book row: "1C", "Ga", "Ep". */
export function bookBadge(book: Pick<BibleBook, "name">): string {
  const numbered = /^(\d)\s*([A-Za-z])/.exec(book.name);
  if (numbered) return `${numbered[1]}${(numbered[2] ?? "").toUpperCase()}`;
  const letters = book.name.replace(/[^A-Za-z]/g, "");
  return letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
}

/** Books whose name or abbreviation contains the query (case and spacing ignored). */
export function searchBooks(query: string): BibleBook[] {
  const needle = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!needle) return [];
  const scored = BIBLE_BOOKS.flatMap((book, index) => {
    const name = book.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const aliases = book.aliases.map((alias) => alias.toLowerCase());
    let rank = -1;
    if (name === needle || aliases.includes(needle)) rank = 0;
    else if (name.startsWith(needle) || aliases.some((alias) => alias.startsWith(needle))) rank = 1;
    else if (name.includes(needle)) rank = 2;
    return rank < 0 ? [] : [{ book, rank, index }];
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map((item) => item.book);
}
