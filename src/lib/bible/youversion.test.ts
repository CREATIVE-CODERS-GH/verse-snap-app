import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/memory-storage";
import { BIBLE_BOOKS, toApiBookId } from "./books";
import { parseChapterHtml } from "./youversion-html";
import { toUsfmBookId } from "./youversion-books";
import { createYouVersionProvider } from "./youversion-provider";
import type { YouVersionChapterResult } from "./youversion-protocol";

const USFM =
  "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(
    " ",
  );

// Synthetic markup in the shape of the documented passage format (no licensed text).
const SAMPLE = [
  "<div>",
  '<div class="s1 yv-h">A heading that must not appear</div>',
  '<div class="p"><span class="yv-v" v="1"></span><span class="yv-vlbl">1</span>First verse text.',
  '<span class="yv-v" v="2"></span><span class="yv-vlbl">2</span>Second &amp; <span class="wj">said, &#8220;Quoted&#8221;</span>',
  '<span class="yv-n f"><span class="fr">1:2 </span><span class="ft">A note that must not appear</span></span></div>',
  '<div class="q1"><span class="yv-v" v="3"></span><span class="yv-vlbl">3</span>Poetry line one</div>',
  '<div class="q2">poetry line two <b>bold</b></div>',
  "</div>",
].join("");

describe("parseChapterHtml", () => {
  it("splits a chapter into numbered plain-text verses", () => {
    expect(parseChapterHtml(SAMPLE)).toEqual([
      { verse: 1, text: "First verse text." },
      { verse: 2, text: "Second & said, “Quoted”" },
      { verse: 3, text: "Poetry line one poetry line two bold" },
    ]);
  });

  it("drops headings, printed verse numbers and footnotes", () => {
    const text = parseChapterHtml(SAMPLE)
      .map((item) => item.text)
      .join(" ");
    expect(text).not.toMatch(/heading|note that|1:2/i);
  });

  it("never lets markup or script through", () => {
    const [first] = parseChapterHtml(
      '<div class="p"><span class="yv-v" v="1"></span><script>alert(1)</script><img src=x onerror=alert(2)>Safe <a href="javascript:alert(3)">link</a> &lt;b&gt;</div>',
    );
    // Tags and script bodies are dropped; an escaped "<b>" survives only as plain text.
    expect(first?.text).toBe("Safe link <b>");
  });

  it("leaves an unnumbered psalm title out of verse 1", () => {
    const verses = parseChapterHtml(
      '<div><div class="d">A psalm title</div><div class="q1"><span class="yv-v" v="1"></span>Line</div></div>',
    );
    expect(verses).toEqual([{ verse: 1, text: "Line" }]);
  });

  it("keeps unexpected text before verse 1 rather than losing it", () => {
    const verses = parseChapterHtml(
      '<div><div class="p">Orphan words</div><div class="p"><span class="yv-v" v="1"></span>Line</div></div>',
    );
    expect(verses).toEqual([{ verse: 1, text: "Orphan words Line" }]);
  });

  it("keeps a bridged marker as one entry that spans both verses", () => {
    const verses = parseChapterHtml(
      '<div class="p"><span class="yv-v" v="3-4"></span>Joined text<span class="yv-v" v="5"></span>Five</div>',
    );
    expect(verses).toEqual([
      { verse: 3, through: 4, text: "Joined text" },
      { verse: 5, text: "Five" },
    ]);
  });

  it("ignores a malformed range and never invents a verse for an empty marker", () => {
    const verses = parseChapterHtml(
      '<div class="p"><span class="yv-v" v="7-5"></span>Backwards<span class="yv-v" v="8"></span><span class="yv-v" v="9"></span>Nine</div>',
    );
    expect(verses).toEqual([
      { verse: 7, text: "Backwards" },
      { verse: 9, text: "Nine" },
    ]);
  });

  it("keeps verse numbering from the markers, including a gap", () => {
    const verses = parseChapterHtml(
      '<div class="p"><span class="yv-v" v="1"></span>A<span class="yv-v" v="3"></span>C</div>',
    );
    expect(verses.map((item) => item.verse)).toEqual([1, 3]);
  });

  it("returns nothing for an unexpected response", () => {
    expect(parseChapterHtml("")).toEqual([]);
    expect(parseChapterHtml("<div>No verse markers</div>")).toEqual([]);
  });
});

describe("USFM book mapping", () => {
  it("covers all 66 books in canon order with standard USFM codes", () => {
    expect(BIBLE_BOOKS).toHaveLength(66);
    expect(BIBLE_BOOKS.map((book) => toUsfmBookId(book.id))).toEqual(USFM);
    expect(toApiBookId("john")).toBe("JHN");
    expect(toUsfmBookId("not-a-book")).toBeUndefined();
  });
});

describe("YouVersion server client", () => {
  async function loadServer(enabled: boolean) {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", enabled ? "true" : "false");
    return import("./youversion.server");
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const request = { translation: "NIV", bookId: "john", chapter: 3 };

  afterEach(() => vi.unstubAllEnvs());

  it("is closed while the feature flag is off", async () => {
    const { getChapterFromYouVersion } = await loadServer(false);
    const fetchImpl = vi.fn();
    const result = await getChapterFromYouVersion(request, {
      env: { YOUVERSION_APP_KEY: "k" },
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, kind: "translation" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is closed when no key is configured", async () => {
    const { getChapterFromYouVersion } = await loadServer(true);
    const fetchImpl = vi.fn();
    const result = await getChapterFromYouVersion(request, { env: {}, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: "translation" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes one documented, read-only request with the key in the header only", async () => {
    const { getChapterFromYouVersion } = await loadServer(true);
    const fetchImpl = vi.fn(async () =>
      json({ id: "JHN.3", reference: "John 3", content: SAMPLE }),
    );
    const result = await getChapterFromYouVersion(request, {
      env: { YOUVERSION_APP_KEY: "test-key-123" },
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, verses: parseChapterHtml(SAMPLE) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.youversion.com/v1/bibles/111/passages/JHN.3?format=html&include_headings=false&include_notes=false",
    );
    expect(url).not.toContain("test-key-123");
    expect((init.headers as Record<string, string>)["X-YVP-App-Key"]).toBe("test-key-123");
    expect(JSON.stringify(result)).not.toContain("test-key-123");
  });

  it("uses the AMP edition id", async () => {
    const { getChapterFromYouVersion } = await loadServer(true);
    const fetchImpl = vi.fn(async () => json({ content: SAMPLE }));
    await getChapterFromYouVersion(
      { ...request, translation: "AMP", chapter: 1 },
      { env: { YOUVERSION_APP_KEY: "k" }, fetchImpl },
    );
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain(
      "/bibles/1588/passages/JHN.1?",
    );
  });

  it.each([
    [401, "translation"],
    [403, "translation"],
    [412, "translation"],
    [404, "reference"],
    [422, "reference"],
    [429, "provider"],
    [500, "provider"],
    [503, "provider"],
  ])("maps HTTP %i to a safe %s failure and never retries", async (status, kind) => {
    const { getChapterFromYouVersion } = await loadServer(true);
    const fetchImpl = vi.fn(async () => new Response("Rate limit exceeded.", { status }));
    const result = await getChapterFromYouVersion(request, {
      env: { YOUVERSION_APP_KEY: "k" },
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, kind });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/Rate limit exceeded/);
  });

  it("reports a network failure and an unreadable response", async () => {
    const { getChapterFromYouVersion } = await loadServer(true);
    const env = { YOUVERSION_APP_KEY: "k" };
    expect(
      await getChapterFromYouVersion(request, {
        env,
        fetchImpl: async () => Promise.reject(new TypeError("offline")),
      }),
    ).toMatchObject({ ok: false, kind: "network" });
    expect(
      await getChapterFromYouVersion(request, {
        env,
        fetchImpl: async () => new Response("<html>", { status: 200 }),
      }),
    ).toMatchObject({ ok: false, kind: "provider" });
    expect(
      await getChapterFromYouVersion(request, {
        env,
        fetchImpl: async () => json({ content: "<div>none</div>" }),
      }),
    ).toMatchObject({ ok: false, kind: "provider" });
  });

  it("rejects a chapter outside the book before calling the API", async () => {
    const { getChapterFromYouVersion } = await loadServer(true);
    const fetchImpl = vi.fn();
    const result = await getChapterFromYouVersion(
      { ...request, chapter: 99 },
      { env: { YOUVERSION_APP_KEY: "k" }, fetchImpl },
    );
    expect(result).toMatchObject({ ok: false, kind: "reference" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("YouVersion provider", () => {
  const chapterOf = (verses: number[]): YouVersionChapterResult => ({
    ok: true,
    verses: verses.map((verse) => ({ verse, text: `v${verse}` })),
  });

  it("builds the app's Chapter and Verse shapes", async () => {
    const provider = createYouVersionProvider(async () => chapterOf([1, 2]));
    const chapter = await provider.getChapter(
      { bookId: "john", bookName: "John", chapter: 3 },
      "NIV",
    );
    expect(chapter).toMatchObject({
      translation: "NIV",
      bookId: "john",
      chapter: 3,
      reference: "John 3",
    });
    expect(chapter?.verses[1]).toMatchObject({
      verse: 2,
      text: "v2",
      reference: "John 3:2",
      translation: "NIV",
    });
  });

  it("walks to the neighbouring chapter and book", async () => {
    const load = vi.fn(async ({ bookId, chapter }: { bookId: string; chapter: number }) =>
      chapterOf(bookId === "john" && chapter === 3 ? [1, 2] : [1, 2, 3]),
    );
    const provider = createYouVersionProvider(load);
    const last = { bookId: "john", bookName: "John", chapter: 3, verse: 2 };
    expect((await provider.getNeighbour(last, 1, "NIV"))?.reference).toBe("John 4:1");
    expect((await provider.getNeighbour({ ...last, verse: 1 }, -1, "NIV"))?.reference).toBe(
      "John 2:3",
    );
    const edge = { bookId: "genesis", bookName: "Genesis", chapter: 1, verse: 1 };
    expect(await provider.getNeighbour(edge, -1, "NIV")).toBeNull();
  });

  it("turns server failures into BibleServiceError and a missing chapter into null", async () => {
    const ref = { bookId: "john", bookName: "John", chapter: 3 };
    const down = createYouVersionProvider(async () => ({
      ok: false,
      kind: "provider",
      message: "no",
    }));
    await expect(down.getChapter(ref, "NIV")).rejects.toMatchObject({ kind: "provider" });
    const missing = createYouVersionProvider(async () => ({
      ok: false,
      kind: "reference",
      message: "no",
    }));
    expect(await missing.getChapter(ref, "NIV")).toBeNull();
    const broken = createYouVersionProvider(async () => Promise.reject(new Error("fetch failed")));
    await expect(broken.getChapter(ref, "NIV")).rejects.toMatchObject({ kind: "network" });
    expect(await broken.getChapter({ ...ref, chapter: 99 }, "NIV")).toBeNull();
  });
});

describe("catalogue and routing", () => {
  const helloGetChapter = vi.fn(async () => ({
    translation: "KJAV",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    reference: "John 3",
    verses: [],
  }));
  const youVersionGetChapter = vi.fn(async () => ({
    translation: "NIV",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    reference: "John 3",
    verses: [],
  }));
  const getOfflineChapter = vi.fn(async () => null);

  async function loadService(enabled: boolean) {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", enabled ? "true" : "false");
    vi.doMock("./helloao-provider", () => ({
      helloAoProvider: {
        listTranslations: vi.fn(),
        getChapter: helloGetChapter,
        getVerse: vi.fn(),
        getNeighbour: vi.fn(),
      },
    }));
    vi.doMock("./youversion-provider", () => ({
      youVersionProvider: {
        listTranslations: vi.fn(),
        getChapter: youVersionGetChapter,
        getVerse: vi.fn(),
        getNeighbour: vi.fn(),
      },
    }));
    vi.doMock("./offline-manager", () => ({ getOfflineChapter }));
    return import("./service");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("./helloao-provider");
    vi.doUnmock("./youversion-provider");
    vi.doUnmock("./offline-manager");
  });

  it("lists exactly the six existing translations when the flag is off, KJAV first and default", async () => {
    const { bibleService, DEFAULT_TRANSLATION } = await loadService(false);
    const codes = (await bibleService.listTranslations()).map((item) => item.code);
    expect(codes).toEqual(["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV"]);
    expect(DEFAULT_TRANSLATION).toBe("KJAV");
  });

  it("adds NIV and AMP after the six when the flag is on, and keeps KJAV the default", async () => {
    const { bibleService, DEFAULT_TRANSLATION } = await loadService(true);
    const list = await bibleService.listTranslations();
    expect(list.map((item) => item.code)).toEqual([
      "KJAV",
      "BSB",
      "WEB",
      "ASV",
      "BBE",
      "FBV",
      "NIV",
      "AMP",
    ]);
    expect(list.find((item) => item.code === "NIV")?.attribution?.notice).toMatch(/Biblica/);
    expect(list.find((item) => item.code === "AMP")?.attribution?.notice).toMatch(/Lockman/);
    expect(list.find((item) => item.code === "KJAV")?.attribution).toBeUndefined();
    expect(DEFAULT_TRANSLATION).toBe("KJAV");
  });

  it("refuses NIV and AMP while the flag is off", async () => {
    const { bibleService } = await loadService(false);
    const ref = { bookId: "john", bookName: "John", chapter: 3 };
    await expect(bibleService.getChapter(ref, "NIV")).rejects.toMatchObject({
      kind: "translation",
    });
    await expect(bibleService.getChapter(ref, "AMP")).rejects.toMatchObject({
      kind: "translation",
    });
    expect(youVersionGetChapter).not.toHaveBeenCalled();
  });

  it("keeps the six existing translations on HelloAO", async () => {
    const { bibleService } = await loadService(true);
    const ref = { bookId: "john", bookName: "John", chapter: 3 };
    for (const code of ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV"])
      await bibleService.getChapter(ref, code);
    expect(helloGetChapter).toHaveBeenCalledTimes(6);
    expect(youVersionGetChapter).not.toHaveBeenCalled();
  });

  it("serves NIV through YouVersion without touching offline storage or the on-device chapter cache", async () => {
    const { bibleService } = await loadService(true);
    const ref = { bookId: "john", bookName: "John", chapter: 3 };
    await bibleService.getChapter(ref, "NIV");
    expect(youVersionGetChapter).toHaveBeenCalledTimes(1);
    expect(helloGetChapter).not.toHaveBeenCalled();
    expect(getOfflineChapter).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("versesnap.bible.chapters.v1")).toBeNull();
    // Control: a HelloAO chapter is cached on the device as before.
    await bibleService.getChapter(ref, "KJAV");
    expect(getOfflineChapter).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("versesnap.bible.chapters.v1")).not.toBeNull();
  });

  it("keeps licensed editions out of free search, offline downloads and AI search", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    const { BIBLE_TRANSLATIONS, resolveTranslation, isRestrictedTranslation } =
      await import("./translations");
    expect(BIBLE_TRANSLATIONS.map((item) => item.code)).toEqual([
      "KJAV",
      "BSB",
      "WEB",
      "ASV",
      "BBE",
      "FBV",
    ]);
    expect(() => resolveTranslation("NIV")).toThrow(); // the gate used by AI search and offline downloads
    expect(() => resolveTranslation("AMP")).toThrow();
    expect(isRestrictedTranslation("NIV")).toBe(true);
    expect(isRestrictedTranslation("KJAV")).toBe(false);
  });
});

describe("saved verses keep references only for licensed editions", () => {
  const from = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { from } }));
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/integrations/supabase/client");
  });

  const base = { bookId: "john", bookName: "John", chapter: 3, verse: 16, reference: "John 3:16" };

  it("stores no text for NIV but still stores the text of every other edition", async () => {
    const { library } = await import("../library");
    await library.save({ ...base, translation: "NIV", text: "LICENSED TEXT" });
    await library.save({ ...base, translation: "BSB", text: "free text" });
    const saved = await library.listSaved();
    expect(saved.find((entry) => entry.translation === "NIV")).toMatchObject({ verseText: "" });
    expect(saved.find((entry) => entry.translation === "BSB")).toMatchObject({
      verseText: "free text",
    });
    const raw = JSON.stringify(window.localStorage.getItem("versesnap.library.saved.v1"));
    expect(raw).not.toContain("LICENSED TEXT");
  });
});

describe("the API key stays on the server", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("is read only by the .server module, and that module is only dynamically imported", () => {
    const files = sourceFiles(join(process.cwd(), "src"));
    const readers = files.filter((file) => /YOUVERSION_APP_KEY/.test(readFileSync(file, "utf8")));
    const normalised = readers.map((file) => file.replace(/\\/g, "/"));
    // Allowed: the server modules (chapters, and Discover search, which also keeps its own check in
    // youversion-discover.test.ts), and comments/docs strings in the flag file.
    for (const file of normalised) {
      expect(file).toMatch(
        /(youversion(-discover)?\.server\.ts|youversion-(schema|limits)\.ts|test\/setup\.ts)$/,
      );
    }
    const shell = readFileSync(
      join(process.cwd(), "src/lib/bible/youversion.functions.ts"),
      "utf8",
    );
    expect(shell).not.toMatch(/^import .*youversion\.server/m);
    expect(shell).toMatch(/await import\("\.\/youversion\.server"\)/);
    // Nothing exposes the key through a VITE_ variable.
    expect(
      files.some((file) => /VITE_YOUVERSION_(APP_)?KEY/.test(readFileSync(file, "utf8"))),
    ).toBe(false);
  });
});
