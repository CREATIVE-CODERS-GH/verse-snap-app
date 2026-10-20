import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SAVED_SEARCHES,
  SEARCH_CACHE_TTL_MS,
  allowPaidSearch,
  isPaidSearchAllowed,
  normalizeQuery,
  readSavedSearch,
  resetPaidSearchIntent,
  saveSearch,
  searchKey,
  type StorageLike,
} from "./search-session";
import type { ScriptureSearchResponse, ScriptureSearchResult } from "./types";

class FakeStorage implements StorageLike {
  private data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.failReads) throw new Error("blocked");
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  raw() {
    return [...this.data.entries()];
  }
}

const result: ScriptureSearchResult = {
  translation: "KJAV",
  bookId: "1corinthians",
  bookName: "1 Corinthians",
  chapter: 13,
  verse: 4,
  reference: "1 Corinthians 13:4",
  text: "Charity suffereth long.",
};
const success: ScriptureSearchResponse = { results: [result], failed: false };
const NOW = 1_800_000_000_000;

beforeEach(() => resetPaidSearchIntent());

describe("keys", () => {
  it("normalizes case and spacing, and separates translations", () => {
    expect(normalizeQuery("  Love   IS patient ")).toBe("love is patient");
    expect(searchKey("Love is patient", "KJAV")).toBe(searchKey("  love  is   PATIENT", "KJAV"));
    expect(searchKey("love is patient", "KJAV")).not.toBe(searchKey("love is patient", "BSB"));
  });
});

describe("saving and restoring", () => {
  it("restores a saved successful result for the same normalized query and translation", () => {
    const storage = new FakeStorage();
    expect(saveSearch(storage, "Love is patient", "KJAV", success, NOW)).toBe(true);
    const restored = readSavedSearch(storage, "  love IS patient ", "KJAV", NOW + 1000);
    expect(restored?.response).toEqual(success);
    expect(restored?.savedAt).toBe(NOW);
  });

  it("does not restore for another translation or another query", () => {
    const storage = new FakeStorage();
    saveSearch(storage, "love is patient", "KJAV", success, NOW);
    expect(readSavedSearch(storage, "love is patient", "BSB", NOW)).toBeNull();
    expect(readSavedSearch(storage, "love is kind", "KJAV", NOW)).toBeNull();
  });

  it("can save a successful search that found nothing", () => {
    const storage = new FakeStorage();
    expect(
      saveSearch(storage, "purple elephants", "KJAV", { results: [], failed: false }, NOW),
    ).toBe(true);
    expect(readSavedSearch(storage, "purple elephants", "KJAV", NOW)?.response.results).toEqual([]);
  });

  it("expires after one hour and removes the entry", () => {
    const storage = new FakeStorage();
    saveSearch(storage, "love is patient", "KJAV", success, NOW);
    expect(
      readSavedSearch(storage, "love is patient", "KJAV", NOW + SEARCH_CACHE_TTL_MS),
    ).not.toBeNull();
    expect(
      readSavedSearch(storage, "love is patient", "KJAV", NOW + SEARCH_CACHE_TTL_MS + 1),
    ).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("rejects an entry saved in the future", () => {
    const storage = new FakeStorage();
    saveSearch(storage, "love is patient", "KJAV", success, NOW + 10 * 60 * 1000);
    expect(readSavedSearch(storage, "love is patient", "KJAV", NOW)).toBeNull();
  });
});

describe("what is never saved", () => {
  it("never saves a failed response", () => {
    const storage = new FakeStorage();
    const failed: ScriptureSearchResponse = { results: [], failed: true, errorMessage: "nope" };
    expect(saveSearch(storage, "love is patient", "KJAV", failed, NOW)).toBe(false);
    expect(saveSearch(storage, "love is patient", "KJAV", { ...success, failed: true }, NOW)).toBe(
      false,
    );
    expect(storage.length).toBe(0);
  });

  it("never saves malformed or oversized results", () => {
    const storage = new FakeStorage();
    const bad = [
      { ...result, chapter: 0 },
      { ...result, verse: 1.5 },
      { ...result, text: "" },
      { ...result, text: "x".repeat(4001) },
      { ...result, reference: undefined },
      { ...result, bookId: 7 },
    ];
    for (const item of bad) {
      const response = { results: [item], failed: false } as unknown as ScriptureSearchResponse;
      expect(saveSearch(storage, "q query", "KJAV", response, NOW)).toBe(false);
    }
    const tooMany = { results: Array.from({ length: 9 }, () => result), failed: false };
    expect(saveSearch(storage, "q query", "KJAV", tooMany, NOW)).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("stores only the results and timing: no error text, tokens, ids or extra fields", () => {
    const storage = new FakeStorage();
    const noisy = {
      results: [{ ...result, accessToken: "secret-token", userId: "u-1" }],
      failed: false,
      errorMessage: "leaked",
      token: "sb-secret",
    } as unknown as ScriptureSearchResponse;
    saveSearch(storage, "love is patient", "KJAV", noisy, NOW);
    const [name, value] = storage.raw()[0]!;
    expect(name.startsWith("versesnap.aisearch.v1:")).toBe(true);
    const text = String(value);
    for (const forbidden of [
      "secret-token",
      "u-1",
      "leaked",
      "sb-secret",
      "errorMessage",
      "token",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      "results",
      "savedAt",
      "translation",
      "v",
    ]);
  });
});

describe("validation of what is read back", () => {
  const nameFor = (storage: FakeStorage) => storage.raw()[0]![0];

  function tampered(mutate: (entry: Record<string, unknown>) => void) {
    const storage = new FakeStorage();
    saveSearch(storage, "love is patient", "KJAV", success, NOW);
    const name = nameFor(storage);
    const entry = JSON.parse(storage.getItem(name)!) as Record<string, unknown>;
    mutate(entry);
    storage.setItem(name, JSON.stringify(entry));
    return storage;
  }

  it("discards entries that were edited into something invalid, and removes them", () => {
    const edits: Array<(entry: Record<string, unknown>) => void> = [
      (e) => (e["v"] = 2),
      (e) => (e["translation"] = "BSB"),
      (e) => (e["savedAt"] = "yesterday"),
      (e) => (e["results"] = "not a list"),
      (e) => (e["results"] = [{ ...result, chapter: -1 }]),
      (e) => (e["results"] = [{ text: "no other fields" }]),
      (e) => (e["results"] = Array.from({ length: 9 }, () => result)),
    ];
    for (const edit of edits) {
      const storage = tampered(edit);
      expect(readSavedSearch(storage, "love is patient", "KJAV", NOW)).toBeNull();
      expect(storage.length).toBe(0);
    }
  });

  it("discards unreadable JSON", () => {
    const storage = new FakeStorage();
    saveSearch(storage, "love is patient", "KJAV", success, NOW);
    storage.setItem(nameFor(storage), "{not json");
    expect(readSavedSearch(storage, "love is patient", "KJAV", NOW)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("returns null when the stored text is the string 'null' or an array", () => {
    for (const value of ["null", "[]", "42", '"text"']) {
      const storage = new FakeStorage();
      storage.setItem(`versesnap.aisearch.v1:${searchKey("love is patient", "KJAV")}`, value);
      expect(readSavedSearch(storage, "love is patient", "KJAV", NOW)).toBeNull();
    }
  });
});

describe("storage trouble never breaks a search", () => {
  it("works without any storage", () => {
    expect(saveSearch(undefined, "love is patient", "KJAV", success, NOW)).toBe(false);
    expect(readSavedSearch(undefined, "love is patient", "KJAV", NOW)).toBeNull();
  });

  it("survives a full or blocked storage", () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    expect(saveSearch(storage, "love is patient", "KJAV", success, NOW)).toBe(false);
    storage.failWrites = false;
    saveSearch(storage, "love is patient", "KJAV", success, NOW);
    storage.failReads = true;
    expect(readSavedSearch(storage, "love is patient", "KJAV", NOW)).toBeNull();
  });

  it("keeps at most 20 entries, newest first, and drops expired ones", () => {
    const storage = new FakeStorage();
    saveSearch(storage, "very old search", "KJAV", success, NOW - 2 * SEARCH_CACHE_TTL_MS);
    for (let i = 0; i < MAX_SAVED_SEARCHES + 5; i += 1) {
      saveSearch(storage, `search number ${i}`, "KJAV", success, NOW + i);
    }
    expect(storage.length).toBe(MAX_SAVED_SEARCHES);
    expect(readSavedSearch(storage, "very old search", "KJAV", NOW + 100)).toBeNull();
    expect(readSavedSearch(storage, "search number 24", "KJAV", NOW + 100)).not.toBeNull();
    expect(readSavedSearch(storage, "search number 0", "KJAV", NOW + 100)).toBeNull();
  });

  it("leaves other applications' storage entries alone", () => {
    const storage = new FakeStorage();
    storage.setItem("something.else", "keep me");
    saveSearch(storage, "love is patient", "KJAV", success, NOW);
    expect(storage.getItem("something.else")).toBe("keep me");
  });
});

describe("paid-search intent", () => {
  it("is remembered for the exact query and translation in this page session only", () => {
    expect(isPaidSearchAllowed("love is patient", "KJAV")).toBe(false);
    allowPaidSearch("  Love is   patient ", "KJAV");
    expect(isPaidSearchAllowed("love is patient", "KJAV")).toBe(true);
    expect(isPaidSearchAllowed("love is patient", "BSB")).toBe(false);
    expect(isPaidSearchAllowed("love is kind", "KJAV")).toBe(false);
    resetPaidSearchIntent(); // what a reload does: module memory is gone
    expect(isPaidSearchAllowed("love is patient", "KJAV")).toBe(false);
  });

  it("ignores an empty query", () => {
    allowPaidSearch("   ", "KJAV");
    expect(isPaidSearchAllowed("", "KJAV")).toBe(false);
  });
});
