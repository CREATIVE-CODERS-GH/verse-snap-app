import { describe, expect, it, vi } from "vitest";
import { MAX_RESULTS } from "./prompt";
import { resolveAndRank, score } from "./rank";
import type { Verse, VerseRef } from "../types";

function verse(ref: VerseRef, text: string, translation = "KJAV"): Verse {
  return { ...ref, translation, text, reference: `${ref.bookName} ${ref.chapter}:${ref.verse}` };
}

const TEXTS: Record<string, string> = {
  "1corinthians-13-4": "Charity suffereth long, and is kind; charity envieth not.",
  "romans-12-9": "Let love be without dissimulation. Abhor that which is evil.",
  "john-3-16": "For God so loved the world, that he gave his only begotten Son.",
};

function getVerseFrom(texts: Record<string, string>) {
  return vi.fn(async (ref: VerseRef, translation: string) => {
    const text = texts[`${ref.bookId}-${ref.chapter}-${ref.verse}`];
    return text === undefined ? null : verse(ref, text, translation);
  });
}

describe("resolveAndRank", () => {
  it("returns only verses that exist, with text from the Bible source", async () => {
    const getVerse = getVerseFrom(TEXTS);
    const results = await resolveAndRank(
      "love is patient",
      "KJAV",
      [
        { book: "1 Corinthians", chapter: 13, verse: 4 },
        { book: "Psalms", chapter: 23, verse: 1 }, // parses, but does not exist at the source
        { book: "Not A Book", chapter: 1, verse: 1 }, // does not parse
      ],
      getVerse,
    );
    expect(results.map((r) => r.reference)).toEqual(["1 Corinthians 13:4"]);
    expect(results[0]?.text).toBe(TEXTS["1corinthians-13-4"]);
    expect(getVerse).toHaveBeenCalledTimes(2); // the unparsable reference never reaches the source
  });

  it("looks each distinct verse up once", async () => {
    const getVerse = getVerseFrom(TEXTS);
    await resolveAndRank(
      "x",
      "KJAV",
      [
        { book: "John", chapter: 3, verse: 16 },
        { book: "Jn", chapter: 3, verse: 16 },
        { book: "john", chapter: 3, verse: 16 },
      ],
      getVerse,
    );
    expect(getVerse).toHaveBeenCalledTimes(1);
  });

  it("leaves out a verse whose lookup fails, without failing the search", async () => {
    const getVerse = vi.fn(async (ref: VerseRef, translation: string) => {
      if (ref.bookId === "john") throw new Error("network");
      return verse(ref, TEXTS["romans-12-9"] ?? "", translation);
    });
    const results = await resolveAndRank(
      "x",
      "KJAV",
      [
        { book: "John", chapter: 3, verse: 16 },
        { book: "Romans", chapter: 12, verse: 9 },
      ],
      getVerse,
    );
    expect(results.map((r) => r.reference)).toEqual(["Romans 12:9"]);
  });

  it("keeps the order suggested by the model unless the wording clearly points elsewhere", async () => {
    const results = await resolveAndRank(
      "something about affection",
      "KJAV",
      [
        { book: "Romans", chapter: 12, verse: 9 },
        { book: "John", chapter: 3, verse: 16 },
      ],
      getVerseFrom(TEXTS),
    );
    expect(results.map((r) => r.reference)).toEqual(["Romans 12:9", "John 3:16"]);
  });

  it("lets an exact quotation outrank the model's order", async () => {
    const results = await resolveAndRank(
      "for God so loved the world",
      "KJAV",
      [
        { book: "Romans", chapter: 12, verse: 9 },
        { book: "John", chapter: 3, verse: 16 },
      ],
      getVerseFrom(TEXTS),
    );
    expect(results[0]?.reference).toBe("John 3:16");
  });

  it("returns at most the allowed number of results and the response fields the UI uses", async () => {
    const texts: Record<string, string> = {};
    const candidates = Array.from({ length: 12 }, (_, i) => {
      texts[`psalms-23-${i + 1}`] = `Verse ${i + 1}`;
      return { book: "Psalms", chapter: 23, verse: i + 1 };
    });
    const results = await resolveAndRank("x", "BSB", candidates, getVerseFrom(texts));
    expect(results).toHaveLength(MAX_RESULTS);
    expect(Object.keys(results[0]!).sort()).toEqual(
      ["bookId", "bookName", "chapter", "reference", "text", "translation", "verse"].sort(),
    );
    expect(results.every((r) => r.translation === "BSB")).toBe(true);
  });

  it("returns an empty list for no candidates", async () => {
    expect(await resolveAndRank("x", "KJAV", [], getVerseFrom(TEXTS))).toEqual([]);
  });
});

describe("score", () => {
  const v = verse(
    { bookId: "john", bookName: "John", chapter: 3, verse: 16 },
    TEXTS["john-3-16"] ?? "",
  );

  it("rewards an exact quotation most, then word overlap, then model order", () => {
    const exact = score("for God so loved the world", v, 5);
    const overlap = score("loved world gave", v, 0);
    const none = score("zzz qqq", v, 0);
    expect(exact).toBeGreaterThan(overlap);
    expect(overlap).toBeGreaterThan(none);
    expect(score("zzz qqq", v, 0)).toBeGreaterThan(score("zzz qqq", v, 5));
  });
});
