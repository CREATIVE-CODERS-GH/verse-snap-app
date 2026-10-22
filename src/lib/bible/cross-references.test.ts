import { describe, expect, it, vi } from "vitest";
import { BIBLE_BOOKS, fromApiBookId, toApiBookId } from "./books";
import {
  CrossReferenceError,
  fetchChapterCrossRefs,
  fitPassage,
  groupByTestament,
  parseChapterCrossRefs,
  passageLabel,
  rankPassages,
  testamentOf,
  toChips,
  type CrossPassage,
} from "./cross-references";

const chapterFile = (content: unknown[]) => ({
  dataset: "open-cross-ref",
  chapter: { number: 12, content },
});

/** A slice of the real Romans 12:2 entry (scores as the dataset gives them). */
const ROMANS_12_2 = chapterFile([
  {
    verse: 2,
    references: [
      { book: "1PE", chapter: 1, verse: 14, score: 544 },
      { book: "EPH", chapter: 4, verse: 22, endVerse: 24, score: 510 },
      { book: "2CO", chapter: 5, verse: 17, score: 429 },
      { book: "1JN", chapter: 2, verse: 15, endVerse: 17, score: 354 },
      { book: "PSA", chapter: 51, verse: 10, score: 60 },
    ],
  },
]);

const passage = (over: Partial<CrossPassage>): CrossPassage => ({
  book: "john",
  bookName: "John",
  chapter: 3,
  from: 16,
  to: 16,
  score: 10,
  ...over,
});

describe("book mappings", () => {
  it("maps every book to its API code and back", () => {
    expect(BIBLE_BOOKS).toHaveLength(66);
    for (const book of BIBLE_BOOKS) {
      const code = toApiBookId(book.id);
      expect(code, book.id).toBeTruthy();
      expect(fromApiBookId(code!)?.id, book.id).toBe(book.id);
    }
  });

  it("reads representative codes from the dataset", () => {
    expect(fromApiBookId("1PE")?.id).toBe("1peter");
    expect(fromApiBookId("PSA")?.id).toBe("psalms");
    expect(fromApiBookId("JHN")?.id).toBe("john");
    expect(fromApiBookId("REV")?.id).toBe("revelation");
    expect(fromApiBookId("XXX")).toBeUndefined();
  });
});

describe("parsing a chapter file", () => {
  it("maps real entries, keeps ranges and ranks by score", () => {
    const map = parseChapterCrossRefs(ROMANS_12_2, "romans", 12);
    const list = map.get(2)!;
    expect(list.map((item) => passageLabel(item))).toEqual([
      "1 Peter 1:14",
      "Ephesians 4:22–24",
      "2 Corinthians 5:17",
      "1 John 2:15–17",
      "Psalms 51:10",
    ]);
    expect(list[1]).toMatchObject({ book: "ephesians", from: 22, to: 24, score: 510 });
    expect(list.map((item) => item.score)).toEqual([544, 510, 429, 354, 60]);
  });

  it("drops what cannot be a real passage", () => {
    const map = parseChapterCrossRefs(
      chapterFile([
        {
          verse: 1,
          references: [
            { book: "XXX", chapter: 1, verse: 1, score: 9 },
            { book: "JHN", chapter: 99, verse: 1, score: 9 },
            { book: "JHN", chapter: 3, verse: 0, score: 9 },
            { book: "JHN", chapter: 3, verse: 16, score: 0 },
            { book: "JHN", chapter: 3, verse: 17, score: -4 },
            { book: "JHN", chapter: 3, verse: "18", score: 9 },
            { book: "ROM", chapter: 8, verse: 28, score: 7 },
          ],
        },
        { verse: "x", references: [] },
        { verse: 2 },
      ]),
      "john",
      1,
    );
    expect(map.get(1)!.map((item) => passageLabel(item))).toEqual(["Romans 8:28"]);
    expect(map.has(2)).toBe(false);
  });

  it("treats an end verse that is not after the start as a single verse", () => {
    const map = parseChapterCrossRefs(
      chapterFile([
        { verse: 1, references: [{ book: "ROM", chapter: 8, verse: 28, endVerse: 20, score: 5 }] },
      ]),
      "john",
      1,
    );
    expect(map.get(1)![0]).toMatchObject({ from: 28, to: 28 });
  });

  it("keeps the best score when a passage is listed twice, and never relates a verse to itself", () => {
    const map = parseChapterCrossRefs(
      chapterFile([
        {
          verse: 16,
          references: [
            { book: "ROM", chapter: 5, verse: 8, score: 3 },
            { book: "ROM", chapter: 5, verse: 8, score: 11 },
            { book: "JHN", chapter: 3, verse: 16, score: 99 },
            { book: "JHN", chapter: 3, verse: 14, endVerse: 18, score: 50 },
            { book: "JHN", chapter: 3, verse: 17, score: 8 },
          ],
        },
      ]),
      "john",
      3,
    );
    const list = map.get(16)!;
    expect(list.map((item) => passageLabel(item))).toEqual(["Romans 5:8", "John 3:17"]);
    expect(list[0]!.score).toBe(11);
  });

  it("breaks ties by Bible order", () => {
    const map = parseChapterCrossRefs(
      chapterFile([
        {
          verse: 1,
          references: [
            { book: "MAT", chapter: 5, verse: 3, score: 7 },
            { book: "GEN", chapter: 1, verse: 1, score: 7 },
            { book: "EXO", chapter: 3, verse: 14, score: 7 },
          ],
        },
      ]),
      "john",
      1,
    );
    expect(map.get(1)!.map((item) => item.book)).toEqual(["genesis", "exodus", "matthew"]);
  });

  it("rejects a file that is not a chapter of cross-references", () => {
    for (const bad of [null, {}, { chapter: {} }, { chapter: { content: "no" } }, "x"]) {
      expect(() => parseChapterCrossRefs(bad, "john", 3)).toThrow(CrossReferenceError);
    }
  });
});

describe("ranking, grouping and chips", () => {
  const list = [
    passage({ book: "ephesians", bookName: "Ephesians", chapter: 4, from: 22, to: 24, score: 510 }),
    passage({ book: "isaiah", bookName: "Isaiah", chapter: 26, from: 3, to: 3, score: 400 }),
    passage({ book: "romans", bookName: "Romans", chapter: 8, from: 1, to: 1, score: 300 }),
    passage({ book: "psalms", bookName: "Psalms", chapter: 23, from: 1, to: 1, score: 200 }),
  ];

  it("shows the best few and says how many there are in all", () => {
    expect(rankPassages(list, 2)).toEqual({ items: list.slice(0, 2), total: 4 });
    expect(rankPassages(list, 99).items).toHaveLength(4);
    expect(rankPassages(list, 0)).toEqual({ items: [], total: 4 });
    expect(rankPassages([], 5)).toEqual({ items: [], total: 0 });
  });

  it("groups by testament, the testament with the strongest match first, rank kept", () => {
    const groups = groupByTestament(list);
    expect(groups.map((group) => group.title)).toEqual(["New Testament", "Old Testament"]);
    expect(groups[0]!.passages.map((item) => item.book)).toEqual(["ephesians", "romans"]);
    expect(groups[1]!.passages.map((item) => item.book)).toEqual(["isaiah", "psalms"]);
    expect(groupByTestament(list.slice(1, 2)).map((group) => group.id)).toEqual(["ot"]);
    expect(groupByTestament([])).toEqual([]);
  });

  it("labels passages and testaments", () => {
    expect(passageLabel(list[0]!)).toBe("Ephesians 4:22–24");
    expect(passageLabel(list[1]!)).toBe("Isaiah 26:3");
    expect(testamentOf("isaiah")).toBe("OT");
    expect(testamentOf("romans")).toBe("NT");
    expect(testamentOf("nope")).toBeUndefined();
  });

  it("makes chips that open the first verse of each passage", () => {
    const chips = toChips(list, 2);
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject({
      label: "Ephesians 4:22–24",
      hint: "NT",
      dot: "primary",
      target: { book: "ephesians", chapter: 4, verse: 22 },
    });
    expect(chips[1]).toMatchObject({ hint: "OT", dot: "secondary" });
  });
});

describe("fetching a chapter", () => {
  const ok = (body: unknown) =>
    vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    ) as unknown as typeof fetch;

  it("asks for the right file and parses it", async () => {
    const fetchMock = ok(ROMANS_12_2);
    const map = await fetchChapterCrossRefs("romans", 12, fetchMock);
    expect(map.get(2)).toHaveLength(5);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "https://bible.helloao.org/api/d/open-cross-ref/ROM/12.json",
    );
  });

  it("treats a missing chapter file as no cross-references", async () => {
    const missing = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect((await fetchChapterCrossRefs("romans", 12, missing)).size).toBe(0);
  });

  it("does not ask for a book or chapter that does not exist", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    expect((await fetchChapterCrossRefs("nope", 1, fetchMock)).size).toBe(0);
    expect((await fetchChapterCrossRefs("john", 99, fetchMock)).size).toBe(0);
    expect((await fetchChapterCrossRefs("john", 0, fetchMock)).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failed request, a server error and bad data as typed errors", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await expect(fetchChapterCrossRefs("john", 3, down)).rejects.toMatchObject({ kind: "network" });
    const broken = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchChapterCrossRefs("john", 3, broken)).rejects.toMatchObject({
      kind: "network",
    });
    const notJson = vi.fn(
      async () => new Response("<html>", { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(fetchChapterCrossRefs("john", 3, notJson)).rejects.toMatchObject({ kind: "data" });
    await expect(fetchChapterCrossRefs("john", 3, ok({ nope: true }))).rejects.toMatchObject({
      kind: "data",
    });
  });
});

describe("passages that run past a chapter's end", () => {
  it("clamps the end verse, marks a passage that starts too late as unavailable, and leaves the rest alone", () => {
    const rev15 = passage({
      book: "revelation",
      bookName: "Revelation",
      chapter: 15,
      from: 6,
      to: 21,
    });
    // Revelation 15 has 8 verses: 6–21 becomes 6–8.
    const clamped = fitPassage(rev15, 8);
    expect(clamped.available).toBe(true);
    expect(passageLabel(clamped.passage)).toBe("Revelation 15:6–8");
    expect(clamped.passage.score).toBe(rev15.score);
    // Romans 16:27 in an edition whose chapter ends at verse 25: not there.
    const doxology = passage({ book: "romans", bookName: "Romans", chapter: 16, from: 27, to: 27 });
    expect(fitPassage(doxology, 25).available).toBe(false);
    // A range that fits, and a chapter that has not loaded yet, are kept as they are.
    expect(fitPassage(rev15, 21)).toEqual({ available: true, passage: rev15 });
    expect(fitPassage(rev15, undefined)).toEqual({ available: true, passage: rev15 });
    // The last verse itself is available.
    expect(fitPassage(passage({ from: 25, to: 25 }), 25).available).toBe(true);
  });
});
