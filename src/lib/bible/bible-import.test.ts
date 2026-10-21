import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { BIBLE_BOOKS, fromApiBookId, toApiBookId } from "./books";
import { resolveTranslation, BIBLE_TRANSLATIONS } from "./translations";
import { assembleVerseText } from "./verse-text";

// The import pipeline (scripts/bible-import) is plain JavaScript; these tests check it against the
// app's own tables so database identifiers, HelloAO ids and Reader routes cannot drift apart.
interface Parsed {
  verses: { book: string; bookOrder: number; chapter: number; verse: number; text: string }[];
  chapters: Map<string, number[]>;
  findings: Record<string, unknown[] & Record<string, unknown>>;
  verseBlocks: number;
}
interface Lib {
  CONFIG: {
    books: string[];
    editions: Record<
      string,
      {
        licenseStatus: string;
        helloaoId: string;
        name?: string;
        pinnedSha256?: string;
        expectedVerseBlocks?: number;
      }
    >;
  };
  parseEdition(code: string, json: unknown): Parsed;
  requireApproved(code: string): unknown;
  searchText(content: unknown): string;
  readerText(content: unknown): string;
  legacyReaderText(content: unknown): string;
  sqlString(value: string): string;
  buildSql(
    code: string,
    parsed: Parsed,
    source: { sha256: string; bytes: number },
  ): { name: string; sql: string }[];
  compareChapters(a: Parsed, b: Parsed): { chapter: string }[];
  sha256(bytes: Buffer): string;
}
const lib = (await import(
  pathToFileURL(join(process.cwd(), "scripts/bible-import/lib.mjs")).href
)) as Lib;
const { CONFIG } = lib;

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("edition identifiers agree everywhere", () => {
  it("every Reader translation is known to the import config, with the same HelloAO id", () => {
    for (const reader of BIBLE_TRANSLATIONS) {
      const entry = CONFIG.editions[reader.code];
      expect(entry, reader.code).toBeDefined();
      expect(entry?.helloaoId, reader.code).toBe(reader.apiId);
    }
    expect(Object.keys(CONFIG.editions).sort()).toEqual(
      BIBLE_TRANSLATIONS.map((t) => t.code).sort(),
    );
  });

  it("the codes the database uses are the codes the Reader routes accept", () => {
    for (const code of Object.keys(CONFIG.editions)) {
      expect(resolveTranslation(code).code, code).toBe(code);
    }
  });

  it("licence status: WEB, BSB, ASV approved; KJAV pending; BBE and FBV excluded", () => {
    const status = Object.fromEntries(
      Object.entries(CONFIG.editions).map(([code, e]) => [code, e.licenseStatus]),
    );
    expect(status).toEqual({
      WEB: "approved",
      BSB: "approved",
      ASV: "approved",
      KJAV: "pending",
      BBE: "excluded",
      FBV: "excluded",
    });
  });

  it("the database seed rows agree with the config (id, status, pinned hash)", () => {
    const sql = read("supabase/migrations/20261023000000_bible_search_index.sql");
    for (const [code, e] of Object.entries(CONFIG.editions)) {
      expect(sql, code).toContain(`('${code}', '${e.helloaoId}'`);
      expect(sql, code).toMatch(new RegExp(`'${e.licenseStatus}', date`));
      if (e.pinnedSha256) expect(sql, code).toContain(e.pinnedSha256);
    }
  });

  it("the import script refuses every unapproved or unknown edition", () => {
    for (const code of ["KJAV", "BBE", "FBV", "NIV", ""]) {
      expect(() => lib.requireApproved(code), code).toThrow();
    }
    for (const code of ["WEB", "BSB", "ASV"]) expect(() => lib.requireApproved(code)).not.toThrow();
  });
});

describe("book identifiers resolve to Reader routes", () => {
  it("the 66 USFM ids are unique, in the app's book order, and round-trip", () => {
    expect(CONFIG.books).toHaveLength(66);
    expect(new Set(CONFIG.books).size).toBe(66);
    CONFIG.books.forEach((usfm, index) => {
      const book = fromApiBookId(usfm);
      expect(book, usfm).toBeDefined();
      expect(BIBLE_BOOKS.indexOf(book!), usfm).toBe(index);
      expect(toApiBookId(book!.id), usfm).toBe(usfm);
    });
  });

  it("a search result maps to /verse/{edition}/{slug}/{chapter}/{verse}", () => {
    const row = { edition_code: "BSB", book: "1CO", chapter: 13, verse: 4 };
    const slug = fromApiBookId(row.book)?.id;
    expect(slug).toBe("1corinthians");
    expect(`/verse/${row.edition_code}/${slug}/${row.chapter}/${row.verse}`).toBe(
      "/verse/BSB/1corinthians/13/4",
    );
  });
});

const block = (number: number, content: unknown) => ({ type: "verse", number, content });
function edition(code: string, patch: (chapters: unknown[][]) => void = () => {}) {
  const config = CONFIG.editions[code]!;
  const books = CONFIG.books.map((id, index) => ({
    id,
    order: index + 1,
    numberOfChapters: 1,
    totalNumberOfVerses: 2,
    chapters: [
      {
        numberOfVerses: 2,
        chapter: { number: 1, content: [block(1, ["First verse."]), block(2, ["Second verse."])] },
      },
    ],
  }));
  patch(books.map((b) => b.chapters[0]!.chapter.content));
  return {
    translation: { id: config.helloaoId, shortName: code },
    books,
  };
}
// Relax the expected counts for the tiny fixture.
const tiny = (code: string, json: unknown) => {
  const saved = { ...CONFIG.editions[code]! };
  CONFIG.editions[code]!.expectedVerseBlocks = 132;
  (CONFIG.editions[code] as Record<string, unknown>)["expectedChapters"] = 66;
  try {
    return lib.parseEdition(code, json);
  } finally {
    Object.assign(CONFIG.editions[code]!, saved);
  }
};

describe("parsing and validation", () => {
  it("reads verse blocks and keeps native numbers", () => {
    const parsed = tiny("WEB", edition("WEB"));
    expect(parsed.verses).toHaveLength(132);
    expect(parsed.verses[0]).toMatchObject({
      book: "GEN",
      chapter: 1,
      verse: 1,
      text: "First verse.",
    });
    expect(parsed.findings["countMismatches"]).toEqual([]);
  });

  it("refuses a file that is a different edition (no substitution)", () => {
    const wrong = edition("WEB");
    wrong.translation.id = "eng_kjv";
    expect(() => tiny("WEB", wrong)).toThrow(/refusing to substitute/);
    const wrongShort = edition("WEB");
    wrongShort.translation.shortName = "KJV";
    expect(() => tiny("WEB", wrongShort)).toThrow(/short name/);
  });

  it("refuses an unapproved edition before reading anything", () => {
    expect(() => lib.parseEdition("KJAV", {})).toThrow(/pending/);
    expect(() => lib.parseEdition("BBE", {})).toThrow(/excluded/);
  });

  it("rejects a wrong book order or book count", () => {
    const shuffled = edition("WEB");
    [shuffled.books[0], shuffled.books[1]] = [shuffled.books[1]!, shuffled.books[0]!];
    expect(() => tiny("WEB", shuffled)).toThrow(/expected "GEN"/);
    const short = edition("WEB");
    short.books.pop();
    expect(() => tiny("WEB", short)).toThrow(/66 books/);
  });

  it("records duplicates, empty verses, gaps and bad numbers instead of importing them", () => {
    const parsed = tiny(
      "WEB",
      edition("WEB", (chapters) => {
        chapters[0]!.push(block(2, ["again"])); // duplicate Genesis 1:2
        chapters[1]!.splice(0, 2, block(1, ["a"]), block(3, ["c"]), block(4, [""])); // gap and empty
        chapters[2]!.splice(0, 1, block(1.5, ["bad"]));
      }),
    );
    const f = parsed.findings;
    expect(f["duplicateReferences"]).toEqual(["GEN 1:2"]);
    expect(f["emptyVerses"]).toEqual(["EXO 1:4"]);
    expect(String(f["gaps"]?.[0])).toContain("EXO 1");
    expect(f["nonIntegerVerseNumbers"]).toEqual(["LEV 1:1.5"]);
    expect(parsed.verses.some((v) => v.book === "GEN" && v.verse === 2 && v.text === "again")).toBe(
      false,
    );
    expect(parsed.verses.some((v) => v.text === "")).toBe(false);
  });

  it("flags text over 4,000 characters and unusual characters", () => {
    const parsed = tiny(
      "WEB",
      edition("WEB", (chapters) => {
        chapters[0]!.splice(0, 1, block(1, ["x".repeat(4001)]));
        chapters[1]!.splice(0, 1, block(1, ["zero​width"]));
      }),
    );
    expect(parsed.findings["tooLong"]).toEqual(["GEN 1:1"]);
    expect(parsed.findings["unusualCharacters"]).toEqual(["EXO 1:1"]);
  });
});

describe("verse text for search", () => {
  const poem = [
    "The LORD God said to the serpent,",
    { text: "“Because you have done this,", poem: 1 },
    { text: "you are cursed", poem: 2 },
    { lineBreak: true },
    { text: "above all.", poem: 2 },
    { noteId: 3 },
  ];

  it("separates poetry lines with a space; the old Reader rule ran them together", () => {
    expect(lib.searchText(poem)).toBe(
      "The LORD God said to the serpent, “Because you have done this, you are cursed above all.",
    );
    expect(lib.legacyReaderText(poem)).toContain("serpent,“Because");
    expect(lib.legacyReaderText(poem)).toContain("done this,you are");
  });

  it("is the same function the Reader now uses", () => {
    const samples: unknown[] = [
      poem,
      ["a", { text: "," }, { text: "b" }, { lineBreak: true }, "“c”", { text: "—d" }],
      ["pre-", "eminence", { text: "’s" }],
      [{ text: "ב", poem: 1 }, { text: "ְ" }, "א ALEPH."],
    ];
    for (const sample of samples) {
      expect(lib.searchText(sample)).toBe(assembleVerseText(sample));
      expect(lib.readerText(sample)).toBe(assembleVerseText(sample));
    }
  });

  it("collapses whitespace and removes footnote markers", () => {
    expect(lib.searchText(["In the beginning, God", { noteId: 0 }, "created"])).toBe(
      "In the beginning, God created",
    );
    expect(lib.searchText(["  a \n  b\t"])).toBe("a b");
  });
});

describe("SQL output", () => {
  const source = { sha256: "a".repeat(64), bytes: 1 };
  const parsed = tiny("WEB", edition("WEB"));

  it("escapes quotes and keeps backslashes, Unicode and curly quotes intact", () => {
    expect(lib.sqlString("it's")).toBe("'it''s'");
    expect(lib.sqlString("a\\b")).toBe("'a\\b'");
    expect(lib.sqlString("“Gód’s” א")).toBe("'“Gód’s” א'");
    expect(() => lib.sqlString("bad\u0000nul")).toThrow();
  });

  it("produces check, chunk, verify and promote files, each chunk its own transaction", () => {
    const files = lib.buildSql("WEB", parsed, source);
    const names = files.map((f) => f.name);
    expect(names[0]).toBe("WEB_00_check.sql");
    expect(names).toContain("WEB_90_verify.sql");
    expect(names.at(-1)).toBe("WEB_99_promote.sql");
    for (const f of files.filter(
      (x) => /_\d\d\.sql$/.test(x.name) && !/_(00|90|99)_/.test(x.name),
    )) {
      expect(f.sql).toMatch(/\nbegin;\ninsert into public\.bible_verses/);
      expect(f.sql).toMatch(/\ncommit;\n$/);
      expect(f.sql).toContain("on conflict (edition_code, book, chapter, verse) do update");
    }
  });

  it("the check step names the source hash; the promote step is guarded by the row count", () => {
    const files = lib.buildSql("WEB", parsed, source);
    expect(files[0]!.sql).toContain(`source_sha256 = '${"a".repeat(64)}'`);
    expect(files[0]!.sql).toContain("license_status = 'approved'");
    const promote = files.at(-1)!.sql;
    expect(promote).toContain(`<> ${parsed.verses.length}`);
    expect(promote).toContain("set status = 'active'");
  });

  it("refuses to write SQL for an unapproved edition", () => {
    expect(() => lib.buildSql("KJAV", parsed, source)).toThrow(/pending/);
  });

  it("contains no credentials or connection strings", () => {
    const all = lib
      .buildSql("WEB", parsed, source)
      .map((f) => f.sql)
      .join("\n");
    expect(all).not.toMatch(/service_role|password|postgres:\/\/|eyJ[A-Za-z0-9_-]{20,}/i);
  });
});

describe("chapter differences", () => {
  it("lists verse numbers present in only one edition (native numbering, nothing remapped)", () => {
    const a = tiny("WEB", edition("WEB"));
    const b = tiny(
      "BSB",
      edition("BSB", (chapters) => chapters[44]!.splice(0, 2, block(1, ["x"]), block(3, ["z"]))),
    );
    const diff = lib.compareChapters(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ chapter: "ROM 1", onlyInFirst: [2], onlyInSecond: [3] });
  });
});
