import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BIBLE_BOOKS } from "./books";
import {
  canDownloadOffline,
  downloadTranslation,
  EXPECTED_CHAPTERS,
  OfflineDownloadError,
  type DownloadProgress,
} from "./offline-download";
import {
  cancelDownload,
  downloadedCodes,
  ensureOfflineReady,
  entryOf,
  getOfflineChapter,
  getSnapshot,
  removeDownload,
  resetOfflineManagerForTests,
  startDownload,
} from "./offline-manager";
import { createMemoryStorage, OFFLINE_FORMAT_VERSION } from "./offline-store";
import { bibleService } from "./service";

/** A whole-translation file the way HelloAO serves it, with 27 verses in every chapter. */
function completeFile(options: { skip?: string; empty?: string } = {}) {
  const apiIds = [
    "GEN",
    "EXO",
    "LEV",
    "NUM",
    "DEU",
    "JOS",
    "JDG",
    "RUT",
    "1SA",
    "2SA",
    "1KI",
    "2KI",
    "1CH",
    "2CH",
    "EZR",
    "NEH",
    "EST",
    "JOB",
    "PSA",
    "PRO",
    "ECC",
    "SNG",
    "ISA",
    "JER",
    "LAM",
    "EZK",
    "DAN",
    "HOS",
    "JOL",
    "AMO",
    "OBA",
    "JON",
    "MIC",
    "NAM",
    "HAB",
    "ZEP",
    "HAG",
    "ZEC",
    "MAL",
    "MAT",
    "MRK",
    "LUK",
    "JHN",
    "ACT",
    "ROM",
    "1CO",
    "2CO",
    "GAL",
    "EPH",
    "PHP",
    "COL",
    "1TH",
    "2TH",
    "1TI",
    "2TI",
    "TIT",
    "PHM",
    "HEB",
    "JAS",
    "1PE",
    "2PE",
    "1JN",
    "2JN",
    "3JN",
    "JUD",
    "REV",
  ];
  return {
    books: BIBLE_BOOKS.map((book, index) => ({
      id: apiIds[index],
      chapters: Array.from({ length: book.chapters }, (_, i) => i + 1)
        .filter((number) => `${book.id}/${number}` !== options.skip)
        .map((number) => ({
          chapter: {
            number,
            content:
              `${book.id}/${number}` === options.empty
                ? []
                : Array.from({ length: 27 }, (_, v) => ({
                    type: "verse",
                    number: v + 1,
                    content: [`${book.name} ${number}:${v + 1} text`],
                  })),
          },
        })),
    })),
  };
}

const respond = (body: unknown, init: ResponseInit = { status: 200 }) =>
  vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init),
  ) as unknown as typeof fetch;

describe("which translations can be downloaded", () => {
  it("offers only WEB and ASV", () => {
    expect(canDownloadOffline("WEB")).toBe(true);
    expect(canDownloadOffline("ASV")).toBe(true);
    for (const code of ["BSB", "KJAV", "BBE", "FBV", "NIV", ""]) {
      expect(canDownloadOffline(code), code).toBe(false);
    }
    expect(EXPECTED_CHAPTERS).toBe(1189);
  });
});

describe("downloading a translation", () => {
  it("stores every chapter, verifies them, and marks it downloaded last", async () => {
    const storage = createMemoryStorage();
    const progress: DownloadProgress[] = [];
    const fetchMock = respond(completeFile());
    const record = await downloadTranslation("WEB", {
      storage,
      fetchImpl: fetchMock,
      onProgress: (p) => progress.push(p),
    });
    expect(record).toMatchObject({
      translation: "WEB",
      chapters: 1189,
      version: OFFLINE_FORMAT_VERSION,
    });
    expect(record.verses).toBe(1189 * 27);
    expect(await storage.countChapters("WEB")).toBe(1189);
    expect((await storage.getChapter("WEB", "john", 3))?.verses[15]).toMatchObject({
      verse: 16,
      text: "John 3:16 text",
      translation: "WEB",
    });
    expect(await storage.getDownload("WEB")).toEqual(record);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "https://bible.helloao.org/api/ENGWEBP/complete.json",
    );
    // Progress only goes forward, through the three phases, and ends at 100%.
    const fractions = progress.map((p) => p.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect([...new Set(progress.map((p) => p.phase))]).toEqual([
      "downloading",
      "saving",
      "verifying",
    ]);
    expect(fractions.at(-1)).toBe(1);
  });

  it("marks nothing downloaded and keeps nothing when a chapter is missing or empty", async () => {
    for (const options of [{ skip: "psalms/119" }, { empty: "john/3" }]) {
      const storage = createMemoryStorage();
      await expect(
        downloadTranslation("ASV", { storage, fetchImpl: respond(completeFile(options)) }),
      ).rejects.toMatchObject({ kind: "verify" });
      expect(storage.downloads.size).toBe(0);
      expect(storage.chapters.size).toBe(0);
    }
  });

  it("cleans up and marks nothing when cancelled part-way", async () => {
    const storage = createMemoryStorage();
    const controller = new AbortController();
    await expect(
      downloadTranslation("WEB", {
        storage,
        fetchImpl: respond(completeFile()),
        signal: controller.signal,
        onProgress: ({ phase, fraction }) => {
          if (phase === "saving" && fraction > 0.7) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(storage.chapters.size).toBe(0);
    expect(storage.downloads.size).toBe(0);
  });

  it("reports a network failure, a server error, a bad file and a full device without marking anything", async () => {
    const cases: [typeof fetch, string][] = [
      [
        vi.fn(async () => {
          throw new TypeError("offline");
        }) as unknown as typeof fetch,
        "network",
      ],
      [respond("", { status: 503 }), "network"],
      [respond("<html>"), "data"],
      [respond({ books: "nope" }), "data"],
    ];
    for (const [fetchImpl, kind] of cases) {
      const storage = createMemoryStorage();
      await expect(downloadTranslation("WEB", { storage, fetchImpl })).rejects.toMatchObject({
        kind,
      });
      expect(storage.downloads.size).toBe(0);
      expect(storage.chapters.size).toBe(0);
    }
    const full = createMemoryStorage();
    full.putChapters = async () => {
      throw new Error("QuotaExceededError");
    };
    await expect(
      downloadTranslation("WEB", { storage: full, fetchImpl: respond(completeFile()) }),
    ).rejects.toMatchObject({ kind: "storage" });
    expect(full.downloads.size).toBe(0);
  });

  it("refuses an edition that is not offered, without touching the network, and skips one already downloaded", async () => {
    const storage = createMemoryStorage();
    const never = vi.fn() as unknown as typeof fetch;
    await expect(downloadTranslation("BSB", { storage, fetchImpl: never })).rejects.toBeInstanceOf(
      OfflineDownloadError,
    );
    expect(never).not.toHaveBeenCalled();
    const first = await downloadTranslation("WEB", { storage, fetchImpl: respond(completeFile()) });
    const again = vi.fn() as unknown as typeof fetch;
    expect(await downloadTranslation("WEB", { storage, fetchImpl: again })).toEqual(first);
    expect(again).not.toHaveBeenCalled();
  });
});

describe("the download state and the Reader", () => {
  const realFetch = globalThis.fetch;
  let storage = createMemoryStorage();

  beforeEach(() => {
    storage = createMemoryStorage();
    resetOfflineManagerForTests(storage);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const serve = (body: unknown) => {
    globalThis.fetch = respond(body);
  };

  it("goes from idle to downloaded, and back to idle when removed", async () => {
    serve(completeFile());
    await ensureOfflineReady();
    expect(entryOf("WEB").status).toBe("idle");
    const done = startDownload("WEB");
    expect(entryOf("WEB").status).toBe("downloading");
    await done;
    expect(entryOf("WEB")).toMatchObject({ status: "downloaded", fraction: 1 });
    expect(downloadedCodes()).toEqual(["WEB"]);
    expect((await getOfflineChapter("WEB", "john", 3))?.verses).toHaveLength(27);
    expect(await getOfflineChapter("KJAV", "john", 3)).toBeNull();
    await removeDownload("WEB");
    expect(entryOf("WEB").status).toBe("idle");
    expect(await getOfflineChapter("WEB", "john", 3)).toBeNull();
    expect(storage.chapters.size).toBe(0);
  });

  it("shows a failure with a reason, and lets the download be tried again", async () => {
    globalThis.fetch = respond("", { status: 503 });
    await startDownload("ASV");
    expect(entryOf("ASV")).toMatchObject({ status: "failed" });
    expect(entryOf("ASV").error).toMatch(/connection/i);
    serve(completeFile());
    await startDownload("ASV");
    expect(entryOf("ASV").status).toBe("downloaded");
  });

  it("goes back to idle when cancelled", async () => {
    serve(completeFile());
    await ensureOfflineReady();
    const running = startDownload("WEB");
    cancelDownload("WEB");
    await running;
    expect(entryOf("WEB").status).toBe("idle");
    expect(storage.downloads.size).toBe(0);
  });

  it("knows what was downloaded before, and ignores a download in an old format", async () => {
    const record = {
      translation: "WEB",
      chapters: 1189,
      verses: 31000,
      bytes: 1,
      at: "2026-10-22T00:00:00Z",
    };
    await storage.markComplete({ ...record, version: OFFLINE_FORMAT_VERSION });
    await storage.markComplete({
      ...record,
      translation: "ASV",
      version: OFFLINE_FORMAT_VERSION + 1,
    });
    resetOfflineManagerForTests(storage);
    await ensureOfflineReady();
    expect(getSnapshot().ready).toBe(true);
    expect(downloadedCodes()).toEqual(["WEB"]);
  });

  it("reads a downloaded translation from the device without the network, and crosses chapters and books", async () => {
    serve(completeFile());
    await startDownload("WEB");
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    const ref = { bookId: "john", bookName: "John", chapter: 3 };
    expect((await bibleService.getChapter(ref, "WEB"))?.verses[0]?.text).toBe("John 3:1 text");
    expect((await bibleService.getVerse({ ...ref, verse: 16 }, "WEB"))?.text).toBe(
      "John 3:16 text",
    );
    expect((await bibleService.getNeighbour({ ...ref, verse: 27 }, 1, "WEB"))?.reference).toBe(
      "John 4:1",
    );
    expect((await bibleService.getNeighbour({ ...ref, verse: 1 }, -1, "WEB"))?.reference).toBe(
      "John 2:27",
    );
    const mat = { bookId: "matthew", bookName: "Matthew", chapter: 28, verse: 27 };
    expect((await bibleService.getNeighbour(mat, 1, "WEB"))?.reference).toBe("Mark 1:1");
    // Not downloaded: it still needs the network, and says so as before.
    await expect(bibleService.getChapter(ref, "KJAV")).rejects.toMatchObject({ kind: "network" });
  });
});
