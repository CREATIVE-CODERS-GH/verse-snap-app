import { beforeEach, describe, expect, it, vi } from "vitest";

// Signed-in History against a recorded fake of the Supabase query builder, before and after the
// chapter-entries migration is switched on (history-schema.ts).

const flags = vi.hoisted(() => ({ v2: false }));
vi.mock("./history-schema", () => ({
  get ACCOUNT_HISTORY_V2() {
    return flags.v2;
  },
  HISTORY_ENTRY_KEY: "user_id,translation,book_id,chapter,verse",
}));

type Call = { table: string; steps: [string, unknown[]][] };
const calls: Call[] = [];
let nextResult: { data: unknown; error: unknown } = { data: null, error: null };

function builder(table: string) {
  const call: Call = { table, steps: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "eq", "in", "delete", "insert", "upsert"]) {
    chain[method] = (...args: unknown[]) => {
      call.steps.push([method, args]);
      return chain;
    };
  }
  chain["then"] = (resolve: (value: unknown) => unknown) => resolve(nextResult);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => builder(table) },
}));

const { library } = await import("./library");

const USER = "user-1";
const verse = {
  translation: "KJAV",
  bookId: "john",
  bookName: "John",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world",
  reference: "John 3:16",
};
const visit = { translation: "KJAV", bookId: "romans", bookName: "Romans", chapter: 12 };
const methods = (call: Call | undefined) => call?.steps.map(([method]) => method) ?? [];
const args = (call: Call | undefined, method: string) =>
  call?.steps.find(([name]) => name === method)?.[1];

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: null, error: null };
  flags.v2 = false;
});

describe("signed-in History before the migration is switched on", () => {
  it("records a verse view with the existing delete-then-insert (unchanged)", async () => {
    await library.recordView(verse, USER);
    expect(calls.map((call) => call.table)).toEqual(["history", "history"]);
    expect(methods(calls[0])).toEqual(["delete", "eq", "eq", "eq", "eq", "eq"]);
    expect(methods(calls[1])).toEqual(["insert"]);
    const row = args(calls[1], "insert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({ user_id: USER, book_id: "john", chapter: 3, verse: 16 });
    expect(row).not.toHaveProperty("kind");
  });

  it("does not send chapter visits to the account", async () => {
    expect(await library.recordChapterVisit(visit, USER)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reads rows without a kind column as verse entries", async () => {
    nextResult = {
      data: [
        {
          id: "1",
          translation: "KJAV",
          book_id: "john",
          book_name: "John",
          chapter: 3,
          verse: 16,
          verse_text: "…",
          viewed_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    };
    const [entry] = await library.listHistory(100, USER);
    expect(entry).toMatchObject({ kind: "verse", verse: 16, at: "2026-01-01T00:00:00.000Z" });
  });
});

describe("signed-in History once the migration is switched on", () => {
  beforeEach(() => {
    flags.v2 = true;
  });

  it("records a chapter visit as one upsert with no verse number", async () => {
    expect(await library.recordChapterVisit(visit, USER)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(methods(calls[0])).toEqual(["upsert"]);
    const [row, options] = args(calls[0], "upsert") as [Record<string, unknown>, unknown];
    expect(row).toMatchObject({
      user_id: USER,
      kind: "chapter",
      translation: "KJAV",
      book_id: "romans",
      book_name: "Romans",
      chapter: 12,
      verse: null,
    });
    expect(typeof row["viewed_at"]).toBe("string");
    expect(options).toEqual({ onConflict: "user_id,translation,book_id,chapter,verse" });
  });

  it("records a verse view as one atomic upsert instead of delete-then-insert", async () => {
    await library.recordView(verse, USER);
    expect(calls).toHaveLength(1);
    expect(methods(calls[0])).toEqual(["upsert"]);
    const [row, options] = args(calls[0], "upsert") as [Record<string, unknown>, unknown];
    expect(row).toMatchObject({ user_id: USER, kind: "verse", verse: 16 });
    expect(typeof row["viewed_at"]).toBe("string");
    expect(options).toEqual({ onConflict: "user_id,translation,book_id,chapter,verse" });
  });

  it("reports a failed write so the screen can ignore it", async () => {
    nextResult = { data: null, error: { message: "network" } };
    await expect(library.recordChapterVisit(visit, USER)).rejects.toMatchObject({
      message: "network",
    });
  });

  it("reads chapter and verse rows from the account", async () => {
    const base = {
      translation: "KJAV",
      book_id: "romans",
      book_name: "Romans",
      chapter: 12,
      verse_text: "",
      viewed_at: "2026-01-01T00:00:00.000Z",
    };
    nextResult = {
      data: [
        { ...base, id: "c", kind: "chapter", verse: null },
        { ...base, id: "v", kind: "verse", verse: 2 },
      ],
      error: null,
    };
    const entries = await library.listHistory(100, USER);
    expect(entries.map((entry) => [entry.kind, entry.verse])).toEqual([
      ["chapter", null],
      ["verse", 2],
    ]);
  });

  it("still keeps guest chapter visits on the device when signed out", async () => {
    vi.stubGlobal("window", {
      localStorage: (await import("@/test/memory-storage")).memoryStorage(),
    });
    expect(await library.recordChapterVisit(visit)).toBe(true);
    expect(calls).toEqual([]);
  });
});
