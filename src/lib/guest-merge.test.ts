import { describe, expect, it, vi } from "vitest";
import type { GuestHighlight } from "./highlights";
import type { Notebook, Reflection } from "./journal";
import type { HistoryEntry, LibraryEntry } from "./library";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { MERGE_BATCH_SIZE, mergeGuestLibrary, mergeableCounts } = await import("./guest-merge");
type Backend = import("./guest-merge").MergeBackend;
type SavedRow = import("./guest-merge").SavedRow;
type HistoryRow = import("./guest-merge").HistoryRow;
type HighlightRow = import("./guest-merge").HighlightRow;
type NotebookRow = import("./guest-merge").NotebookRow;
type ReflectionRow = import("./guest-merge").ReflectionRow;

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

const GENERAL: Notebook = {
  id: "general",
  name: "General Reflections",
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function notebook(id: string, name: string): Notebook {
  return { ...GENERAL, id, name, isDefault: false };
}

function reflection(
  id: string,
  verse: number,
  notebookId = "general",
  body = "A note",
): Reflection {
  return {
    id,
    notebookId,
    translation: "KJAV",
    bookId: "john",
    chapter: 3,
    verse,
    title: "",
    body,
    tags: ["#Faith"],
    posture: "grateful",
    isPrivate: true,
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
  };
}

/** The device's guest lists, with the same remove-by-id behaviour as the real store. */
function fakeStore(initial: {
  saved?: LibraryEntry[];
  history?: HistoryEntry[];
  highlights?: GuestHighlight[];
  notebooks?: Notebook[];
  reflections?: Reflection[];
}) {
  let savedList = [...(initial.saved ?? [])];
  let historyList = [...(initial.history ?? [])];
  let highlightList = [...(initial.highlights ?? [])];
  let notebookList = [GENERAL, ...(initial.notebooks ?? [])];
  let reflectionList = [...(initial.reflections ?? [])];
  const kept = new Map<string, string[]>();
  return {
    journal: () => ({ notebooks: [...notebookList], reflections: [...reflectionList] }),
    removeReflections(ids: readonly string[]) {
      reflectionList = reflectionList.filter((entry) => !ids.includes(entry.id));
    },
    removeNotebooks(ids: readonly string[]) {
      notebookList = notebookList.filter((entry) => entry.isDefault || !ids.includes(entry.id));
      reflectionList = reflectionList.map((entry) =>
        ids.includes(entry.notebookId) ? { ...entry, notebookId: "general" } : entry,
      );
    },
    keptReflections: (userId: string) => kept.get(userId) ?? [],
    markKeptReflections(userId: string, ids: readonly string[]) {
      kept.set(userId, [...(kept.get(userId) ?? []), ...ids]);
    },
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
  options: {
    user?: string | null;
    existingHistory?: string[];
    highlights?: HighlightRow[];
    notebooks?: { id: string; name: string; isDefault: boolean }[];
    reflections?: ReflectionRow[];
  } = {},
) {
  const accountNotebooks = [
    ...(options.notebooks ?? [
      { id: "acct-general", name: "General Reflections", isDefault: true },
    ]),
  ];
  const insertedNotebooks: NotebookRow[] = [];
  const reflectionRows = new Map<string, ReflectionRow>();
  const reflectionKey = (row: ReflectionRow) =>
    `${row.user_id}/${row.translation}/${row.book_id}/${row.chapter}/${row.verse}`;
  for (const row of options.reflections ?? []) reflectionRows.set(reflectionKey(row), row);
  let failReflectionsOnCall: number | null = null;
  let reflectionCalls = 0;
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
    accountNotebooks: vi.fn(async () => [...accountNotebooks]),
    insertNotebooks: vi.fn(async (rows: NotebookRow[]) => {
      for (const row of rows) {
        if (accountNotebooks.some((item) => item.id === row.id)) continue; // a retry
        if (accountNotebooks.some((item) => item.name.toLowerCase() === row.name.toLowerCase()))
          throw { code: "23505", message: "duplicate notebook name" };
        accountNotebooks.push({ id: row.id, name: row.name, isDefault: false });
        insertedNotebooks.push(row);
      }
    }),
    insertReflections: vi.fn(async (rows: ReflectionRow[]) => {
      reflectionCalls += 1;
      if (reflectionCalls === failReflectionsOnCall) throw new Error("journal down");
      // Insert-or-ignore on the one-per-verse key: the account's own note wins.
      for (const row of rows) {
        if (!accountNotebooks.some((item) => item.id === row.notebook_id))
          throw new Error("foreign key: unknown notebook");
        if (!reflectionRows.has(reflectionKey(row))) reflectionRows.set(reflectionKey(row), row);
      }
    }),
    reflectionIds: vi.fn(
      async (ids: string[]) =>
        new Set([...reflectionRows.values()].map((row) => row.id).filter((id) => ids.includes(id))),
    ),
  };

  return {
    backend,
    savedRows,
    historyRows,
    highlightRows,
    reflectionRows,
    accountNotebooks,
    insertedNotebooks,
    failReflections(call: number | null) {
      failReflectionsOnCall = call;
      reflectionCalls = 0;
    },
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

    expect(mergeableCounts(store, { accountHistoryV2: false })).toEqual({
      saved: 0,
      history: 1,
      chapters: 0,
      highlights: 0,
      reflections: 0,
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

    expect(mergeableCounts(store, { accountHistoryV2: true })).toEqual({
      saved: 0,
      history: 1,
      chapters: 2,
      highlights: 0,
      reflections: 0,
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

    expect(
      mergeableCounts(store, { accountHistoryV2: true, accountHighlights: true }),
    ).toMatchObject({ highlights: 2, total: 2 });
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
    expect(
      mergeableCounts(store, { accountHistoryV2: true, accountHighlights: false }),
    ).toMatchObject({ highlights: 0, total: 0 });
    const result = await mergeGuestLibrary(USER, server.backend, store, {
      accountHighlights: false,
    });
    expect(result.status).toBe("nothing");
    expect(server.backend.insertHighlights).not.toHaveBeenCalled();
    expect(store.highlights()).toHaveLength(1);
  });
});

describe("mergeGuestLibrary with the reflection journal", () => {
  const ON = { accountJournal: true };
  const R1 = "11111111-1111-4111-8111-111111111111";
  const R2 = "22222222-2222-4222-8222-222222222222";
  const R3 = "33333333-3333-4333-8333-333333333333";
  const NB_PRAYER = "44444444-4444-4444-8444-444444444444";
  const NB_SERMON = "55555555-5555-4555-8555-555555555555";

  it("adds reflections with consent, joining General to General and keeping their dates", async () => {
    const store = fakeStore({ reflections: [reflection(R1, 16), reflection(R2, 17)] });
    const server = fakeServer();

    expect(mergeableCounts(store, ON)).toMatchObject({ reflections: 2, total: 2 });
    const result = await mergeGuestLibrary(USER, server.backend, store, ON);

    expect(result).toMatchObject({ status: "done", reflectionsAdded: 2, reflectionsKept: 0 });
    const rows = [...server.reflectionRows.values()];
    expect(rows.map((row) => [row.id, row.user_id, row.notebook_id, row.verse])).toEqual([
      [R1, USER, "acct-general", 16],
      [R2, USER, "acct-general", 17],
    ]);
    expect(rows[0]).toMatchObject({
      tags: ["#Faith"],
      posture: "grateful",
      created_at: "2026-03-01T10:00:00.000Z",
      updated_at: "2026-03-02T10:00:00.000Z",
    });
    expect(store.journal().reflections).toEqual([]);
  });

  it("joins a device notebook to the account's notebook of the same name, and adds new ones by id", async () => {
    const store = fakeStore({
      notebooks: [notebook(NB_PRAYER, "prayer journal"), notebook(NB_SERMON, "Sermon Notes")],
      reflections: [reflection(R1, 16, NB_PRAYER), reflection(R2, 17, NB_SERMON)],
    });
    const server = fakeServer({
      notebooks: [
        { id: "acct-general", name: "General Reflections", isDefault: true },
        { id: "acct-prayer", name: "Prayer Journal", isDefault: false },
      ],
    });

    await mergeGuestLibrary(USER, server.backend, store, ON);

    expect(server.insertedNotebooks.map((row) => [row.id, row.name, row.user_id])).toEqual([
      [NB_SERMON, "Sermon Notes", USER],
    ]);
    const byId = new Map([...server.reflectionRows.values()].map((row) => [row.id, row]));
    expect(byId.get(R1)?.notebook_id).toBe("acct-prayer");
    expect(byId.get(R2)?.notebook_id).toBe(NB_SERMON);
    expect(store.journal().notebooks.map((item) => item.id)).toEqual(["general"]);
  });

  it("never overwrites an account note: the device's copy stays and isn't offered again", async () => {
    const accountNote: ReflectionRow = {
      id: "acct-note",
      user_id: USER,
      notebook_id: "acct-general",
      translation: "KJAV",
      book_id: "john",
      chapter: 3,
      verse: 16,
      title: "",
      body: "The account's own note",
      tags: [],
      posture: null,
      is_private: true,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    };
    const store = fakeStore({ reflections: [reflection(R1, 16), reflection(R2, 18)] });
    const server = fakeServer({ reflections: [accountNote] });

    const result = await mergeGuestLibrary(USER, server.backend, store, ON);

    expect(result).toMatchObject({ status: "done", reflectionsAdded: 1, reflectionsKept: 1 });
    expect([...server.reflectionRows.values()].find((row) => row.verse === 16)).toEqual(
      accountNote,
    );
    expect(store.journal().reflections.map((item) => item.id)).toEqual([R1]);
    // Not offered to this account again; still offered to someone else signing in on the device.
    expect(mergeableCounts(store, { ...ON, userId: USER }).reflections).toBe(0);
    expect(mergeableCounts(store, { ...ON, userId: "user-c" }).reflections).toBe(1);
    expect(await mergeGuestLibrary(USER, server.backend, store, ON)).toMatchObject({
      status: "nothing",
    });
  });

  it("is retry-safe: an interrupted import finishes without duplicates", async () => {
    const store = fakeStore({
      notebooks: [notebook(NB_SERMON, "Sermon Notes")],
      reflections: [reflection(R1, 16, NB_SERMON), reflection(R2, 17)],
    });
    const server = fakeServer();
    server.failReflections(1);

    const first = await mergeGuestLibrary(USER, server.backend, store, ON);
    expect(first).toMatchObject({ status: "partial", reflectionsAdded: 0, error: "journal down" });
    expect(store.journal().reflections).toHaveLength(2);
    expect(store.journal().notebooks).toHaveLength(2);

    server.failReflections(null);
    const retry = await mergeGuestLibrary(USER, server.backend, store, ON);
    expect(retry).toMatchObject({ status: "done", reflectionsAdded: 2 });
    expect(server.reflectionRows.size).toBe(2);
    expect(server.insertedNotebooks).toHaveLength(1);
    expect(store.journal().reflections).toEqual([]);
  });

  it("aborts before writing to a different account, and stops if the account changes", async () => {
    const store = fakeStore({ reflections: [reflection(R1, 16)] });
    const other = fakeServer({ user: "user-b" });
    expect(await mergeGuestLibrary(USER, other.backend, store, ON)).toMatchObject({
      status: "aborted",
    });
    expect(other.backend.insertReflections).not.toHaveBeenCalled();

    const switching = fakeServer();
    vi.mocked(switching.backend.accountNotebooks).mockImplementationOnce(async () => {
      switching.switchUser("user-b");
      return [{ id: "acct-general", name: "General Reflections", isDefault: true }];
    });
    expect(await mergeGuestLibrary(USER, switching.backend, store, ON)).toMatchObject({
      status: "partial",
      error: "account changed",
    });
    expect(switching.backend.insertReflections).not.toHaveBeenCalled();
    expect(store.journal().reflections).toHaveLength(1);
  });

  it("doesn't offer empty or oversized notes the account can't store", () => {
    const empty = { ...reflection(R1, 16), title: " ", body: "  " };
    const tooManyTags = {
      ...reflection(R2, 17),
      tags: Array.from({ length: 21 }, (_, i) => `#t${i}`),
    };
    const store = fakeStore({ reflections: [empty, tooManyTags, reflection(R3, 18)] });
    expect(mergeableCounts(store, ON).reflections).toBe(1);
  });

  it("before the journal tables exist: doesn't offer or send reflections", async () => {
    const store = fakeStore({ reflections: [reflection(R1, 16)] });
    const server = fakeServer();
    expect(mergeableCounts(store, { accountJournal: false }).reflections).toBe(0);
    const result = await mergeGuestLibrary(USER, server.backend, store, { accountJournal: false });
    expect(result.status).toBe("nothing");
    expect(server.backend.accountNotebooks).not.toHaveBeenCalled();
    expect(store.journal().reflections).toHaveLength(1);
  });
});
