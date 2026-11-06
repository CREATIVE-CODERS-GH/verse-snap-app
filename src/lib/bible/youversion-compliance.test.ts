import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/memory-storage";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("licensed query policy (no retention once a screen is closed)", () => {
  async function client() {
    vi.resetModules();
    const { applyLicensedQueryPolicy, SCRIPTURE_QUERY_ROOTS } = await import("./query-policy");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 600_000, gcTime: 3_600_000 } },
    });
    applyLicensedQueryPolicy(queryClient);
    return { queryClient, SCRIPTURE_QUERY_ROOTS };
  }

  it("drops NIV and AMP data the moment nothing uses it, for every Scripture query", async () => {
    const { queryClient, SCRIPTURE_QUERY_ROOTS } = await client();
    for (const root of SCRIPTURE_QUERY_ROOTS) {
      for (const code of ["NIV", "AMP"]) {
        expect(queryClient.getQueryDefaults([root, code, "john", "3"])).toMatchObject({
          gcTime: 0,
          staleTime: 0,
        });
      }
    }
  });

  it("leaves the free editions on the app-wide defaults", async () => {
    const { queryClient } = await client();
    for (const code of ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV"]) {
      expect(queryClient.getQueryDefaults(["chapter", code, "john", "3"])).toEqual({});
      expect(queryClient.getQueryDefaults(["verse", code, "john", "3", "16"])).toEqual({});
    }
  });

  it("covers every query root that holds Scripture text in the app", () => {
    const { SCRIPTURE_QUERY_ROOTS } = {
      SCRIPTURE_QUERY_ROOTS: ["chapter", "verse", "verse-neighbours"],
    };
    const roots = new Set<string>();
    for (const file of sourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      if (!/bibleService\.(getChapter|getVerse|getNeighbour)/.test(text)) continue;
      for (const match of text.matchAll(
        /queryKey:\s*\[\s*"([a-z-]+)"\s*,\s*[A-Za-z.]*[tT]ranslation/g,
      )) {
        roots.add(match[1] as string);
      }
    }
    expect([...roots].sort()).toEqual([...SCRIPTURE_QUERY_ROOTS].sort());
  });

  it("is applied when the router (and its query client) is created", () => {
    expect(read("src/router.tsx")).toMatch(/applyLicensedQueryPolicy\(queryClient\)/);
  });
});

describe("sharing rules for licensed editions", () => {
  const verse = (translation: string) => ({
    translation,
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    text: "TEXT",
    reference: "John 3:16",
  });

  async function load() {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    const imageModule = {
      createVerseImageBlob: vi.fn(async () => new Blob(["x"])),
      verseImageFileName: () => "x.png",
    };
    vi.doMock("./../share-verse-image", () => imageModule);
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true, clipboard: { writeText: vi.fn() } });
    const card = await import("../share-verse-card");
    const translations = await import("./translations");
    return { ...card, ...translations, share, imageModule };
  }
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("./../share-verse-image");
  });

  it("does not hand NIV to other apps, as text or as an image", async () => {
    const { shareVerseText, shareVerseCard, share, imageModule } = await load();
    const notify = vi.fn();
    await shareVerseText(verse("NIV"), notify);
    await shareVerseCard(verse("NIV"), notify);
    expect(share).not.toHaveBeenCalled();
    expect(imageModule.createVerseImageBlob).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0]?.[0]).toMatch(/NIV outside Verse Snap isn.t available yet/);
  });

  it("leaves sharing alone for AMP and every free edition", async () => {
    const { shareVerseText, canShareExternally, share } = await load();
    for (const code of ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV", "AMP"]) {
      expect(canShareExternally(code)).toBe(true);
    }
    await shareVerseText(verse("BSB"), vi.fn());
    await shareVerseText(verse("AMP"), vi.fn());
    expect(share).toHaveBeenCalledTimes(2);
    expect(
      String((share.mock.calls[1] as unknown[])[0] ? JSON.stringify(share.mock.calls[1]) : ""),
    ).toContain("Lockman");
  });

  it("does not let NIV text be copied, while AMP and the free editions can be", async () => {
    const { canCopyText } = await load();
    expect(canCopyText("NIV")).toBe(false);
    for (const code of ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV", "AMP"]) {
      expect(canCopyText(code)).toBe(true);
    }
  });

  it("builds text with the notice and the publisher link for the editions that may be shared", async () => {
    const { verseShareText, appendPublisherNotices, publisherNoticeText } = await load();
    const text = verseShareText(verse("NIV"));
    expect(text).toContain("Used by Permission of Biblica, Inc.");
    expect(text).toContain("https://www.biblica.com/");
    // Lockman's own wording already names its site: the link is not added twice.
    expect(publisherNoticeText("AMP")?.match(/lockman\.org/gi)).toHaveLength(1);
    expect(appendPublisherNotices("x", ["KJAV"])).toBe("x");
  });

  it("keeps AMP's image path and NIV's closed, and only the Share sheet code decides what shows", () => {
    const sheet = read("src/components/share-sheet.tsx");
    expect(sheet).toMatch(/canShareExternally\(verse\.translation\)/);
    expect(sheet).toMatch(/data-testid="share-restricted-note"/);
  });
});

describe("licensed editions stay isolated from the other features", () => {
  it("is not in the lists that drive free search, offline downloads or AI search", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    const { BIBLE_TRANSLATIONS, resolveTranslation } = await import("./translations");
    expect(BIBLE_TRANSLATIONS.map((item) => item.code)).toEqual([
      "KJAV",
      "BSB",
      "WEB",
      "ASV",
      "BBE",
      "FBV",
    ]);
    expect(() => resolveTranslation("NIV")).toThrow();
    expect(() => resolveTranslation("AMP")).toThrow();
    vi.unstubAllEnvs();
  });

  it("is never imported by search, offline, AI or Study Together code", () => {
    const guarded = sourceFiles(join(root, "src")).filter((file) => {
      const path = file.replace(/\\/g, "/");
      return (
        /free-search|offline|\/ai\/|study|search-service|search\.functions/i.test(path) &&
        !/\.test\./.test(path)
      );
    });
    expect(guarded.length).toBeGreaterThan(5);
    for (const file of guarded) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /youversion|YOUVERSION_EDITIONS|readerTranslations/i,
      );
    }
  });

  it("keeps licensed editions ineligible for Study Together", async () => {
    const { canUseInStudyTogether } = await import("./translations");
    expect(canUseInStudyTogether("NIV")).toBe(false);
    expect(canUseInStudyTogether("AMP")).toBe(false);
    expect(canUseInStudyTogether("KJAV")).toBe(true);
  });
});

describe("history and saved verses keep references only", () => {
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
  const verse = (translation: string) => ({
    translation,
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    reference: "John 3:16",
    text: `${translation} LICENSED WORDS`,
  });

  it("writes no NIV or AMP text into saved verses or reading history, but still does for others", async () => {
    const { library } = await import("../library");
    for (const code of ["NIV", "AMP", "BSB"]) {
      await library.save(verse(code));
      await library.recordView(verse(code));
    }
    const everything = JSON.stringify([
      window.localStorage.getItem("versesnap.library.saved.v1"),
      window.localStorage.getItem("versesnap.library.history.v1"),
    ]);
    expect(everything).not.toContain("NIV LICENSED WORDS");
    expect(everything).not.toContain("AMP LICENSED WORDS");
    expect(everything).toContain("BSB LICENSED WORDS");
    expect((await library.listSaved()).map((entry) => entry.translation).sort()).toEqual([
      "AMP",
      "BSB",
      "NIV",
    ]);
  });

  it("never lets a note quote licensed text", async () => {
    vi.resetModules();
    const { scriptureCitation } = await import("../reflection-format");
    expect(scriptureCitation("NIV LICENSED WORDS", "John 3:16", "NIV")).toBe("John 3:16 (NIV)");
    expect(scriptureCitation("AMP LICENSED WORDS", "John 3:16", "AMP")).not.toContain("LICENSED");
  });
});

describe("turning the feature off never strands a reader on NIV or AMP", () => {
  const stored = (translation: string) => JSON.stringify({ translation });

  async function parse(enabled: boolean, translation: string) {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", enabled ? "true" : "false");
    const { parseStoredPreferences } = await import("../preferences-storage");
    return parseStoredPreferences(stored(translation))?.translation;
  }
  afterEach(() => vi.unstubAllEnvs());

  it("falls back to KJAV when a device's saved default is NIV or AMP and the flag is off", async () => {
    expect(await parse(false, "NIV")).toBe("KJAV");
    expect(await parse(false, "AMP")).toBe("KJAV");
  });

  it("keeps the saved choice when the flag is on, and never touches the free editions", async () => {
    expect(await parse(true, "NIV")).toBe("NIV");
    for (const code of ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV"]) {
      expect(await parse(false, code)).toBe(code);
    }
  });
});
