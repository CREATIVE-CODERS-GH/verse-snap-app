import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BookCard,
  BookRow,
  BookSearchField,
  CategoryChips,
  ContinueBarContent,
  GroupHeading,
  TestamentTabs,
} from "@/components/book-index-parts";
import {
  BOOK_GROUPS,
  bookBadge,
  booksOfGroup,
  booksOfTestament,
  groupOfBook,
  groupsOf,
  moreBelowHint,
  searchBooks,
} from "@/lib/bible/book-groups";
import { BIBLE_BOOKS } from "@/lib/bible/books";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("book groups", () => {
  it("places every one of the 66 books in exactly one group", () => {
    const seen = BOOK_GROUPS.flatMap((group) => group.bookIds);
    expect(seen).toHaveLength(66);
    expect(new Set(seen).size).toBe(66);
    for (const book of BIBLE_BOOKS) expect(groupOfBook(book.id), book.id).toBeDefined();
  });

  it("splits into 39 Old Testament and 27 New Testament books, in canonical order", () => {
    expect(booksOfTestament("ot")).toHaveLength(39);
    expect(booksOfTestament("nt")).toHaveLength(27);
    expect(booksOfTestament("ot").map((book) => book.id)).toEqual(
      BIBLE_BOOKS.slice(0, 39).map((book) => book.id),
    );
    expect(booksOfTestament("nt").map((book) => book.id)).toEqual(
      BIBLE_BOOKS.slice(39).map((book) => book.id),
    );
  });

  it("matches the approved New Testament categories and the 14 Pauline books", () => {
    expect(groupsOf("nt").map((group) => group.label)).toEqual([
      "Gospels & Acts",
      "Pauline Epistles",
      "General Epistles",
      "Prophecy",
    ]);
    const pauline = BOOK_GROUPS.find((group) => group.id === "pauline")!;
    expect(booksOfGroup(pauline)).toHaveLength(14);
    expect(booksOfGroup(pauline)[0]?.id).toBe("romans");
  });

  it("badges look like the design", () => {
    const get = (id: string) => BIBLE_BOOKS.find((book) => book.id === id)!;
    expect(bookBadge(get("1corinthians"))).toBe("1C");
    expect(bookBadge(get("2corinthians"))).toBe("2C");
    expect(bookBadge(get("galatians"))).toBe("Ga");
    expect(bookBadge(get("ephesians"))).toBe("Ep");
    expect(bookBadge(get("philippians"))).toBe("Ph");
  });

  it("searches names and abbreviations, best matches first", () => {
    expect(searchBooks("")).toEqual([]);
    expect(searchBooks("romans")[0]?.id).toBe("romans");
    expect(searchBooks("rom")[0]?.id).toBe("romans");
    expect(searchBooks("1 jo").map((book) => book.id)).toEqual(["1john"]);
    expect(searchBooks("phil").map((book) => book.id)).toEqual(["philippians", "philemon"]);
    expect(searchBooks("zzzz")).toEqual([]);
    expect(searchBooks("JOHN")[0]?.id).toBe("john");
    expect(searchBooks("song of")[0]?.id).toBe("songofsolomon");
  });

  it("describes what is below the visible rows", () => {
    const pauline = BOOK_GROUPS.find((group) => group.id === "pauline")!;
    const remaining = booksOfGroup(pauline).slice(6);
    expect(moreBelowHint(remaining)).toBe("Colossians, Thessalonians, Timothy and more below");
    expect(moreBelowHint([])).toBe("");
  });
});

describe("book index page", () => {
  const page = read("src/routes/books.tsx");

  it("keeps the translation in the URL and links chapters through the existing route", () => {
    expect(page).toContain('createFileRoute("/books")');
    expect(page).toContain("search.translation");
    expect(page).toContain('"/chapter/$translation/$book/$chapter"');
    expect(page).not.toMatch(/\bsetTranslation\b|supabase|useServerFn|localStorage\.setItem/);
  });

  it("opens the saved reading position and offers honest bar labels", () => {
    expect(page).toContain("getStoredLastRead()");
    expect(page).toContain('"Continue reading"');
    expect(page).toContain('"Open chapter"');
    expect(page).toContain('"Start reading"');
  });

  it("is connected from the chapter reader", () => {
    const chapter = read("src/routes/chapter.$translation.$book.$chapter.tsx");
    // The chapter pill in the reading controls opens the index (the old top header was removed).
    expect(chapter).toContain('to: "/books"');
    expect(chapter).toContain("onOpenChapters={() =>");
  });

  it("has no top header and shows the tab bar", () => {
    const books = read("src/routes/books.tsx");
    expect(books).not.toContain("<ChapterTopBar");
    expect(books).toContain("<BottomNav />");
  });
});

describe("book index pieces (server-rendered markup)", () => {
  const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(element);
  const romans = BIBLE_BOOKS.find((book) => book.id === "romans")!;

  it("renders tabs with counts and the selected state", () => {
    const markup = html(
      createElement(TestamentTabs, {
        value: "nt",
        counts: { ot: 39, nt: 27 },
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain("Old Testament (39)");
    expect(markup).toContain("New Testament (27)");
    expect(markup).toContain('aria-selected="true"');
  });

  it("renders category chips with the active one pressed", () => {
    const markup = html(
      createElement(CategoryChips, {
        groups: groupsOf("nt"),
        active: "pauline",
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain("Gospels &amp; Acts");
    expect(markup).toContain("Pauline Epistles");
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("renders the heading, a collapsed row and the continue bar", () => {
    expect(html(createElement(GroupHeading, { label: "Pauline Epistles", count: 14 }))).toContain(
      "14 Books",
    );
    const row = html(
      createElement(BookRow, { book: romans, kind: "Pauline Epistle", onSelect: () => undefined }),
    );
    expect(row).toContain("Romans");
    expect(row).toContain("16 Ch.");
    expect(row).toContain("Pauline Epistle");
    const bar = html(
      createElement(ContinueBarContent, { label: "Continue reading", target: "Romans 12" }),
    );
    expect(bar).toContain("Continue reading");
    expect(bar).toContain("Romans 12");
  });

  it("renders the book card with only the name, chapter count and chapter numbers", () => {
    const card = (selectedChapter: number | null, lastRead: string | null) =>
      html(
        createElement(BookCard, {
          book: romans,
          selectedChapter,
          onSelectChapter: () => undefined,
          lastRead,
          onClose: () => undefined,
        }),
      );
    const markup = card(12, "Last read: Romans 12");
    expect(markup.match(/Romans chapter \d+/g)).toHaveLength(16);
    expect(markup).toContain("16 Ch.");
    expect(markup).toContain("Chapter 12 active");
    expect(markup).toContain("Last read: Romans 12");
    // The author and date, theme, sample label and Book Intro were removed.
    expect(markup).not.toMatch(/Sample content|Written by|Faith, Grace|Book Intro|c\. 57 AD/i);
    const unread = card(null, null);
    expect(unread).not.toContain("Choose a chapter");
    expect(unread).toContain("Select Chapter");
    expect(unread).not.toContain("Chapter null");
    expect(unread).not.toContain("Not read yet");
  });

  it("the corner icon closes the open book", () => {
    const markup = html(
      createElement(BookCard, {
        book: romans,
        selectedChapter: null,
        onSelectChapter: () => undefined,
        lastRead: null,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('aria-label="Close Romans"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain("href=");
    // An upward chevron, not the open-book icon.
    expect(markup).toContain("M18 15l-6-6-6 6");
    expect(markup).not.toContain("M12 6.042A8.967");
    const page = read("src/routes/books.tsx");
    expect(page).toMatch(/onClose=\{\(\) => \{\s*setExpandedId\(null\);/);
  });

  it("switches the search button between microphone and clear", () => {
    const empty = html(
      createElement(BookSearchField, {
        value: "",
        onChange: () => undefined,
        onMic: () => undefined,
        listening: false,
      }),
    );
    expect(empty).toContain("Search books by voice");
    const typed = html(
      createElement(BookSearchField, {
        value: "rom",
        onChange: () => undefined,
        onMic: () => undefined,
        listening: false,
      }),
    );
    expect(typed).toContain("Clear search");
    expect(typed).not.toContain("by voice");
  });
});

describe("books start closed", () => {
  it("switching testament or category leaves every book closed", () => {
    const page = read("src/routes/books.tsx");
    const body = /const enterGroup = [\s\S]*?\n {2}\};/.exec(page)?.[0] ?? "";
    expect(body).toContain("setExpandedId(null)");
    expect(body).toContain("setSelectedChapter(null)");
    expect(body).not.toContain("chooseBook");
  });

  it("nothing is open on arrival unless the address names a book or one was read last", () => {
    const page = read("src/routes/books.tsx");
    expect(page).toContain("useState<string | null>(search.book ?? null)");
    expect(page).toContain("search.book ?? stored?.bookId ?? null");
  });
});

describe("chapter numbers open with one tap", () => {
  it("tapping a chapter opens it immediately, without a separate select step", () => {
    const page = read("src/routes/books.tsx");
    expect(page).toMatch(/onSelectChapter=\{\(chapter\) => openChapter\(book\.id, chapter\)\}/);
    expect(page).not.toMatch(/if \(chapter === selectedChapter\)/);
  });
});
