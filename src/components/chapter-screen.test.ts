import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as parts from "@/components/chapter-reader-parts";
import {
  ChapterHeading,
  ChapterToast,
  SampleBadge,
  VerseBlock,
} from "@/components/chapter-reader-parts";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import { bookLabel, shortBookName } from "@/lib/bible/book-labels";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const PAGE = "src/routes/chapter.$translation.$book.$chapter.tsx";

describe("chapter reader page keeps the existing behaviour", () => {
  const page = read(PAGE);

  it("keeps the chapter query, last-read tracking and error handling", () => {
    for (const needle of [
      'queryKey: ["chapter", params.translation, params.book, params.chapter]',
      "bibleService.getChapter(ref, params.translation)",
      "setLastRead({ translation: params.translation, bookId: params.book, chapter: chapterNumber })",
      "You’re offline, and this chapter isn’t saved on this device yet.",
      "Verse Snap couldn’t reach the Bible. Check your connection and try again.",
      "query.refetch()",
      "BIBLE_BOOKS.findIndex",
      "previousBook.chapters",
      "nextBook",
    ]) {
      expect(page, needle).toContain(needle);
    }
  });

  it("keeps the translation in the URL only and never touches data layers", () => {
    expect(page).toContain("params: { ...params, translation: code }");
    expect(page).not.toMatch(/\bsetTranslation\b|supabase|useServerFn/);
    // The only data layer the page uses is the existing saved-verses library (Bookmark Verse).
    const libraryCalls = [...page.matchAll(/library\.(\w+)/g)].map((match) => match[1]);
    expect(new Set(libraryCalls)).toEqual(new Set(["isSaved", "save", "unsave"]));
  });

  it("keeps the verse number as a link to the verse page and keeps the text-size preference", () => {
    expect(page).toContain('"/verse/$translation/$book/$chapter/$verse"');
    expect(page).toContain("usePreferences()");
    expect(page).toContain("setTextSize");
  });

  it("is honest about unconnected features", () => {
    expect(page).toContain("preview only — not saved yet");
    // Nothing in the interface-state handlers writes to storage or a server.
    expect(page).not.toMatch(/localStorage|sessionStorage|\bfetch\(|\.insert\(|\.upsert\(/);
  });

  it("uses the shared brand colour system and the text-size scale", () => {
    const css = read("src/styles.css");
    // The chapter-reader tokens are aliases of the one brand palette (owner-approved).
    expect(css).toContain("--brand-canvas: #ffffff;");
    expect(css).toContain("--brand-canvas: #121212;");
    expect(css).toContain("--brand-primary: #1f5f4a;");
    expect(css).toContain("--ch-surface: var(--brand-canvas);");
    expect(css).toContain("--ch-primary: var(--brand-primary);");
    expect(css).toContain("--chapter-size: 1.25rem;");
    expect(css).toContain("@utility scripture-chapter");
  });
});

describe("chapter reader follows the owner-approved trimmed design", () => {
  const page = read(PAGE);

  it("no longer shows the removed sections", () => {
    // Hero image, book label and summary, progress caption, inline sample headings,
    // Pause & Reflect and Study Notes were removed on purpose by the project owner.
    expect(page).not.toMatch(
      /ChapterHero|ProgressCaption|SectionHeadingBlock|ReflectCard|StudyNotes|getChapterEditorial/,
    );
    for (const removed of [
      "ChapterHero",
      "ProgressCaption",
      "SectionHeadingBlock",
      "ReflectCard",
      "StudyNotes",
    ]) {
      expect(parts, removed).not.toHaveProperty(removed);
    }
  });

  it("has no top header: the reading controls are the top bar, and the tab bar is shown", () => {
    expect(page).not.toContain("<ChapterTopBar");
    expect(page).toContain("<ChapterControls");
    expect(page).toContain("onOpenTranslations={() => setTranslationsOpen(true)}");
    expect(page).toContain("<BottomNav />");
  });

  it("marks a verse on the first tap and opens the options on the second", () => {
    expect(page).toContain("const tapVerse = (number: number) =>");
    expect(page).toContain("if (markedVerse === number)");
    expect(page).toContain('"Double-tap for more options"');
    expect(page).not.toContain("<SelectionFooter");
  });

  it("opens the Reflection Journal from Add Reflection, carrying the verse and highlight", () => {
    expect(page).toContain('to: "/reflect/$translation/$book/$chapter/$verse"');
    expect(page).toContain(
      'search: chosenTone && chosenTone !== "clear" ? { tone: chosenTone } : {}',
    );
  });
});

describe("book labels", () => {
  it("builds a label and a short name for every book", () => {
    for (const book of BIBLE_BOOKS) {
      expect(bookLabel(book).length, book.id).toBeGreaterThan(5);
      expect(shortBookName(book).length, book.id).toBeGreaterThan(1);
    }
  });

  it("matches the approved examples", () => {
    const get = (id: string) => BIBLE_BOOKS.find((book) => book.id === id)!;
    expect(bookLabel(get("romans"))).toBe("Paul’s Letter to the Romans");
    expect(bookLabel(get("1corinthians"))).toBe("Paul’s First Letter to the Corinthians");
    expect(bookLabel(get("2timothy"))).toBe("Paul’s Second Letter to Timothy");
    expect(bookLabel(get("titus"))).toBe("Paul’s Letter to Titus");
    expect(bookLabel(get("john"))).toBe("The Gospel According to John");
    expect(bookLabel(get("3john"))).toBe("The Third Letter of John");
    expect(bookLabel(get("genesis"))).toBe("The Book of Genesis");
    expect(bookLabel(get("1samuel"))).toBe("The First Book of Samuel");
    expect(shortBookName(get("romans"))).toBe("Rom");
    expect(shortBookName(get("1corinthians"))).toBe("1 Cor");
    expect(shortBookName(get("john"))).toBe("John");
    expect(shortBookName(get("matthew"))).toBe("Matt");
  });
});

describe("chapter reader pieces (server-rendered markup)", () => {
  const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(element);

  it("labels sample content", () => {
    expect(html(createElement(SampleBadge))).toContain("Sample content");
  });

  it("renders only the chapter number as the heading", () => {
    const heading = html(createElement(ChapterHeading, { chapter: 12 }));
    expect(heading).toContain("Chapter 12");
    expect(heading).not.toMatch(/Letter to|Gospel|Sample content/i);
  });

  it("renders a drop cap that screen readers still read as part of the word", () => {
    const markup = html(
      createElement(VerseBlock, {
        number: 1,
        text: "Therefore, I urge you",
        selected: false,
        dropCap: true,
        onSelect: () => undefined,
        numberNode: createElement("sup", null, "1"),
      }),
    );
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("sr-only");
    expect(markup).toContain("herefore, I urge you");
    const plain = html(
      createElement(VerseBlock, {
        number: 2,
        text: "Do not conform",
        selected: true,
        onSelect: () => undefined,
        numberNode: createElement("sup", null, "2"),
      }),
    );
    expect(plain).toContain('data-selected="true"');
    expect(plain).not.toContain("float-left");
  });

  it("shows a marked verse with the selection bar but keeps it tappable", () => {
    const marked = html(
      createElement(VerseBlock, {
        number: 3,
        text: "For I say",
        selected: false,
        marked: true,
        onSelect: () => undefined,
        numberNode: createElement("sup", null, "3"),
      }),
    );
    expect(marked).toContain('data-marked="true"');
    expect(marked).toContain("bg-ch-primary");
    expect(marked).toContain('tabindex="0"');
    expect(marked).not.toContain('data-selected="true"');
  });

  it("renders the toast with its message and hides it when not visible", () => {
    expect(
      html(createElement(ChapterToast, { message: "Double-tap for more options", visible: true })),
    ).toContain("Double-tap for more options");
    expect(html(createElement(ChapterToast, { message: "x", visible: false }))).toContain(
      "opacity-0",
    );
  });
});
