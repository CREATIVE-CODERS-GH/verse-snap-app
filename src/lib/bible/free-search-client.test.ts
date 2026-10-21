import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  createServerFreeSearchProvider,
  FREE_SEARCH_LIMIT,
  FreeSearchError,
  classifyFreeSearchError,
  freeSearchInfiniteOptions,
  isAbort,
  resultSummary,
  unindexedNotice,
  type FreeSearchProvider,
  type FreeSearchResponse,
  type RunFreeSearch,
} from "./free-search";
import { createMockFreeSearchProvider, type MockVerse } from "./free-search-mock";
import { pagingFor, type FreeSearchServerResult } from "./free-search-protocol";

const verse = (i: number, translation = "WEB"): MockVerse => ({
  translation,
  bookId: "ephesians",
  bookName: "Ephesians",
  chapter: 1 + Math.floor(i / 30),
  verse: 1 + (i % 30),
  reference: `Ephesians ${1 + Math.floor(i / 30)}:${1 + (i % 30)}`,
  text: `grace abounds number ${i}`,
  order: i,
});
const graceVerses = Array.from({ length: 60 }, (_, i) => verse(i, i % 2 ? "WEB" : "BSB"));
const provider = (
  over: Parameters<typeof createMockFreeSearchProvider>[0] extends infer T
    ? Partial<T>
    : never = {},
) =>
  createMockFreeSearchProvider({ verses: graceVerses, indexedEditions: ["WEB", "BSB"], ...over });

const response = (over: Partial<FreeSearchResponse> = {}): FreeSearchResponse => ({
  status: "ready",
  results: [],
  total: 0,
  offset: 0,
  hasMore: false,
  limitReached: false,
  searchedEditions: ["WEB"],
  ...over,
});

describe("the server-backed provider", () => {
  it("sends a clean request (query, paging, optional editions) and the abort signal", async () => {
    const run = vi.fn<RunFreeSearch>(async () => ({ ok: true, response: response() }));
    const controller = new AbortController();
    await createServerFreeSearchProvider(run).search({
      query: "shepherd",
      limit: 25,
      offset: 50,
      editions: ["WEB"],
      signal: controller.signal,
    });
    expect(run).toHaveBeenCalledWith({
      data: { query: "shepherd", limit: 25, offset: 50, editions: ["WEB"] },
      signal: controller.signal,
    });
    await createServerFreeSearchProvider(run).search({ query: "grace", limit: 25 });
    expect(run.mock.calls[1]?.[0]).toEqual({ data: { query: "grace", limit: 25, offset: 0 } });
  });

  it("returns the server's page unchanged", async () => {
    const page = response({ total: 395, hasMore: true, correctedQuery: "shepherd" });
    const out = await createServerFreeSearchProvider(async () => ({
      ok: true,
      response: page,
    })).search({
      query: "sheperd",
      limit: 25,
    });
    expect(out).toBe(page);
  });

  it("turns failure results into typed errors, keeping the retry time", async () => {
    const fail = (result: FreeSearchServerResult) =>
      createServerFreeSearchProvider(async () => result)
        .search({ query: "x y", limit: 25 })
        .catch((e: unknown) => e);
    expect(await fail({ ok: false, error: "limit", retryAfterSeconds: 40 })).toMatchObject({
      kind: "limit",
      retryAfterSeconds: 40,
    });
    expect(await fail({ ok: false, error: "timeout" })).toMatchObject({ kind: "timeout" });
    expect(await fail({ ok: false, error: "unavailable" })).toMatchObject({ kind: "failed" });
    expect(await fail({ ok: false, error: "invalid" })).toMatchObject({ kind: "failed" });
  });

  it("lets network failures and aborts through for the screen to classify", async () => {
    const offline = createServerFreeSearchProvider(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await offline.search({ query: "x y", limit: 25 }).catch((e: unknown) => e);
    expect(classifyFreeSearchError(error)).toBe("network");
    const aborted = createServerFreeSearchProvider(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    expect(
      isAbort(await aborted.search({ query: "x y", limit: 25 }).catch((e: unknown) => e)),
    ).toBe(true);
    expect(classifyFreeSearchError(new FreeSearchError("timeout"))).toBe("timeout");
    expect(classifyFreeSearchError(new Error("x"))).toBe("failed");
  });
});

describe("server-backed pagination (pages of 25, fetched as needed)", () => {
  const observe = (p: FreeSearchProvider, query = "grace") => {
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: p, query, enabled: true }),
    );
    return { client, observer };
  };

  it("loads the first page only, with the exact total", async () => {
    const calls: unknown[] = [];
    const { observer } = observe(provider({ onSearch: (i) => calls.push([i.offset, i.limit]) }));
    const result = await observer.refetch();
    const pages = result.data?.pages ?? [];
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ total: 60, offset: 0, hasMore: true });
    expect(pages[0]?.results).toHaveLength(FREE_SEARCH_LIMIT);
    expect(calls).toEqual([[0, 25]]);
  });

  it("fetches the next pages from the server's offsets until nothing more is available", async () => {
    const offsets: number[] = [];
    const { observer } = observe(provider({ onSearch: (i) => offsets.push(i.offset ?? 0) }));
    await observer.refetch();
    let result = await observer.fetchNextPage();
    expect(result.hasNextPage).toBe(true);
    result = await observer.fetchNextPage();
    expect(result.hasNextPage).toBe(false);
    expect(offsets).toEqual([0, 25, 50]);
    const all = (result.data?.pages ?? []).flatMap((p) => p.results);
    expect(all).toHaveLength(60);
    expect(new Set(all.map((r) => `${r.translation}${r.reference}`)).size).toBe(60);
    expect((result.data?.pages ?? []).every((p) => p.total === 60)).toBe(true);
  });

  it("a search with no further results has no next page", async () => {
    const { observer } = observe(provider({ verses: graceVerses.slice(0, 5) }));
    await observer.refetch();
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
  });

  it("stops at the retrieval limit: the page that ends at 1,025 has no next page and says why", () => {
    expect(pagingFor(11900, 1000, 25)).toEqual({ hasMore: false, limitReached: true });
    expect(pagingFor(11900, 975, 25)).toEqual({ hasMore: true, limitReached: false });
    expect(pagingFor(1025, 1000, 25)).toEqual({ hasMore: false, limitReached: false });
    expect(pagingFor(60, 50, 10)).toEqual({ hasMore: false, limitReached: false });
    expect(pagingFor(0, 0, 0)).toEqual({ hasMore: false, limitReached: false });
  });

  it("a failed first page can be retried, and then succeeds (no automatic retry in between)", async () => {
    let calls = 0;
    const flaky: FreeSearchProvider = {
      async search(input) {
        calls += 1;
        if (calls === 1) throw new FreeSearchError("network");
        return provider().search(input);
      },
    };
    const { observer } = observe(flaky);
    const first = await observer.refetch();
    expect(first.isError).toBe(true);
    expect(calls).toBe(1);
    const second = await observer.refetch();
    expect(second.isError).toBe(false);
    expect(second.data?.pages[0]?.total).toBe(60);
    expect(calls).toBe(2);
  });

  it("a failed later page keeps the pages already loaded, and the retry continues from the same place", async () => {
    let calls = 0;
    const flaky: FreeSearchProvider = {
      async search(input) {
        calls += 1;
        if (calls === 2) throw new FreeSearchError("failed");
        return provider().search(input);
      },
    };
    const { observer } = observe(flaky);
    await observer.refetch();
    const failed = await observer.fetchNextPage();
    expect(failed.isFetchNextPageError).toBe(true);
    expect(failed.data?.pages).toHaveLength(1);
    const retried = await observer.fetchNextPage();
    expect(retried.isFetchNextPageError).toBe(false);
    expect(retried.data?.pages).toHaveLength(2);
    expect(retried.data?.pages[1]?.offset).toBe(25);
  });

  it("an abort reaches the provider and the aborted search shows no result and no error", async () => {
    let seen: AbortSignal | undefined;
    const slow = provider({ delayMs: 1000, onSearch: (i) => (seen = i.signal) });
    const { client, observer } = observe(slow);
    const pending = observer.refetch();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.cancelQueries();
    await pending.catch(() => undefined);
    expect(seen?.aborted).toBe(true);
    const state = observer.getCurrentResult();
    expect(state.data).toBeUndefined();
    expect(state.isError).toBe(false);
  });

  it("a newer search cancels the older one in flight", async () => {
    const signals: Record<string, AbortSignal | undefined> = {};
    const slow = provider({ delayMs: 500, onSearch: (i) => (signals[i.query] = i.signal) });
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: slow, query: "grace", enabled: true }),
    );
    const unsubscribe = observer.subscribe(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    observer.setOptions(
      freeSearchInfiniteOptions({ provider: slow, query: "abounds", enabled: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals["grace"]?.aborted).toBe(true);
    expect(signals["abounds"]?.aborted).toBe(false);
    unsubscribe();
    await client.cancelQueries();
  });

  it("a different spelling or spacing of the same search shares one cached result", async () => {
    let calls = 0;
    const counted = provider({ onSearch: () => (calls += 1) });
    const client = new QueryClient();
    const a = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: counted, query: "Grace  abounds", enabled: true }),
    );
    await a.refetch();
    const b = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: counted, query: "grace abounds", enabled: true }),
    );
    await b.refetch();
    expect(calls).toBe(2); // refetch always asks; the key is what matters:
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });
});

describe("searching the original wording instead of the corrected one", () => {
  const typos = { sheperd: "shepherd" };
  const verses: MockVerse[] = [
    { ...verse(1), text: "The LORD is my shepherd; I shall not want." },
    { ...verse(2), text: "Sheperd Hill was a place in the story." },
  ];
  const observe = (repair: boolean, query = "sheperd") => {
    const client = new QueryClient();
    const calls: (boolean | undefined)[] = [];
    const p = createMockFreeSearchProvider({
      verses,
      indexedEditions: ["WEB"],
      corrections: typos,
      onSearch: (i) => calls.push(i.repair),
    });
    const observer = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: p, query, enabled: true, repair }),
    );
    return { client, observer, calls };
  };

  it("corrected search: the corrected wording is searched and reported", async () => {
    const { observer, calls } = observe(true);
    const result = await observer.refetch();
    const page = result.data?.pages[0];
    expect(page?.correctedQuery).toBe("shepherd");
    expect(page?.results.map((r) => r.text)[0]).toMatch(/shepherd; I shall/);
    expect(calls).toEqual([undefined]);
  });

  it("original search: nothing is repaired, no corrected wording is reported, the typed word is searched", async () => {
    const { observer, calls } = observe(false);
    const result = await observer.refetch();
    const page = result.data?.pages[0];
    expect(page?.correctedQuery).toBeUndefined();
    expect(page?.results.map((r) => r.text)).toEqual(["Sheperd Hill was a place in the story."]);
    expect(calls).toEqual([false]);
  });

  it("the two choices are cached separately, so switching back is instant and never mixes results", async () => {
    const client = new QueryClient();
    const p = createMockFreeSearchProvider({
      verses,
      indexedEditions: ["WEB"],
      corrections: typos,
    });
    const a = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: p, query: "sheperd", enabled: true }),
    );
    const b = new InfiniteQueryObserver(
      client,
      freeSearchInfiniteOptions({ provider: p, query: "sheperd", enabled: true, repair: false }),
    );
    await a.refetch();
    await b.refetch();
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[2])
        .sort(),
    ).toEqual(["exact", "repaired"]);
  });

  it("the server provider sends repair: false only when asked", async () => {
    const run = vi.fn<RunFreeSearch>(async () => ({ ok: true, response: response() }));
    const server = createServerFreeSearchProvider(run);
    await server.search({ query: "sheperd", limit: 25 });
    await server.search({ query: "sheperd", limit: 25, repair: false });
    expect(run.mock.calls[0]?.[0].data).not.toHaveProperty("repair");
    expect(run.mock.calls[1]?.[0].data).toMatchObject({ repair: false });
  });

  it("errors built elsewhere (for example the browser test hook) still classify by name and kind", () => {
    expect(
      classifyFreeSearchError(
        Object.assign(new Error("x"), { name: "FreeSearchError", kind: "limit" }),
      ),
    ).toBe("limit");
    expect(
      classifyFreeSearchError(
        Object.assign(new Error("x"), { name: "FreeSearchError", kind: "nope" }),
      ),
    ).toBe("failed");
  });
});

describe("what the screen says", () => {
  it("'Showing N of total' while more remain, the plain count when everything is shown", () => {
    expect(resultSummary(10, 395, false)).toBe("Showing 10 of 395 verses");
    expect(resultSummary(395, 395, false)).toBe("395 verses");
    expect(resultSummary(1, 1, false)).toBe("1 verse");
    expect(resultSummary(10, 11900, false)).toBe("Showing 10 of 11,900 verses");
  });

  it("explains the retrieval limit and suggests narrowing the search", () => {
    expect(resultSummary(1025, 11900, true)).toBe(
      "Showing 1,025 of 11,900 verses. Refine your search to narrow the results.",
    );
  });

  it("never implies unindexed editions were searched", () => {
    expect(unindexedNotice(response({ searchedEditions: ["WEB", "BSB", "ASV"] }))).toBe(
      "Full-text search isn't available yet for KJAV, BBE and FBV.",
    );
    expect(unindexedNotice(response({ status: "preparing", searchedEditions: [] }))).toBeNull();
  });
});
