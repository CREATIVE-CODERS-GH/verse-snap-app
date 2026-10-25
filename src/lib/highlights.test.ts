import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/memory-storage";

const flags = vi.hoisted(() => ({ accounts: false }));
vi.mock("./highlights-schema", () => ({
  get ACCOUNT_HIGHLIGHTS_ENABLED() {
    return flags.accounts;
  },
}));

type Call = { table: string; steps: [string, unknown[]][] };
const calls: Call[] = [];
let nextResult: { data: unknown; error: unknown } = { data: null, error: null };
const session = vi.hoisted(() => ({ userId: "user-1" as string | null }));
function builder(table: string) {
  const call: Call = { table, steps: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "delete", "upsert"]) {
    chain[method] = (...args: unknown[]) => {
      call.steps.push([method, args]);
      return chain;
    };
  }
  chain["then"] = (resolve: (value: unknown) => unknown) => resolve(nextResult);
  return chain;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: {
      getSession: async () => ({
        data: { session: session.userId ? { user: { id: session.userId } } : null },
      }),
    },
  },
}));

const { GUEST_HIGHLIGHTS_KEY, guestHighlights, highlights } = await import("./highlights");

const USER = "user-1";
const john3 = (verse: number, translation = "KJAV") => ({
  translation,
  bookId: "john",
  chapter: 3,
  verse,
});

let storage: Storage;
beforeEach(() => {
  calls.length = 0;
  nextResult = { data: null, error: null };
  flags.accounts = false;
  session.userId = USER;
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

describe("guest highlights (this device)", () => {
  it("are stored and read back after a reload (they live in localStorage)", async () => {
    await highlights.set(john3(16), "sage");
    await highlights.set(john3(17), "rose");
    // A fresh page reads the same storage.
    vi.stubGlobal("window", { localStorage: storage });
    expect(await highlights.forChapter("KJAV", "john", 3)).toEqual({ 16: "sage", 17: "rose" });
    expect(JSON.parse(storage.getItem(GUEST_HIGHLIGHTS_KEY) ?? "[]")).toHaveLength(2);
  });

  it("keep one highlight per verse: changing the colour replaces it", async () => {
    await highlights.set(john3(16), "sage");
    await highlights.set(john3(16), "lilac");
    expect(await highlights.forChapter("KJAV", "john", 3)).toEqual({ 16: "lilac" });
    expect(guestHighlights.all()).toHaveLength(1);
  });

  it("can be removed", async () => {
    await highlights.set(john3(16), "sage");
    await highlights.set(john3(17), "amber");
    await highlights.remove(john3(16));
    expect(await highlights.forChapter("KJAV", "john", 3)).toEqual({ 17: "amber" });
  });

  it("belong to the translation they were made in", async () => {
    await highlights.set(john3(16, "KJAV"), "sage");
    await highlights.set(john3(16, "WEB"), "rose");
    expect(await highlights.forChapter("KJAV", "john", 3)).toEqual({ 16: "sage" });
    expect(await highlights.forChapter("WEB", "john", 3)).toEqual({ 16: "rose" });
    expect(await highlights.forChapter("BSB", "john", 3)).toEqual({});
    await highlights.remove(john3(16, "WEB"));
    expect(await highlights.forChapter("KJAV", "john", 3)).toEqual({ 16: "sage" });
  });

  it("are read only for the requested chapter", async () => {
    await highlights.set(john3(16), "sage");
    await highlights.set({ translation: "KJAV", bookId: "john", chapter: 4, verse: 1 }, "rose");
    expect(await highlights.forChapter("KJAV", "john", 4)).toEqual({ 1: "rose" });
  });

  it("ignore damaged or unknown stored entries", async () => {
    storage.setItem(
      GUEST_HIGHLIGHTS_KEY,
      JSON.stringify([
        {
          id: "KJAV/john/3/16",
          translation: "KJAV",
          bookId: "john",
          chapter: 3,
          verse: 16,
          color: "amber",
          at: "x",
        },
        {
          id: "KJAV/john/3/17",
          translation: "KJAV",
          bookId: "john",
          chapter: 3,
          verse: 17,
          color: "neon",
          at: "x",
        },
        { broken: true },
      ]),
    );
    expect(await highlights.forChapter("KJAV", "john", 3)).toEqual({ 16: "amber" });
  });

  it("never call the server", async () => {
    await highlights.set(john3(16), "sage");
    await highlights.remove(john3(16));
    await highlights.forChapter("KJAV", "john", 3);
    expect(calls).toEqual([]);
  });
});

describe("signed-in highlights before the account table exists", () => {
  it("are a preview only: nothing is sent and nothing is kept on the device", async () => {
    expect(highlights.persists(USER)).toBe(false);
    await highlights.set(john3(16), "sage", USER);
    expect(await highlights.forChapter("KJAV", "john", 3, USER)).toEqual({});
    expect(calls).toEqual([]);
    expect(storage.getItem(GUEST_HIGHLIGHTS_KEY)).toBeNull();
  });
});

describe("signed-in highlights once enabled", () => {
  beforeEach(() => {
    flags.accounts = true;
  });

  it("are saved to the account as one upsert on the one-per-verse key", async () => {
    expect(highlights.persists(USER)).toBe(true);
    await highlights.set(john3(16), "sky", USER);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("highlights");
    const [method, [row, options]] = calls[0]!.steps[0] as [
      string,
      [Record<string, unknown>, unknown],
    ];
    expect(method).toBe("upsert");
    expect(row).toMatchObject({
      user_id: USER,
      translation: "KJAV",
      book_id: "john",
      chapter: 3,
      verse: 16,
      color: "sky",
    });
    expect(typeof row["updated_at"]).toBe("string");
    expect(options).toEqual({ onConflict: "user_id,translation,book_id,chapter,verse" });
    expect(storage.getItem(GUEST_HIGHLIGHTS_KEY)).toBeNull();
  });

  it("are removed from the account by exact verse, translation and user", async () => {
    await highlights.remove(john3(16, "WEB"), USER);
    expect(calls[0]?.steps).toEqual([
      ["delete", []],
      ["eq", ["user_id", USER]],
      ["eq", ["translation", "WEB"]],
      ["eq", ["book_id", "john"]],
      ["eq", ["chapter", 3]],
      ["eq", ["verse", 16]],
    ]);
  });

  it("are read per chapter and translation from the account", async () => {
    nextResult = {
      data: [
        { verse: 16, color: "rose" },
        { verse: 17, color: "unknown" },
      ],
      error: null,
    };
    expect(await highlights.forChapter("WEB", "john", 3, USER)).toEqual({ 16: "rose" });
    expect(calls[0]?.steps).toEqual([
      ["select", ["verse, color"]],
      ["eq", ["translation", "WEB"]],
      ["eq", ["book_id", "john"]],
      ["eq", ["chapter", 3]],
    ]);
  });

  it("skip a queued change if that person has signed out or another account signed in", async () => {
    session.userId = "user-2";
    await expect(highlights.set(john3(16), "sky", USER)).rejects.toThrow("account changed");
    await expect(highlights.remove(john3(16), USER)).rejects.toThrow("account changed");
    session.userId = null;
    await expect(highlights.set(john3(16), "sky", USER)).rejects.toThrow("account changed");
    expect(calls).toEqual([]);
  });

  it("report failures so the reader can undo and say so", async () => {
    nextResult = { data: null, error: { message: "offline" } };
    await expect(highlights.set(john3(16), "sky", USER)).rejects.toMatchObject({
      message: "offline",
    });
    await expect(highlights.forChapter("KJAV", "john", 3, USER)).rejects.toMatchObject({
      message: "offline",
    });
  });
});
