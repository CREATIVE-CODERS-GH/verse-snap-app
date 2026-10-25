import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/memory-storage";

const flags = vi.hoisted(() => ({ accounts: false }));
vi.mock("./journal-schema", () => ({
  get ACCOUNT_JOURNAL_ENABLED() {
    return flags.accounts;
  },
}));

// A recorded fake of the Supabase query builder: each call returns the next queued result.
type Call = { table: string; steps: [string, unknown[]][] };
const calls: Call[] = [];
const results: { data: unknown; error: unknown }[] = [];
const session = vi.hoisted(() => ({ userId: "user-1" as string | null }));
function builder(table: string) {
  const call: Call = { table, steps: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "order",
    "limit",
    "maybeSingle",
    "single",
  ]) {
    chain[method] = (...args: unknown[]) => {
      call.steps.push([method, args]);
      return chain;
    };
  }
  chain["then"] = (resolve: (value: unknown) => unknown) =>
    resolve(results.shift() ?? { data: null, error: null });
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

const {
  DEFAULT_NOTEBOOK_NAME,
  GUEST_DEFAULT_NOTEBOOK_ID,
  GUEST_JOURNAL_KEY,
  guestJournal,
  journal,
} = await import("./journal");
type ReflectionDraft = import("./journal").ReflectionDraft;

const USER = "user-1";
const key = (verse: number, translation = "KJAV") => ({
  translation,
  bookId: "john",
  chapter: 3,
  verse,
});
const draft = (overrides: Partial<ReflectionDraft> = {}): ReflectionDraft => ({
  notebookId: GUEST_DEFAULT_NOTEBOOK_ID,
  title: "Love",
  body: "God so loved the world",
  tags: ["#Faith"],
  posture: "grateful",
  isPrivate: true,
  ...overrides,
});

let storage: Storage;
beforeEach(() => {
  calls.length = 0;
  results.length = 0;
  flags.accounts = false;
  session.userId = USER;
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

describe("guest journal (this device)", () => {
  it("always has General Reflections, which can be renamed but not deleted", async () => {
    const [general] = await journal.listNotebooks();
    expect(general).toMatchObject({ id: GUEST_DEFAULT_NOTEBOOK_ID, name: DEFAULT_NOTEBOOK_NAME });
    await expect(journal.deleteNotebook(GUEST_DEFAULT_NOTEBOOK_ID)).rejects.toMatchObject({
      code: "default-notebook",
    });
    await journal.renameNotebook(GUEST_DEFAULT_NOTEBOOK_ID, "My Journal");
    expect((await journal.listNotebooks())[0]?.name).toBe("My Journal");
  });

  it("saves a reflection that survives a reload, and reopens it for its verse", async () => {
    const result = await journal.saveReflection(key(16), draft(), null);
    expect(result.status).toBe("saved");
    vi.stubGlobal("window", { localStorage: storage }); // a fresh page, same storage
    const reopened = await journal.getReflection(key(16));
    expect(reopened).toMatchObject({
      title: "Love",
      body: "God so loved the world",
      tags: ["#Faith"],
    });
    expect(JSON.parse(storage.getItem(GUEST_JOURNAL_KEY) ?? "{}").reflections).toHaveLength(1);
  });

  it("edits keep one reflection per verse, and an older copy can't overwrite a newer one", async () => {
    const first = await journal.saveReflection(key(16), draft(), null);
    if (first.status !== "saved") throw new Error("not saved");
    const base = { id: first.reflection.id, updatedAt: first.reflection.updatedAt };
    await new Promise((resolve) => setTimeout(resolve, 2));
    const edited = await journal.saveReflection(key(16), draft({ body: "Edited" }), base);
    expect(edited.status).toBe("saved");
    // Saving again from the version before the edit is a conflict, and changes nothing.
    const stale = await journal.saveReflection(key(16), draft({ body: "Stale" }), base);
    expect(stale).toMatchObject({ status: "conflict", current: { body: "Edited" } });
    expect((await journal.listReflections()).map((item) => item.body)).toEqual(["Edited"]);
  });

  it("treats a new note on a verse that already has one as a conflict", async () => {
    await journal.saveReflection(key(16), draft(), null);
    expect(await journal.saveReflection(key(16), draft({ body: "Second" }), null)).toMatchObject({
      status: "conflict",
    });
  });

  it("keeps reflections per translation", async () => {
    await journal.saveReflection(key(16, "KJAV"), draft({ body: "KJAV note" }), null);
    await journal.saveReflection(key(16, "WEB"), draft({ body: "WEB note" }), null);
    expect((await journal.getReflection(key(16, "KJAV")))?.body).toBe("KJAV note");
    expect((await journal.getReflection(key(16, "WEB")))?.body).toBe("WEB note");
    expect(await journal.getReflection(key(16, "BSB"))).toBeNull();
  });

  it("refuses an empty or oversized reflection", async () => {
    await expect(
      journal.saveReflection(key(16), draft({ title: " ", body: "  " }), null),
    ).rejects.toMatchObject({ code: "empty" });
    await expect(
      journal.saveReflection(
        key(16),
        draft({ tags: Array.from({ length: 21 }, (_, i) => `#${i}`) }),
        null,
      ),
    ).rejects.toMatchObject({ code: "too-long" });
  });

  it("deletes a reflection", async () => {
    const saved = await journal.saveReflection(key(16), draft(), null);
    if (saved.status !== "saved") throw new Error("not saved");
    await journal.deleteReflection(saved.reflection.id);
    expect(await journal.getReflection(key(16))).toBeNull();
  });

  it("creates, renames and deletes notebooks; names are unique ignoring case", async () => {
    const prayer = await journal.createNotebook("  Prayer   Journal ");
    expect(prayer.name).toBe("Prayer Journal");
    await expect(journal.createNotebook("prayer journal")).rejects.toMatchObject({
      code: "name-taken",
    });
    await expect(journal.createNotebook("   ")).rejects.toMatchObject({ code: "name-invalid" });
    await journal.renameNotebook(prayer.id, "Prayers");
    await expect(journal.renameNotebook(prayer.id, "general reflections")).rejects.toMatchObject({
      code: "name-taken",
    });
    expect((await journal.listNotebooks()).map((item) => item.name)).toEqual([
      DEFAULT_NOTEBOOK_NAME,
      "Prayers",
    ]);
  });

  it("deleting a notebook moves its reflections to General (nothing is lost)", async () => {
    const prayer = await journal.createNotebook("Prayer");
    await journal.saveReflection(key(16), draft({ notebookId: prayer.id }), null);
    await journal.deleteNotebook(prayer.id);
    expect((await journal.getReflection(key(16)))?.notebookId).toBe(GUEST_DEFAULT_NOTEBOOK_ID);
    expect(await journal.listNotebooks()).toHaveLength(1);
  });

  it("ignores damaged stored entries and files orphaned notes under General", async () => {
    storage.setItem(
      GUEST_JOURNAL_KEY,
      JSON.stringify({
        notebooks: [
          { id: "not-a-uuid", name: "Bad", isDefault: false, createdAt: "x", updatedAt: "x" },
        ],
        reflections: [
          { broken: true },
          {
            id: "11111111-1111-4111-8111-111111111111",
            notebookId: "gone",
            translation: "KJAV",
            bookId: "john",
            chapter: 3,
            verse: 16,
            title: "",
            body: "Kept",
            tags: [],
            posture: null,
            isPrivate: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const read = guestJournal.read();
    expect(read.notebooks.map((item) => item.id)).toEqual([GUEST_DEFAULT_NOTEBOOK_ID]);
    expect(read.reflections.map((item) => [item.body, item.notebookId])).toEqual([
      ["Kept", GUEST_DEFAULT_NOTEBOOK_ID],
    ]);
  });

  it("never calls the server", async () => {
    await journal.listNotebooks();
    await journal.saveReflection(key(16), draft(), null);
    await journal.listReflections();
    expect(calls).toEqual([]);
  });
});

describe("signed-in journal before the account tables exist", () => {
  it("is a preview only: nothing is read, sent or kept on the device", async () => {
    expect(journal.persists(USER)).toBe(false);
    expect(await journal.listNotebooks(USER)).toEqual([]);
    expect(await journal.getReflection(key(16), USER)).toBeNull();
    await expect(journal.saveReflection(key(16), draft(), null, USER)).rejects.toThrow(
      "isn’t enabled",
    );
    expect(calls).toEqual([]);
    expect(storage.getItem(GUEST_JOURNAL_KEY)).toBeNull();
  });
});

describe("signed-in journal once enabled", () => {
  beforeEach(() => {
    flags.accounts = true;
  });
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "r-1",
    notebook_id: "nb-general",
    translation: "KJAV",
    book_id: "john",
    chapter: 3,
    verse: 16,
    title: "Love",
    body: "Saved",
    tags: ["#Faith"],
    posture: null,
    is_private: true,
    created_at: "2026-01-01T00:00:00.123456+00:00",
    updated_at: "2026-01-02T00:00:00.654321+00:00",
    ...overrides,
  });

  it("creates General Reflections the first time, once even if another device did it first", async () => {
    results.push(
      { data: [], error: null }, // no notebooks yet
      { data: null, error: { code: "23505", message: "duplicate" } }, // another device won
      {
        data: [
          {
            id: "nb-general",
            name: DEFAULT_NOTEBOOK_NAME,
            is_default: true,
            created_at: "a",
            updated_at: "a",
          },
        ],
        error: null,
      },
    );
    const notebooks = await journal.listNotebooks(USER);
    expect(notebooks.map((item) => item.id)).toEqual(["nb-general"]);
    const insert = calls[1]?.steps[0] as [string, [Record<string, unknown>]];
    expect(insert[0]).toBe("insert");
    expect(insert[1][0]).toMatchObject({
      user_id: USER,
      name: DEFAULT_NOTEBOOK_NAME,
      is_default: true,
    });
  });

  it("saves a new reflection as an insert for this user, keeping the stored time exactly", async () => {
    results.push({ data: row(), error: null });
    const result = await journal.saveReflection(
      key(16),
      draft({ notebookId: "nb-general" }),
      null,
      USER,
    );
    expect(result).toMatchObject({
      status: "saved",
      reflection: { id: "r-1", updatedAt: "2026-01-02T00:00:00.654321+00:00" },
    });
    const [method, [payload]] = calls[0]!.steps[0] as [string, [Record<string, unknown>]];
    expect(method).toBe("insert");
    expect(payload).toMatchObject({
      user_id: USER,
      notebook_id: "nb-general",
      translation: "KJAV",
      book_id: "john",
      chapter: 3,
      verse: 16,
      tags: ["#Faith"],
    });
  });

  it("edits only if the stored version is the one that was opened", async () => {
    results.push({ data: [row({ body: "Edited" })], error: null });
    const base = { id: "r-1", updatedAt: "2026-01-02T00:00:00.654321+00:00" };
    const result = await journal.saveReflection(key(16), draft({ body: "Edited" }), base, USER);
    expect(result.status).toBe("saved");
    expect(calls[0]?.steps.slice(1, 3)).toEqual([
      ["eq", ["id", "r-1"]],
      ["eq", ["updated_at", "2026-01-02T00:00:00.654321+00:00"]],
    ]);
    const [, [columns]] = calls[0]!.steps[0] as [string, [Record<string, unknown>]];
    expect(Object.keys(columns).sort()).toEqual(
      ["body", "is_private", "notebook_id", "posture", "tags", "title", "updated_at"].sort(),
    );
  });

  it("returns the newer copy as a conflict when the note changed elsewhere", async () => {
    results.push(
      { data: [], error: null }, // the edit matched nothing
      { data: row({ body: "From the other device" }), error: null },
    );
    const result = await journal.saveReflection(
      key(16),
      draft(),
      { id: "r-1", updatedAt: "old" },
      USER,
    );
    expect(result).toMatchObject({
      status: "conflict",
      current: { body: "From the other device" },
    });
  });

  it("returns a conflict when a first save meets a note created on another device", async () => {
    results.push(
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: row(), error: null },
    );
    expect(await journal.saveReflection(key(16), draft(), null, USER)).toMatchObject({
      status: "conflict",
      current: { id: "r-1" },
    });
  });

  it("explains duplicate notebook names and the protected default notebook", async () => {
    results.push({ data: null, error: { code: "23505", message: "duplicate" } });
    await expect(journal.createNotebook("Prayer", USER)).rejects.toMatchObject({
      code: "name-taken",
    });
    results.push({
      data: null,
      error: { code: "P0001", message: "The default notebook can't be deleted" },
    });
    await expect(journal.deleteNotebook("nb-general", USER)).rejects.toMatchObject({
      code: "default-notebook",
    });
  });

  it("deletes only this user's rows", async () => {
    await journal.deleteReflection("r-1", USER);
    expect(calls[0]?.steps).toEqual([
      ["delete", []],
      ["eq", ["id", "r-1"]],
      ["eq", ["user_id", USER]],
    ]);
  });

  it("skips a write if that person signed out or another account signed in", async () => {
    session.userId = "user-2";
    await expect(journal.saveReflection(key(16), draft(), null, USER)).rejects.toThrow(
      "account changed",
    );
    await expect(journal.deleteReflection("r-1", USER)).rejects.toThrow("account changed");
    session.userId = null;
    await expect(journal.createNotebook("Prayer", USER)).rejects.toThrow("account changed");
    expect(calls).toEqual([]);
  });

  it("never stores account content on the device", async () => {
    results.push({ data: row(), error: null });
    await journal.saveReflection(key(16), draft({ notebookId: "nb-general" }), null, USER);
    expect(storage.getItem(GUEST_JOURNAL_KEY)).toBeNull();
  });
});
