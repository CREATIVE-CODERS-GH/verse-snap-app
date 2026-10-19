import { describe, expect, it } from "bun:test";
import { searchIndex, oneTypo } from "./lexical-search";
import { classifyQuery } from "./classify-query";

const index = {
  editions: { KJAV: 3, WEB: 3 },
  refs: ["1CO:13:4", "ROM:12:2", "PHP:4:6"],
  terms: {
    love: [0],
    patient: [0],
    charity: [0],
    suffereth: [0],
    long: [0],
    renewing: [1],
    mind: [1],
    anxious: [2],
    nothing: [2],
  },
};
describe("Cross-translation Bible search", () => {
  it("finds modern wording and King James wording at the same reference", () => {
    expect(searchIndex(index, "love is patient")[0].bookId).toBe("1corinthians");
    expect(searchIndex(index, "charity suffereth long")[0].verse).toBe(4);
  });
  it("matches remembered wording despite a misspelling", () => {
    expect(searchIndex(index, "renewign your mind")[0].bookId).toBe("romans");
    expect(searchIndex(index, "love is paitent")[0].verse).toBe(4);
  });
  it("rejects words that are not in scripture rather than inventing a result", () => {
    expect(searchIndex(index, "spaceship teleportation")).toEqual([]);
  });
  it("handles a single search word", () => {
    expect(searchIndex(index, "anxious")[0].bookId).toBe("philippians");
  });
  it("keeps direct references separate from description search", () => {
    expect(classifyQuery("John 3:16").kind).toBe("reference");
    expect(classifyQuery("find the verse about renewing your mind").kind).toBe("description");
  });
  it("allows one typo but not unrelated words", () => {
    expect(oneTypo("patient", "paitent")).toBe(true);
    expect(oneTypo("patient", "patience")).toBe(false);
  });
  it("ranks an adjacent remembered phrase above scattered matching words", () => {
    const phrases = {
      editions: {},
      refs: ["1TI:3:3", "1CO:13:4"],
      terms: { love: [0, 1], patient: [0, 1], "is patient": [1] },
    };
    expect(searchIndex(phrases, "love is patient")[0].bookId).toBe("1corinthians");
  });
});
