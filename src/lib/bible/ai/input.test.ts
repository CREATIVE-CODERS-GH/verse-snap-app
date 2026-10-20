import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, checkQuery, searchInputSchema } from "./input";

describe("checkQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(checkQuery("  love   is \n patient ")).toEqual({ ok: true, query: "love is patient" });
  });

  it("enforces the 200-character limit exactly", () => {
    expect(MAX_QUERY_LENGTH).toBe(200);
    expect(checkQuery("a".repeat(200))).toMatchObject({ ok: true });
    const tooLong = checkQuery("a".repeat(201));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.message).toContain("200");
  });

  it("measures the limit after trimming", () => {
    expect(checkQuery(`   ${"a".repeat(200)}   `)).toMatchObject({ ok: true });
  });

  it("rejects empty and one-character searches", () => {
    for (const value of ["", " ", "a", "  x  "]) {
      expect(checkQuery(value).ok).toBe(false);
    }
  });

  it("rejects control characters but accepts normal punctuation and non-English text", () => {
    expect(checkQuery("hello\u0000world").ok).toBe(false);
    expect(checkQuery("bad\u007fchar").ok).toBe(false);
    expect(checkQuery('the Lord\'s "light" — ¿dónde está? 愛').ok).toBe(true);
  });
});

describe("searchInputSchema", () => {
  it("accepts a query with an optional translation", () => {
    expect(searchInputSchema.parse({ query: "x", translation: "BSB" })).toEqual({
      query: "x",
      translation: "BSB",
    });
    expect(searchInputSchema.parse({ query: "x" })).toEqual({ query: "x" });
  });

  it("rejects non-string queries, missing queries, and absurdly large payloads", () => {
    expect(() => searchInputSchema.parse({ query: 42 })).toThrow();
    expect(() => searchInputSchema.parse({})).toThrow();
    expect(() => searchInputSchema.parse(null)).toThrow();
    expect(() => searchInputSchema.parse({ query: "a".repeat(2001) })).toThrow();
  });

  it("keeps the translation bounds the app already used", () => {
    expect(() => searchInputSchema.parse({ query: "x", translation: "A" })).toThrow();
    expect(() => searchInputSchema.parse({ query: "x", translation: "A".repeat(13) })).toThrow();
  });
});
