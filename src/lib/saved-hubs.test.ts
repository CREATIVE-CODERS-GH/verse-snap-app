import { describe, expect, it } from "vitest";
import type { Reflection } from "@/lib/journal";
import {
  matchesShelf,
  notesOnVerse,
  parseSavedTab,
  relativeTime,
  SEARCH_PLACEHOLDERS,
  tagCounts,
  verseReference,
} from "./saved-hubs";

const note = (over: Partial<Reflection>): Reflection => ({
  id: "n",
  translation: "KJAV",
  bookId: "john",
  chapter: 3,
  verse: 16,
  notebookId: "general",
  title: "",
  body: "x",
  tags: [],
  posture: null,
  isPrivate: true,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  ...over,
});

describe("Saved hubs helpers", () => {
  it("reads the tab from the address, defaulting to Verses", () => {
    expect(parseSavedTab("highlights")).toBe("highlights");
    expect(parseSavedTab("notes")).toBe("notes");
    expect(parseSavedTab("verses")).toBe("verses");
    expect(parseSavedTab("collections")).toBe("verses");
    expect(parseSavedTab(undefined)).toBe("verses");
  });

  it("has a search placeholder for each hub", () => {
    expect(SEARCH_PLACEHOLDERS.verses).toMatch(/saved verses/);
    expect(SEARCH_PLACEHOLDERS.highlights).toMatch(/highlighted/);
    expect(SEARCH_PLACEHOLDERS.notes).toMatch(/thoughts/);
  });

  it("groups verses into the shelves by book", () => {
    expect(matchesShelf("genesis", "all")).toBe(true);
    expect(matchesShelf("genesis", "ot")).toBe(true);
    expect(matchesShelf("genesis", "nt")).toBe(false);
    expect(matchesShelf("john", "nt")).toBe(true);
    expect(matchesShelf("john", "gospels")).toBe(true);
    expect(matchesShelf("romans", "gospels")).toBe(false);
    expect(matchesShelf("romans", "nt")).toBe(true);
  });

  it("names a verse", () => {
    expect(verseReference({ bookId: "john", chapter: 3, verse: 16 })).toBe("John 3:16");
    expect(verseReference({ bookId: "1corinthians", chapter: 13, verse: 4 })).toBe(
      "1 Corinthians 13:4",
    );
  });

  it("says how long ago, in the Stitch style", () => {
    const now = new Date("2026-10-22T12:00:00");
    expect(relativeTime("2026-10-22T11:59:40", now)).toBe("just now");
    expect(relativeTime("2026-10-22T11:55:00", now)).toBe("5 min ago");
    expect(relativeTime("2026-10-22T11:00:00", now)).toBe("1 hr ago");
    expect(relativeTime("2026-10-22T09:30:00", now)).toBe("2 hrs ago");
    expect(relativeTime("2026-10-21T20:00:00", now)).toBe("Yesterday");
    expect(relativeTime("2026-10-10T08:00:00", now)).toBe("Oct 10");
    expect(relativeTime("not a date", now)).toBe("");
  });

  it("finds the notes on a verse in any translation, newest first", () => {
    const all = [
      note({ id: "a", updatedAt: "2026-10-20T00:00:00.000Z" }),
      note({ id: "b", translation: "WEB", updatedAt: "2026-10-22T00:00:00.000Z" }),
      note({ id: "c", verse: 17 }),
      note({ id: "d", chapter: 4 }),
    ];
    expect(notesOnVerse(all, { bookId: "john", chapter: 3, verse: 16 }).map((x) => x.id)).toEqual([
      "b",
      "a",
    ]);
    expect(notesOnVerse([], { bookId: "john", chapter: 3, verse: 16 })).toEqual([]);
  });

  it("counts tags, most used first (ties A to Z), once per note, with a limit", () => {
    const all = [
      note({ id: "1", tags: ["grace", "faith", "grace"] }),
      note({ id: "2", tags: ["grace"] }),
      note({ id: "3", tags: ["faith", "hope"] }),
    ];
    expect(tagCounts(all)).toEqual([
      { tag: "faith", count: 2 },
      { tag: "grace", count: 2 },
      { tag: "hope", count: 1 },
    ]);
    expect(tagCounts(all, 1)).toEqual([{ tag: "faith", count: 2 }]);
  });
});
