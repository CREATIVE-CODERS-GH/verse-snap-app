import { describe, expect, it } from "vitest";
import { chapterQueue, singleQueue, stepIndex } from "./queue";

const psalm23 = {
  id: "reader",
  translation: "KJAV",
  bookId: "psalms",
  bookName: "Psalm",
  chapter: 23,
  verses: [
    { verse: 1, text: "The LORD is my shepherd; I shall not want." },
    { verse: 2, text: "  He maketh me to lie down in green pastures.  " },
    { verse: 3, text: "" },
    { verse: 4, text: "Yea, though I walk through the valley…" },
  ],
};

describe("chapterQueue", () => {
  it("reads the chapter title once, then each verse's text without verse numbers", () => {
    const queue = chapterQueue(psalm23);
    expect(queue.label).toBe("Psalm 23");
    expect(queue.items.map((item) => item.text)).toEqual([
      "Psalm 23",
      "The LORD is my shepherd; I shall not want.",
      "He maketh me to lie down in green pastures.",
      "Yea, though I walk through the valley…",
    ]);
  });

  it("keeps the verse number of each item for highlighting, and skips empty verses", () => {
    const queue = chapterQueue(psalm23);
    expect(queue.items.map((item) => item.verse)).toEqual([null, 1, 2, 4]);
  });

  it("remembers which chapter and translation it came from", () => {
    expect(chapterQueue(psalm23).chapter).toEqual({
      translation: "KJAV",
      bookId: "psalms",
      chapter: 23,
    });
  });

  it("never rewrites the Scripture text it is given", () => {
    const text = "In the beginning God created the heaven and the earth.";
    const queue = chapterQueue({ ...psalm23, verses: [{ verse: 1, text }] });
    expect(queue.items[1]?.text).toBe(text);
  });
});

describe("singleQueue and stepIndex", () => {
  it("wraps one piece of text exactly as given", () => {
    const queue = singleQueue("abc", "John 3:16. For God so loved the world");
    expect(queue.id).toBe("abc");
    expect(queue.chapter).toBeNull();
    expect(queue.items).toEqual([{ text: "John 3:16. For God so loved the world", verse: null }]);
  });

  it("steps forward and back and refuses to run off either end", () => {
    const queue = chapterQueue(psalm23);
    expect(stepIndex(queue, 0, 1)).toBe(1);
    expect(stepIndex(queue, 3, 1)).toBeNull();
    expect(stepIndex(queue, 1, -1)).toBe(0);
    expect(stepIndex(queue, 0, -1)).toBeNull();
  });
});
