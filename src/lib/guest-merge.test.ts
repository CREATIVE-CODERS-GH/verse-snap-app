import { describe, expect, it, vi } from "vitest";
import type { GuestHighlight } from "./highlights";
import type { HistoryEntry, LibraryEntry } from "./library";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { MERGE_BATCH_SIZE, mergeGuestLibrary, mergeableCounts } = await import("./guest-merge");
type Backend = import("./guest-merge").MergeBackend;
type SavedRow = import("./guest-merge").SavedRow;
type HistoryRow = import("./guest-merge").HistoryRow;
type HighlightRow = import("./guest-merge").HighlightRow;

const USER = "user-a";

function saved(verse: number, chapter = 1): LibraryEntry {
  return {
    id: `BSB/GEN/${chapter}/${verse}`,
    translation: "BSB",
    bookId: "GEN",
    bookName: "Genesis",
    chapter,
    verse,
    verseText: `Genesis ${chapter}:${verse}`,
    at: `2026-01-0${(verse % 9) + 1}T00:00:00.000Z`,
  };
}

function viewed(verse: number, chapter = 1): HistoryEntry {
  return { ...saved(verse, chapter), kind: "verse" };
}

function chapterVisit(chapter: number): HistoryEntry {
  const { verse: _verse, ...rest } = saved(1, chapter);
  return { ...rest, id: `chapter:BSB/GEN/${chapter}`, kind: "chapter", verse: null };
}

function highlight(verse: number, color: GuestHighlight["color"] = "amber", translation = "BSB") {
  return {
    id: `${translation}/GEN/1/${verse}`,
    translation,
    bookId: "GEN",
    chapter: 1,
    verse,
    color,
    at: `2026-02-0${(verse % 9) + 1}T00:00:00.000Z`,
  } satisfies GuestHighlight;
}

/** The device's guest lists, with the same remove-by-id behaviour as the real store. */
function fakeStore(initial: {
  saved?: LibraryEntry[];
  history?: HistoryEntry[];
  highlights?: GuestHighlight[];
}) {
  let savedList = [...(initial.saved ?? [])];
  let historyList = [...(initial.history ?? [])];
  let highlightList = [...(initial.highlights ?? [])];
  return {
    highlights: () => [...highlightList],
    removeHighlights(ids: readonly string[]) {
      highlightList = highlightList.filter((entry) => !ids.includes(entry.id));
    },
    saved: () => [...savedList],
    history: () => [...historyList],
    removeSaved(ids: readonly string[]) {
      savedList = savedList.filter((entry) => !ids.includes(entry.id));
    },
    removeHistory(ids: readonly string[]) {
      historyList = historyList.filter((entry) => !ids.includes(entry.id));
    },
  };
}

/** An account on a fake server, enforcing the saved_verses unique key like the real table. */
function fakeServer(
  options: { user?: string | null; existingHistory?: string[]; highlights?: HighlightRow[] } = {},
) {
  const savedRows = new Map<string, SavedRow>();
  const highlightRows = new Map<string, HighlightRow>();
  const highlightKey = (row: HighlightRow) =>
    `${row.user_id}/${row.translation}/${row.book_id}/${row.chapter}/${row.verse}`;
  for (const row of options.highlights ?? []) highlightRows.set(highlightKey(row), row);
  let failHighlightsOnCall: number | null = null;
  let highlightCalls = 0;
  const historyRows: HistoryRow[] = [];
  const existing = new Set(options.existingHistory ?? []);
  let sessionUser: string | null = options.user === undefined ? USER : options.user;
  let failSavedOnCall: number | null = null;
  let failHistoryOnCall: number | null = null;
  let savedCalls = 0;
  let historyCalls = 0;

  const backend: Backend = {
    verifiedUserId: vi.fn(async () => sessionUser),
    sessionUserId: vi.fn(async () => sessionUser),
    upsertSaved: vi.fn(async (rows: SavedRow[]) => {
      savedCalls += 1;
      if (savedCalls === failSavedOnCall) throw new Error("network down");
      for (const row of rows) {
        const key = `${row.user_id}/${row.translation}/${row.book_id}/${row.chapter}/${row.verse}`;
        if (!savedRows.has(key)) savedRows.set(key, row); // ignoreDuplicates: keep the account's row
      }
    }),
    existingHistoryKeys: vi.fn(async () => new Set(existing)),
    insertHistory: vi.fn(async (rows: HistoryRow[]) => {
      historyCalls += 1;
      if (historyCalls === failHistoryOnCall) throw { message: "insert failed" };
      for (const row of rows) {
        // Insert-or-ignore on the entry key (a chapter's null verse counts as equal).
        const key = `${row.translation}/${row.book_id}/${row.chapter}/${row.verse}`;
        if (existing.has(key)) continue;
        historyRows.push(row);
        existing.add(key);
      }
    }),
    insertHighlights: vi.fn(async (rows: HighlightRow[]) => {
      highlightCalls += 1;
      if (highlightCalls === failHighlightsOnCall) throw new Error("highlights down");
      // Insert-or-ignore on the one-per-verse key: the account's colour wins.
      for (const row of rows)
        if (!highlightRows.has(highlightKey(row))) highlightRows.set(highlightKey(row), row);
    }),
  };

  return {
    backend,
    savedRows,
    historyRows,
    highlightRows,
    failHighlights(call: number | null) {
      failHighlightsOnCall = call;
      highlightCalls = 0;
    },
    switchUser(next: string | null) {
      sessionUser = next;
    },
    failSaved(call: number | null) {
      failSavedOnCall = call;
      savedCalls = 0;
    },
    failHistory(call: number | null) {
      failHistoryOnCall = call;
      historyCalls = 0;
    },
  };
}

describe("mergeGuestLibrary", () => {
  it("adds saved verses and verse history to the signed-in account, then clears them", async () => {
    const store = fakeStore({ saved: [saved(1), saved(2)], history: [viewed(3), viewed(4)] });
    const server = fakeServer();

    const result = await mergeGuestLibrary(USER, server.backend, store);

    expect(result).toMatchObject({ status: "done", savedAdded: 2, historyAdded: 2, remaining: 0 });
    expect([...server.savedRows.values()].every((row) => row.user_id === USER)).toBe(true);
    expect(server.historyRows.every((row) => row.user_id === USER)).toBe(true);
    // Original dates are kept.
    expect(server.savedRows.get(`${USER}/BSB/GEN/1/1`)?.created_at).toBe(saved(1).at);
    expect(server.historyRows[0]?.viewed_at).toBe(viewed(3).at);
    expect(store.saved()).toEqual([]);
    expect(store.history()).toEqual([]);
  });

  it("does nothing, and writes nothing, when the device has nothing to add", async () => {
    const server = fakeServer();
    const result = await mergeGuestLibrary(USER, server.backend, fakeStore({}));
    expect(result.status).toBe("nothing");
    expect(server.backend.verifiedUserId).not.toHaveBeenCalled();
    expect(server.backend.upsertSaved).not.toHaveBeenCalled();
  });

  it("aborts before writing when the server's user is not the expected account", async () => {
    const store = fakeStore({ saved: [saved(1)], history: [viewed(2)] });
    const server = fakeServer({ user: "user-b" });

    const result = await mergeGuestLibrary(USER, server.backend, store);

    expect(result).toMatchObject({ status: "aborted", error: "account mismatch" });
    expect(server.backend.upsertSaved).not.toHaveBeenCalled();
    expect(server.backend.insertHistory).not.toHaveBeenCalled();
    expect(store.saved()).toHaveLength(1);
    expect(store.history()).toHaveLength(1);
  });

  it("aborts when nobody is signed in on the server, or the check fails", async () => {
    const store = fakeStore({ saved: [saved(1)] });
    expect((await mergeGuestLibrary(USER, fakeServer({ user: null }).backend, store)).status).toBe(
      "aborted",
    );

    const failing = fakeServer();
    vi.mocked(failing.backend.verifiedUserId).mockRejectedValueOnce(new Error("offline"));
    const result = await mergeGuestLibrary(USER, failing.backend, store);
    expect(result).toMatchObject({ status: "aborted", error: "offline" });
    expect(store.saved()).toHaveLength(1);
  });

  it("stops between batches if the account changes, keeping the rest on the device", async () => {
    const items = Array.from({ length: MERGE_BATCH_SIZE + 5 }, (_, index) => saved(index + 1));
    const store = fakeStore({ saved: items });
    const server = fakeServer();
    vi.mocked(server.backend.upsertSaved).mockImplementationOnce(async () => {
      server.switchUser("user-b"); // someone else signs in while the first batch is in flight
    });

    const result = await mergeGuestLibrary(USER, server.backend, store);

    expect(result).toMatchObject({ status: "partial", error: "account changed" });
    expect(server.backend.upsertSaved).toHaveBeenCalledTimes(1);
    expect(store.saved()).toHaveLength(5);
  });

  it("keeps unconfirmed items after a partial failure, and a retry finishes without duplicates", async () => {
    const items = Array.from({ length: MERGE_BATCH_SIZE * 2 + 3 }, (_, index) =>
      saved((index % 40) + 1, Math.floor(index / 40) + 1),
    );
    const store = fakeStore({ saved: items, history: [viewed(7)] });
    const server = fakeServer();
    server.failSaved(2);

    const first = await mergeGuestLibrary(USER, server.backend, store);
    expect(first).toMatchObject({ status: "partial", savedAdded: MERGE_BATCH_SIZE });
    expect(first.error).toBe("network down");
    // Only the confirmed first batch left the device; the history was not touched.
    expect(store.saved()).toHaveLength(MERGE_BATCH_SIZE + 3);
    expect(store.history()).toHaveLength(1);

    server.failSaved(null);
    const retry = await mergeGuestLibrary(USER, server.backend, store);
    expect(retry.status).toBe("done");
    expect(server.savedRows.size).toBe(items.length);
    expect(store.saved()).toEqual([]);
    expect(server.historyRows).toHaveLength(1);
  });

  it("never overwrites a verse the account already saved", async () => {
    const server = fakeServer();
    const accountRow: SavedRow = {
      user_id: USER,
      translation: "BSB",
      book_id: "GEN",
      book_name: "Genesis",
      chapter: 1,
      verse: 1,
      verse_text: "account copy",
      created_at: "2025-06-01T00:00:00.000Z",
    };
    server.savedRows.set(`${USER}/BSB/GEN/1/1`, accountRow);

    const result = await mergeGuestLibrary(USER, server.backend, fakeStore({ saved: [saved(1)] }));

    expect(result.status).toBe("done");
    expect(server.savedRows.get(`${USER}/BSB/GEN/1/1`)).toEqual(accountRow);
  });

  it("skips history the account already has and repeats on the device", async () => {
    const store = fakeStore({ history: [viewed(1), viewed(2), viewed(1), viewed(3)] });
    const server = fakeServer({ existingHistory: ["BSB/GEN/1/2"] });

    const result = await mergeGuestLibrary(USER, server.backend, store);

    expect(result).toMatchObject({ status: "done", historyAdded: 2 });
    expect(server.historyRows.map((row) => row.verse).sort()).toEqual([1, 3]);
    expect(store.history()).toEqual([]);
  });

  it("keeps history on the device when its insert fails", async () => {
    const store = fakeStore({ saved: [saved(1)], history: [viewed(2)] });
    const server = fakeServer();
    server.failHistory(1);

    const result = await mergeGuestLibrary(USER, server.backend, store);

    expect(result).toMatchObject({ status: "partial", savedAdded: 1, historyAdded: 0 });
    expect(result.error).toBe("insert failed");
    expect(store.saved()).toEqual([]);
    expect(store.history()).toHaveLength(1);
  });

  it("before the History migration: leaves chapter visits on the device and never sends them", async () => {
    const store = fakeStore({ history: [chapterVisit(2), viewed(5), chapterVisit(3)] });
    const server = fakeServer();

    expect(mergeableCounts(store, false)).toEqual({
      saved: 0,
      history: 1,
      chapters: 0,
      highlights: 0,
      total: 1,
    });
    const result = await mergeGuestLibrary(USER, server.backend, store, {
      accountHistoryV2: false,
    });

    expect(result).toMatchObject({ status: "done", historyAdded: 1, remaining: 2 });
    expect(server.historyRows.every((row) => typeof row.verse === "number")).toBe(true);
    expect(store.history().map((entry) => entry.kind)).toEqual(["chapter", "chapter"]);
  });

  it("is a no-op when run again after finishing", async () => {
    const store = fakeStore({ saved: [saved(1)], history: [viewed(2)] });
    const server = fakeServer();
    await mergeGuestLibrary(USER, server.backend, store);
    const again = await mergeGuestLibrary(USER, server.backend, store);
    expect(again.status).toBe("nothing");
    expect(server.backend.upsertSaved).toHaveBeenCalledTimes(1);
  });
});

describe("mergeGuestLibrary once account History holds chapters", () => {
  const V2 = { accountHistoryV2: true };

  it("adds chapter visits with no verse number, keeping their time, then clears them", async () => {
    const store = fakeStore({ history: [chapterVisit(2), viewed(5), chapterVisit(3)] });
    const server = fakeServer();

    expect(mergeableCounts(store, true)).toEqual({
      saved: 0,
      history: 1,
      chapters: 2,
      highlights: 0,
      total: 3,
    });
    const result = await mergeGuestLibrary(USER, server.backend, store, V2);

    expect(result).toMatchObject({
      status: "done",
      historyAdded: 1,
      chaptersAdded: 2,
      remaining: 0,
    });
    const chapters = server.historyRows.filter((row) => row.kind === "chapter");
    expect(chapters.map((row) => [row.chapter, row.verse, row.user_id])).toEqual([
      [2, null, USER],
      [3, null, USER],
    ]);
    expect(chapters[0]?.viewed_at).toBe(chapterVisit(2).at);
    expect(server.historyRows.find((row) => row.kind === "verse")?.verse).toBe(5);
    expect(store.history()).toEqual([]);
  });

  it("keeps the account's own entry for a chapter it already has, and a retry adds nothing", async () => {
    const store = fakeStore({ history: [chapterVisit(2)] });
    const server = fakeServer({ existingHistory: ["BSB/GEN/2/null"] });

    const first = await mergeGuestLibrary(USER, server.backend, store, V2);
    expect(first.status).toBe("done");
    expect(server.historyRows).toEqual([]);
    expect(store.history()).toEqual([]);

    const again = await mergeGuestLibrary(USER, server.backend, store, V2);
    expect(again.status).toBe("nothing");
  });

  it("keeps chapter visits on the device when their batch fails", async () => {
    const store = fakeStore({ history: [chapterVisit(4)] });
    const server = fakeServer();
    server.failHistory(1);

    const result = await mergeGuestLibrary(USER, server.backend, store, V2);
    expect(result).toMatchObject({ status: "partial", chaptersAdded: 0 });
    expect(store.history()).toHaveLength(1);
  });

  it("stops before chapter visits if the account changed", async () => {
    const store = fakeStore({ history: [viewed(1), chapterVisit(4)] });
    const server = fakeServer();
    vi.mocked(server.backend.insertHistory).mockImplementationOnce(async () => {
      server.switchUser("user-b");
    });

    const result = await mergeGuestLibrary(USER, server.backend, store, V2);
    expect(result).toMatchObject({ status: "partial", error: "account changed" });
    expect(store.history().map((entry) => entry.kind)).toEqual(["chapter"]);
  });

  it("doesn't send the kind column before the migration is switched on", async () => {
    const server = fakeServer();
    await mergeGuestLibrary(USER, server.backend, fakeStore({ history: [viewed(1)] }), {
      accountHistoryV2: false,
    });
    expect(server.historyRows).toHaveLength(1);
    expect(server.historyRows[0]).not.toHaveProperty("kind");
  });
});

describe("mergeGuestLibrary with highlights", () => {
  const ON = { accountHighlights: true };

  it("adds the device's highlights to the signed-in account, then clears them", async () => {
    const store = fakeStore({ highlights: [highlight(1, "sage"), highlight(2, "rose", "KJAV")] });
    const server = fakeServer();

    expect(mergeableCounts(store, true, true)).toMatchObject({ highlights: 2, total: 2 });
    const result = await mergeGuestLibrary(USER, server.backend, store, ON);

    expect(result).toMatchObject({ status: "done", highlightsAdded: 2, remaining: 0 });
    const rows = [...server.highlightRows.values()];
    expect(rows.map((row) => [row.user_id, row.translation, row.verse, row.color])).toEqual([
      [USER, "BSB", 1, "sage"],
      [USER, "KJAV", 2, "rose"],
    ]);
    expect(rows[0]?.created_at).toBe(highlight(1).at);
    expect(store.highlights()).toEqual([]);
  });

  it("keeps the account's colour where the verse is already highlighted (no duplicates)", async () => {
    const accountRow: HighlightRow = {
      user_id: USER,
      translation: "BSB",
      book_id: "GEN",
      chapter: 1,
      verse: 1,
      color: "lilac",
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    };
    const server = fakeServer({ highlights: [accountRow] });
    const store = fakeStore({ highlights: [highlight(1, "amber")] });

    const result = await mergeGuestLibrary(USER, server.backend, store, ON);

    expect(result.status).toBe("done");
    expect(server.highlightRows.size).toBe(1);
    expect([...server.highlightRows.values()][0]).toEqual(accountRow);
    expect(await mergeGuestLibrary(USER, server.backend, store, ON)).toMatchObject({
      status: "nothing",
    });
  });

  it("keeps highlights on the device when their batch fails, and a retry finishes", async () => {
    const store = fakeStore({ highlights: [highlight(1), highlight(2)] });
    const server = fakeServer();
    server.failHighlights(1);

    expect(await mergeGuestLibrary(USER, server.backend, store, ON)).toMatchObject({
      status: "partial",
      highlightsAdded: 0,
      error: "highlights down",
    });
    expect(store.highlights()).toHaveLength(2);

    server.failHighlights(null);
    expect(await mergeGuestLibrary(USER, server.backend, store, ON)).toMatchObject({
      status: "done",
      highlightsAdded: 2,
    });
    expect(server.highlightRows.size).toBe(2);
  });

  it("aborts before writing highlights to a different account", async () => {
    const store = fakeStore({ highlights: [highlight(1)] });
    const server = fakeServer({ user: "user-b" });
    expect(await mergeGuestLibrary(USER, server.backend, store, ON)).toMatchObject({
      status: "aborted",
    });
    expect(server.backend.insertHighlights).not.toHaveBeenCalled();
    expect(store.highlights()).toHaveLength(1);
  });

  it("stops before highlights if the account changed mid-way", async () => {
    const store = fakeStore({ saved: [saved(1)], highlights: [highlight(1)] });
    const server = fakeServer();
    vi.mocked(server.backend.upsertSaved).mockImplementationOnce(async () => {
      server.switchUser("user-b");
    });
    expect(await mergeGuestLibrary(USER, server.backend, store, ON)).toMatchObject({
      status: "partial",
      error: "account changed",
    });
    expect(server.backend.insertHighlights).not.toHaveBeenCalled();
    expect(store.highlights()).toHaveLength(1);
  });

  it("before the highlights table exists: doesn't offer or send highlights", async () => {
    const store = fakeStore({ highlights: [highlight(1)] });
    const server = fakeServer();
    expect(mergeableCounts(store, true, false)).toMatchObject({ highlights: 0, total: 0 });
    const result = await mergeGuestLibrary(USER, server.backend, store, {
      accountHighlights: false,
    });
    expect(result.status).toBe("nothing");
    expect(server.backend.insertHighlights).not.toHaveBeenCalled();
    expect(store.highlights()).toHaveLength(1);
  });
});
