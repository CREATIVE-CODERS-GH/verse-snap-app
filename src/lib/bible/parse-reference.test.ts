import { describe, expect, it } from "vitest";
import golden from "./__fixtures__/reference-golden.json";
import { EVAL_QUERIES } from "./ai/live/eval-queries";
import { parseReference, parseReferenceOrBook, type ParsedReference } from "./parse-reference";

/** Compact form for table tests: "John 3:16", "Psalms 23:1-6", "Psalms 23-25", "John 3:16-4:2". */
function show(ref: ParsedReference | null): string | null {
  if (!ref) return null;
  const end =
    ref.endChapter !== undefined
      ? `-${ref.endChapter}${ref.endVerse !== undefined ? `:${ref.endVerse}` : ""}`
      : ref.endVerse !== undefined
        ? `-${ref.endVerse}`
        : "";
  const start = `${ref.bookName} ${ref.chapter}${ref.verse !== undefined ? `:${ref.verse}` : ""}`;
  return `${start}${end}`;
}

describe("backward compatibility (golden file)", () => {
  const entries = Object.entries(golden as Record<string, ParsedReference | null>);

  it("has a meaningful corpus", () => {
    expect(entries.length).toBeGreaterThan(1500);
    expect(entries.filter(([, value]) => value !== null).length).toBeGreaterThan(500);
  });

  it("returns exactly the same result for everything the original parser accepted", () => {
    const changed = entries
      .filter(([, expected]) => expected !== null)
      .map(([input, expected]) => ({ input, expected, actual: parseReference(input) }))
      .filter(({ expected, actual }) => JSON.stringify(actual) !== JSON.stringify(expected));
    expect(changed.slice(0, 10)).toEqual([]);
  });

  it("keeps the original results through parseReferenceOrBook as well", () => {
    const changed = entries
      .filter(([, expected]) => expected !== null)
      .filter(
        ([input, expected]) =>
          JSON.stringify(parseReferenceOrBook(input)) !== JSON.stringify(expected),
      );
    expect(changed.slice(0, 10)).toEqual([]);
  });
});

describe("verse and chapter ranges", () => {
  const cases: Array<[string, string | null]> = [
    ["psalms 23:1-6", "Psalms 23:1-6"],
    ["Psalm 23:1–6", "Psalms 23:1-6"],
    ["matt 5:3-12", "Matthew 5:3-12"],
    ["gen 1:1-3", "Genesis 1:1-3"],
    ["1 cor 13:4-7", "1 Corinthians 13:4-7"],
    ["john 3:16-18", "John 3:16-18"],
    ["john 3:16 to 18", "John 3:16-18"],
    ["john 3 16 to 18", "John 3:16-18"],
    ["john chapter 3 verses 16 through 18", "John 3:16-18"],
    ["john 3 verse 16-18", "John 3:16-18"],
    ["john 3:16-4:2", "John 3:16-4:2"],
    ["james 1 5 6", "James 1:5-6"],
    ["james 1:5,6", null],
    ["psalm chapters 23-25", "Psalms 23-25"],
    ["psalm chapter 23 to 25", "Psalms 23-25"],
    ["psalm 23 to 25", "Psalms 23-25"],
    ["romans 8-9", "Romans 8:9"], // "book C-V" has always meant verse ("John 3-16")
    ["john 3-16", "John 3:16"],
    ["john 3:16a", "John 3:16"],
    ["john 3:16b-18", "John 3:16-18"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} => ${expected}`, () => {
      expect(show(parseReference(input))).toBe(expected);
    });
  }

  it("rejects impossible ranges", () => {
    for (const input of [
      "john 3:18-16", // backwards
      "john 3:16-16",
      "john 3:16-3:10",
      "john 3:16-22:1", // John has 21 chapters
      "john 22:1-3",
      "psalm 25 to 23",
      "psalm 23:1-999",
      "john 3:0-5",
    ]) {
      expect(show(parseReference(input)), input).toBeNull();
    }
  });
});

describe("single-chapter books", () => {
  const cases: Array<[string, string | null]> = [
    ["3 john 4", "3 John 1:4"],
    ["third john 4", "3 John 1:4"],
    ["jude 5", "Jude 1:5"],
    ["jude 3-5", "Jude 1:3-5"],
    ["jude 3 5", "Jude 1:3-5"],
    ["jude 1:5", "Jude 1:5"],
    ["jude 1 5", "Jude 1:5"], // unchanged from the original parser
    ["obadiah 15", "Obadiah 1:15"],
    ["philemon 6", "Philemon 1:6"],
    ["2 john 6", "2 John 1:6"],
    ["jude", null], // a bare name is only accepted by parseReferenceOrBook
    ["jude 99999", null],
  ];
  for (const [input, expected] of cases) {
    it(`${input} => ${expected}`, () => expect(show(parseReference(input))).toBe(expected));
  }
});

describe("bare book names (parseReferenceOrBook)", () => {
  it("opens chapter 1 and marks the reference as book-only", () => {
    for (const [input, book] of [
      ["john", "John"],
      ["John", "John"],
      ["psalm", "Psalms"],
      ["psalms", "Psalms"],
      ["genesis", "Genesis"],
      ["jude", "Jude"],
      ["ruth", "Ruth"],
      ["esther", "Esther"],
      ["revelation", "Revelation"],
      ["revelations", "Revelation"],
      ["song of solomon", "Song of Solomon"],
      ["song of songs", "Song of Solomon"],
      ["1 john", "1 John"],
      ["first corinthians", "1 Corinthians"],
      ["II Kings", "2 Kings"],
      ["the book of john", "John"],
      ["book of psalms", "Psalms"],
      ["gospel of john", "John"],
      ["the gospel according to luke", "Luke"],
      ["acts of the apostles", "Acts"],
      ["epistle of james", "James"],
      ["st john", "John"],
      ["first book of samuel", "1 Samuel"],
      ["rom", "Romans"],
      ["phillipians", "Philippians"],
    ] as const) {
      const ref = parseReferenceOrBook(input);
      expect(ref, input).toMatchObject({ bookName: book, chapter: 1, bookOnly: true });
      expect(ref?.verse).toBeUndefined();
    }
  });

  it("is not accepted by parseReference (the live preview and OCR keep their old behaviour)", () => {
    for (const input of ["john", "ruth", "genesis", "the book of john"]) {
      expect(parseReference(input), input).toBeNull();
    }
  });

  it("never reads two-letter abbreviations as a whole query", () => {
    for (const input of ["ps", "ex", "is", "pr", "ne", "es", "re", "la", "am"]) {
      expect(parseReferenceOrBook(input), input).toBeNull();
    }
  });
});

describe("ordinary phrases that resemble book names stay phrases", () => {
  const phrases = [
    "mark my words",
    "john the baptist",
    "acts of kindness",
    "job loss",
    "numbers game",
    "numbers don't lie",
    "judges and kings",
    "ruth was a moabite woman",
    "amos and andy",
    "james bond",
    "luke warm",
    "the book of life",
    "book of the dead",
    "psalm of david",
    "romans road to salvation",
    "genesis of an idea",
    "revelation of truth",
    "exodus from egypt",
    "john 3 times",
    "job 3 months ago",
    "mark 5 minutes",
    "esther the queen",
    "daniel in the lions den",
    "joshua and the walls of jericho",
    "kings and queens",
    "i am the way, the truth and the life",
    "in the beginning",
    "what does the bible say about love",
    "verse about courage",
    "spider web",
    "web design 101",
    "the lord is my shepherd",
    "for god so loved the world",
  ];
  for (const phrase of phrases) {
    it(`"${phrase}" is not a reference`, () => {
      expect(parseReference(phrase)).toBeNull();
      expect(parseReferenceOrBook(phrase)).toBeNull();
    });
  }

  it("none of the 40 evaluation queries is mistaken for a reference or a book", () => {
    const mistaken = EVAL_QUERIES.filter(
      (item) => parseReference(item.query) !== null || parseReferenceOrBook(item.query) !== null,
    ).map((item) => item.query);
    expect(mistaken).toEqual([]);
  });

  it("empty, numeric-only and marker-only input are not references", () => {
    for (const input of ["", "   ", "3:16", "16", "chapter 3 verse 16", "verse 16", "1", "1:1"]) {
      expect(parseReference(input), input).toBeNull();
      expect(parseReferenceOrBook(input), input).toBeNull();
    }
  });

  it("very long input is never treated as a reference", () => {
    expect(parseReference(`john 3:16 ${"x ".repeat(80)}`)).toBeNull();
  });
});

describe("edition suffixes", () => {
  const cases: Array<[string, string, string | undefined, string | undefined]> = [
    ["john 3:16 kjv", "John 3:16", "KJAV", undefined],
    ["John 3:16 KJV", "John 3:16", "KJAV", undefined],
    ["john 3:16 (bsb)", "John 3:16", "BSB", undefined],
    ["john 3:16, WEB", "John 3:16", "WEB", undefined],
    ["john 3:16 in the asv", "John 3:16", "ASV", undefined],
    ["john 3:16 from the berean standard bible", "John 3:16", "BSB", undefined],
    ["psalm 23 king james version", "Psalms 23", "KJAV", undefined],
    ["1 john 4:8 kjv", "1 John 4:8", "KJAV", undefined],
    ["gen 1:1-3 bbe", "Genesis 1:1-3", "BBE", undefined],
    ["romans 8:28 fbv", "Romans 8:28", "FBV", undefined],
    ["john 3:16 niv", "John 3:16", undefined, "NIV"],
    ["john 3:16 (ESV)", "John 3:16", undefined, "ESV"],
    ["john 3:16 new living translation", "John 3:16", undefined, "NEW LIVING TRANSLATION"],
    ["3 john 4 kjv", "3 John 1:4", "KJAV", undefined],
  ];
  for (const [input, expected, translation, unsupported] of cases) {
    it(input, () => {
      const ref = parseReference(input);
      expect(show(ref)).toBe(expected);
      expect(ref?.translation).toBe(translation);
      expect(ref?.unsupportedTranslation).toBe(unsupported);
    });
  }

  it("an edition name alone, or glued to a word, is not a reference", () => {
    for (const input of [
      "kjv",
      "bsb",
      "web",
      "johnweb",
      "john web",
      "john 3:16kjvx",
      "my kjv bible",
      "web 3",
    ]) {
      expect(parseReference(input), input).toBeNull();
    }
  });

  it("works for book-only queries too", () => {
    expect(parseReferenceOrBook("john bsb")).toMatchObject({
      bookName: "John",
      bookOnly: true,
      translation: "BSB",
    });
  });
});

describe("alternate formats", () => {
  const cases: Array<[string, string | null]> = [
    ["John 3.16", "John 3:16"],
    ["John 3,16", "John 3:16"],
    ["John 3;16", "John 3:16"],
    ["john 3 : 16", "John 3:16"],
    ["John 3 v 16", "John 3:16"],
    ["Jn3:16", "John 3:16"],
    ["Jn3v16", "John 3:16"],
    ["St. John 3:16", "John 3:16"],
    ["Saint John 3:16", "John 3:16"],
    ["The Gospel of John 3:16", "John 3:16"],
    ["gospel according to john 3 16", "John 3:16"],
    ["book of psalms 23", "Psalms 23"],
    ["the book of psalms chapter 23 verse 1", "Psalms 23:1"],
    ["epistle of james 1:5", "James 1:5"],
    ["acts of the apostles 2:1", "Acts 2:1"],
    ["revelation of john 22:21", "Revelation 22:21"],
    ["I John 4:8", "1 John 4:8"],
    ["II Corinthians 5:17", "2 Corinthians 5:17"],
    ["III John 4", "3 John 1:4"],
    ["1st John 4:8", "1 John 4:8"],
    ["2nd Corinthians 5:17", "2 Corinthians 5:17"],
    ["first book of samuel 3:10", "1 Samuel 3:10"],
    ["Rom. 8:28", "Romans 8:28"],
    ["Ps. 119:105", "Psalms 119:105"],
    ["Psalms 23", "Psalms 23"],
    ["Revelations 22:21", "Revelation 22:21"],
    ["Song of Songs 2:1", "Song of Solomon 2:1"],
    ["JOHN 3:16", "John 3:16"],
    ["  john   3 : 16  ", "John 3:16"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} => ${expected}`, () => expect(show(parseReference(input))).toBe(expected));
  }
});

describe("common misspellings", () => {
  const cases: Array<[string, string | null]> = [
    ["phillipians 4:13", "Philippians 4:13"],
    ["philipians 4 13", "Philippians 4:13"],
    ["ephesions 2:8", "Ephesians 2:8"],
    ["galations 5:22", "Galatians 5:22"],
    ["collosians 3:23", "Colossians 3:23"],
    ["1 thesalonians 5:18", "1 Thessalonians 5:18"],
    ["1 corintians 13:4", "1 Corinthians 13:4"],
    ["2 corinthans 5:17", "2 Corinthians 5:17"],
    ["revalation 22:21", "Revelation 22:21"],
    ["deutronomy 6:5", "Deuteronomy 6:5"],
    ["levitcus 19:18", "Leviticus 19:18"],
    ["ecclesiates 3:1", "Ecclesiastes 3:1"],
    ["isiah 40:31", "Isaiah 40:31"],
    ["jermiah 29:11", "Jeremiah 29:11"],
    ["ezekial 36:26", "Ezekiel 36:26"],
    ["habakuk 2:4", "Habakkuk 2:4"],
    ["mathew 5:3", "Matthew 5:3"],
    ["genisis 1:1", "Genesis 1:1"],
    ["proverb 3:5", "Proverbs 3:5"],
    ["psalam 23", "Psalms 23"],
    ["hebrew 11:1", "Hebrews 11:1"],
    ["1 timoty 4:12", "1 Timothy 4:12"],
    ["philippines 4:13", "Philippians 4:13"], // the country is far more likely a slip for the epistle here
  ];
  for (const [input, expected] of cases) {
    it(`${input} => ${expected}`, () => {
      const ref = parseReference(input);
      expect(show(ref)).toBe(expected);
    });
  }

  it("flags a corrected book name", () => {
    expect(parseReference("phillipians 4:13")?.corrected).toBe(true);
    expect(parseReference("philippians 4:13")?.corrected).toBeUndefined();
  });

  it("does not guess wildly: unrelated words with numbers stay unparsed", () => {
    for (const input of ["genuine 1:1", "johnson 3:16", "marker 5", "acting 2:1", "roman 8:28 x"]) {
      expect(parseReference(input), input).toBeNull();
    }
  });

  it("numbered books need their number: a bare misspelt 'corinthians 13:4' is ambiguous", () => {
    expect(parseReference("corintians 13:4")).toBeNull();
  });
});

describe("spoken forms keep working", () => {
  const cases: Array<[string, string | null]> = [
    ["john three sixteen", "John 3:16"],
    ["first corinthians thirteen four", "1 Corinthians 13:4"],
    ["psalm twenty three", "Psalms 23"],
    ["psalm twenty three one", "Psalms 23:1"],
    ["luke twenty four", "Luke 24"],
    ["second timothy 1 7", "2 Timothy 1:7"],
    ["john chapter three verse sixteen", "John 3:16"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} => ${expected}`, () => expect(show(parseReference(input))).toBe(expected));
  }
});
