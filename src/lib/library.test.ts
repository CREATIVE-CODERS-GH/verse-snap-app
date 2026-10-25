import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "@/test/memory-storage";

const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

const { GUEST_HISTORY_KEY, chapterKey, guestStore, library } = await import("./library");

const john3 = { translation: "BSB", bookId: "JHN", bookName: "John", chapter: 3 };

const verse = {
  translation: "BSB",
  bookId: "JHN",
  bookName: "John",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world…",
  reference: "John 3:16",
};

describe("guest chapter history", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("records a chapter visit without inventing a verse position", async () => {
    expect(await library.recordChapterVisit(john3)).toBe(true);
    const [entry] = await library.listHistory();
    expect(entry).toMatchObject({
      id: chapterKey(john3),
      kind: "chapter",
      translation: "BSB",
      bookId: "JHN",
      chapter: 3,
      verse: null,
    });
  });

  it("keeps one entry per chapter and translation, moved to the top when read again", async () => {
    await library.recordChapterVisit(john3);
    await library.recordView(verse);
    await library.recordChapterVisit(john3);
    await library.recordChapterVisit({ ...john3, translation: "KJV" });

    const history = await library.listHistory();
    expect(history.map((entry) => entry.id)).toEqual([
      chapterKey({ ...john3, translation: "KJV" }),
      chapterKey(john3),
      "BSB/JHN/3/16",
    ]);
  });

  it("keeps chapter and verse entries apart for the same chapter", async () => {
    await library.recordView(verse);
    await library.recordChapterVisit(john3);
    const kinds = (await library.listHistory()).map((entry) => entry.kind);
    expect(kinds).toEqual(["chapter", "verse"]);
  });

  it("signed in, records the chapter in the account, not on the device", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    from.mockReturnValue({ upsert });
    expect(await library.recordChapterVisit(john3, "user-1")).toBe(true);
    expect(from).toHaveBeenCalledWith("history");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", kind: "chapter", verse: null }),
      { onConflict: "user_id,translation,book_id,chapter,verse" },
    );
    expect(guestStore.history()).toEqual([]);
  });

  it("reads history stored before chapter visits existed as verse entries", () => {
    window.localStorage.setItem(
      GUEST_HISTORY_KEY,
      JSON.stringify([
        {
          id: "BSB/JHN/3/16",
          translation: "BSB",
          bookId: "JHN",
          bookName: "John",
          chapter: 3,
          verse: 16,
          verseText: "…",
          at: "2026-01-01T00:00:00.000Z",
        },
        { broken: true },
      ]),
    );
    expect(guestStore.history()).toEqual([
      expect.objectContaining({ id: "BSB/JHN/3/16", kind: "verse", verse: 16 }),
    ]);
  });

  it("removes only the given ids and keeps entries written meanwhile", async () => {
    await library.recordView(verse);
    const snapshot = guestStore.history().map((entry) => entry.id);
    await library.recordChapterVisit(john3);
    guestStore.removeHistory(snapshot);
    expect(guestStore.history().map((entry) => entry.id)).toEqual([chapterKey(john3)]);
  });
});
