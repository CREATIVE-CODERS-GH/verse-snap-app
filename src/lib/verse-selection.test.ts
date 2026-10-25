import { describe, expect, it } from "vitest";
import type { Reflection } from "@/lib/journal";
import { reflectionsByVerse, selectionLabel, toggleVerse } from "./verse-selection";

const note = (translation: string, bookId: string, chapter: number, verse: number): Reflection => ({
  id: `${translation}-${bookId}-${chapter}-${verse}`,
  translation,
  bookId,
  chapter,
  verse,
  notebookId: "general",
  title: "",
  body: "x",
  tags: [],
  posture: null,
  isPrivate: true,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
});

describe("verse selection", () => {
  it("adds verses in any order and keeps them sorted, consecutive or not", () => {
    let chosen: number[] = [];
    for (const verse of [7, 2, 3, 12]) chosen = toggleVerse(chosen, verse);
    expect(chosen).toEqual([2, 3, 7, 12]);
  });

  it("removes a verse that is chosen again, and does not change the list it was given", () => {
    const before = [2, 5];
    expect(toggleVerse(before, 5)).toEqual([2]);
    expect(toggleVerse([5], 5)).toEqual([]);
    expect(before).toEqual([2, 5]);
  });

  it("says how many verses are selected", () => {
    expect(selectionLabel(1)).toBe("1 verse selected");
    expect(selectionLabel(3)).toBe("3 verses selected");
  });

  it("finds only this chapter's reflections in this translation", () => {
    const all = [
      note("KJAV", "john", 3, 16),
      note("WEB", "john", 3, 16),
      note("KJAV", "john", 4, 1),
      note("KJAV", "mark", 3, 2),
      note("KJAV", "john", 3, 3),
    ];
    const found = reflectionsByVerse(all, "KJAV", "john", 3);
    expect([...found.keys()].sort((a, b) => a - b)).toEqual([3, 16]);
    expect(found.get(16)?.translation).toBe("KJAV");
    expect(reflectionsByVerse([], "KJAV", "john", 3).size).toBe(0);
  });
});
