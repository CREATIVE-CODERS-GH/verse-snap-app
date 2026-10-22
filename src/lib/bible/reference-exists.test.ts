import { describe, expect, it, vi } from "vitest";
import { parseReference } from "./parse-reference";
import { referenceExists } from "./reference-exists";
import { BibleServiceError, type Verse } from "./types";

const verse = { verse: 25 } as Verse;
const ref = (text: string) => {
  const parsed = parseReference(text);
  if (!parsed) throw new Error(text);
  return parsed;
};

describe("referenceExists", () => {
  it("is true when the verse is found", async () => {
    expect(await referenceExists(ref("John 3:16"), "BSB", async () => verse)).toBe(true);
  });

  it("is false when the chapter has no such verse", async () => {
    const getVerse = vi.fn(async () => null);
    expect(await referenceExists(ref("Hebrews 5:25"), "BSB", getVerse)).toBe(false);
    expect(getVerse).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "hebrews", chapter: 5, verse: 25 }),
      "BSB",
    );
  });

  it("does not look up chapter-only references", async () => {
    const getVerse = vi.fn(async () => null);
    expect(await referenceExists(ref("Psalm 23"), "BSB", getVerse)).toBe(true);
    expect(getVerse).not.toHaveBeenCalled();
  });

  it("lets the reader handle lookup failures", async () => {
    const failing = async () => {
      throw new BibleServiceError("network", "offline");
    };
    expect(await referenceExists(ref("John 3:16"), "BSB", failing)).toBe(true);
  });
});
