import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SearchResultsList } from "@/components/search-results";
import {
  classifyFreeSearchError,
  FREE_SEARCH_LIMIT,
  FREE_SEARCH_PAGE_SIZE,
  FreeSearchError,
  formatEditionList,
  freeSearchKey,
  freeSearchInfiniteOptions,
  getFreeSearchProvider,
  pageOfResults,
  preparingProvider,
  resultKey,
  resultRouteParams,
  searchedSummary,
  unindexedEditions,
  unindexedNotice,
  type FreeSearchHit,
} from "./free-search";
import { createMockFreeSearchProvider, type MockVerse } from "./free-search-mock";
import { decideSubmit } from "./search-interaction";
import { routeQuery } from "./search-router";
import { deriveSearchView, type SearchViewInput } from "./search-view";

// Short fixture quotations only (public-domain wording). No complete translation is stored here.
const v = (
  translation: string,
  bookId: string,
  bookName: string,
  chapter: number,
  verse: number,
  text: string,
  order: number,
): MockVerse => ({
  translation,
  bookId,
  bookName,
  chapter,
  verse,
  reference: `${bookName} ${chapter}:${verse}`,
  text,
  order,
});

const VERSES: MockVerse[] = [
  v(
    "KJAV",
    "john",
    "John",
    3,
    16,
    "For God so loved the world, that he gave his only begotten Son",
    4300,
  ),
  v(
    "WEB",
    "john",
    "John",
    3,
    16,
    "For God so loved the world, that he gave his only born Son",
    4300,
  ),
  v("KJAV", "psalms", "Psalms", 23, 1, "The LORD is my shepherd; I shall not want.", 1900),
  v("WEB", "psalms", "Psalms", 23, 1, "Yahweh is my shepherd; I shall lack nothing.", 1900),
  v(
    "KJAV",
    "romans",
    "Romans",
    12,
    2,
    "And be not conformed to this world: but be ye transformed by the renewing of your mind",
    4600,
  ),
  v(
    "BSB",
    "romans",
    "Romans",
    12,
    2,
    "Do not conform to the pattern of this world, but be transformed by the renewing of your mind",
    4600,
  ),
  v(
    "KJAV",
    "philippians",
    "Philippians",
    4,
    6,
    "Be careful for nothing; but in every thing by prayer and supplication",
    5000,
  ),
  v(
    "KJAV",
    "philippians",
    "Philippians",
    4,
    7,
    "And the peace of God, which passeth all understanding, shall keep your hearts",
    5001,
  ),
];

const provider = (over: Partial<Parameters<typeof createMockFreeSearchProvider>[0]> = {}) =>
  createMockFreeSearchProvider({
    verses: VERSES,
    indexedEditions: ["KJAV", "WEB"],
    ...over,
  });

const search = (query: string, editions?: string[]) =>
  provider().search({ query, limit: 10, editions });

describe("reference queries never reach free search", () => {
  it.each(["john 3:16", "Psalm 23", "ruth", "1 corinthians 13:4"])("%s opens a reference", (q) => {
    expect(routeQuery(q).route).toBe("reference");
    expect(decideSubmit(q).kind).toBe("open_reference");
  });

  it("a reference to a book that does not exist is searched as words, not opened", () => {
    expect(routeQuery("Hezekiah 3:16").route).not.toBe("reference");
  });

  it("nonsense and vague text stop before any provider is asked", () => {
    expect(decideSubmit("asdf qwerty zxcv").kind).toBe("stop");
    // One meaningful word is a keyword search (free search); only text with nothing to search stops.
    expect(decideSubmit("love").kind).toBe("free_search");
    expect(decideSubmit("the").kind).toBe("stop");
    expect(decideSubmit("   ").kind).toBe("ignore");
  });
});

describe("keyword and phrase matching (the contract the real index must meet)", () => {
  it("finds a phrase, and a phrase match outranks a looser keyword match", async () => {
    const out = await search("shepherd; I shall");
    expect(out.results[0]?.reference).toBe("Psalms 23:1");
  });

  it("finds verses by keywords in any order", async () => {
    const out = await search("renewing mind transformed");
    expect(out.results.map((r) => r.reference)).toContain("Romans 12:2");
  });

  it("ranks all-words matches above partial matches", async () => {
    const out = await search("peace understanding hearts");
    expect(out.results[0]?.reference).toBe("Philippians 4:7");
  });

  it("is case and punctuation insensitive", async () => {
    const a = await search("FOR GOD SO LOVED THE WORLD");
    const b = await search("for god so loved the world!");
    expect(a.results.map(resultKey)).toEqual(b.results.map(resultKey));
    expect(a.results.length).toBeGreaterThan(0);
  });

  it("returns nothing, not an error, when no verse matches", async () => {
    const out = await search("zeppelin submarine tuesday");
    expect(out).toMatchObject({ status: "ready", results: [], total: 0 });
  });
});

describe("translation isolation and identification", () => {
  it("every result names the edition it was found in", async () => {
    const out = await search("shepherd");
    expect(out.results.every((r) => r.translation.length > 0)).toBe(true);
    expect(new Set(out.results.map((r) => r.translation))).toEqual(new Set(["KJAV", "WEB"]));
  });

  it("matches only in the requested edition: KJV wording is not found in WEB", async () => {
    const web = await search("only begotten Son", ["WEB"]);
    expect(web.results.every((r) => r.translation === "WEB")).toBe(true);
    const kjav = await search("only begotten Son", ["KJAV"]);
    expect(kjav.results[0]).toMatchObject({ translation: "KJAV", reference: "John 3:16" });
    expect(kjav.results.some((r) => r.translation === "WEB" && /begotten/.test(r.text))).toBe(
      false,
    );
  });

  it("searches all indexed editions by default, and the same verse in two editions is two hits", async () => {
    const out = await search("loved the world");
    expect(out.searchedEditions).toEqual(["KJAV", "WEB"]);
    expect(out.results.slice(0, 2).map(resultKey)).toEqual(["KJAV-john-3-16", "WEB-john-3-16"]);
  });

  it("never searches an edition that is not indexed, even if asked", async () => {
    const out = await search("renewing of your mind", ["BSB", "KJAV"]);
    expect(out.searchedEditions).toEqual(["KJAV"]);
    expect(out.results.some((r) => r.translation === "BSB")).toBe(false);
  });
});

describe("unindexed editions are not 'no results'", () => {
  it("lists the catalogue editions that were not searched", () => {
    expect(unindexedEditions(["KJAV", "WEB"])).toEqual(["BSB", "ASV", "BBE", "FBV"]);
    expect(unindexedEditions([])).toHaveLength(6);
  });

  it("formats the list in plain English", () => {
    expect(formatEditionList(["BBE"])).toBe("BBE");
    expect(formatEditionList(["BBE", "FBV"])).toBe("BBE and FBV");
    expect(formatEditionList(["BSB", "BBE", "FBV"])).toBe("BSB, BBE and FBV");
  });

  it("says full-text search is not available for them", () => {
    const notice = unindexedNotice({ status: "ready", searchedEditions: ["KJAV", "WEB"] });
    expect(notice).toBe("Full-text search isn't available yet for BSB, ASV, BBE and FBV.");
    expect(
      unindexedNotice({ status: "ready", searchedEditions: ["KJAV", "WEB", "BSB", "ASV", "BBE"] }),
    ).toBe("Full-text search isn't available yet for FBV.");
  });

  it("has no notice when everything was searched, or while the index is being prepared", () => {
    const all = ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV"];
    expect(unindexedNotice({ status: "ready", searchedEditions: all })).toBeNull();
    expect(unindexedNotice({ status: "preparing", searchedEditions: [] })).toBeNull();
  });

  it("names what was searched, or nothing when nothing was", () => {
    expect(searchedSummary(["KJAV", "WEB"])).toBe("KJAV and WEB");
    expect(searchedSummary([])).toBeNull();
  });
});

describe("result navigation", () => {
  it("opens the verse in the edition where the match was found", async () => {
    const out = await search("lack nothing", ["WEB"]);
    const hit = out.results[0] as FreeSearchHit;
    expect(resultRouteParams(hit)).toEqual({
      translation: "WEB",
      book: "psalms",
      chapter: "23",
      verse: "1",
    });
  });

  it("every fixture result resolves to a real book id and numeric chapter and verse", async () => {
    const { BIBLE_BOOKS } = await import("./books");
    const out = await search("the", ["KJAV", "WEB"]);
    for (const hit of VERSES) {
      const p = resultRouteParams(hit);
      expect(BIBLE_BOOKS.some((b) => b.id === p.book)).toBe(true);
      expect(Number(p.chapter)).toBeGreaterThan(0);
      expect(Number(p.verse)).toBeGreaterThan(0);
    }
    expect(out.status).toBe("ready");
  });

  it("renders links to the right /verse path for each edition", async () => {
    const out = await search("loved the world");
    const root = createRootRoute();
    const list = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () =>
        createElement(SearchResultsList, { items: out.results, shown: 10, onShowMore: () => {} }),
    });
    const verse = createRoute({
      getParentRoute: () => root,
      path: "/verse/$translation/$book/$chapter/$verse",
      component: () => null,
    });
    const router = createRouter({
      routeTree: root.addChildren([list, verse]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
    expect(markup).toContain('href="/verse/KJAV/john/3/16"');
    expect(markup).toContain('href="/verse/WEB/john/3/16"');
    expect(markup).toMatch(/John 3:16[\s\S]*KJAV/);
  });
});

describe("failures", () => {
  it("classifies provider errors without keeping their text", () => {
    expect(classifyFreeSearchError(new FreeSearchError("limit"))).toBe("limit");
    expect(classifyFreeSearchError(new FreeSearchError("network"))).toBe("network");
    expect(classifyFreeSearchError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyFreeSearchError(new Error("boom: secret"))).toBe("failed");
  });

  it("a failing provider throws a kind only", async () => {
    await expect(
      provider({ failWith: "network" }).search({ query: "anything here", limit: 5 }),
    ).rejects.toMatchObject({ kind: "network", message: "network" });
  });

  it("an aborted search rejects instead of answering", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider().search({ query: "shepherd", limit: 5, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("query options (caching and privacy)", () => {
  it("one key for the same search however it is typed", () => {
    expect(freeSearchKey("  For God  so LOVED ")).toBe("for god so loved");
    const a = freeSearchInfiniteOptions({
      provider: preparingProvider,
      query: "Hope  now",
      enabled: true,
    });
    const b = freeSearchInfiniteOptions({
      provider: preparingProvider,
      query: "hope now",
      enabled: true,
    });
    expect(a.queryKey).toEqual(b.queryKey);
  });

  it("is disabled for an empty query or before preferences load, and never retries on its own", () => {
    const off = freeSearchInfiniteOptions({
      provider: preparingProvider,
      query: "",
      enabled: true,
    });
    const wait = freeSearchInfiniteOptions({
      provider: preparingProvider,
      query: "x y",
      enabled: false,
    });
    expect(off.enabled).toBe(false);
    expect(wait.enabled).toBe(false);
    expect(off).toMatchObject({
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });

  it("passes the abort signal and the result limit to the provider", async () => {
    const spy = vi.fn(preparingProvider.search);
    const options = freeSearchInfiniteOptions({
      provider: { search: spy },
      query: "some words",
      enabled: true,
    });
    const controller = new AbortController();
    await options.queryFn({ pageParam: 0, signal: controller.signal });
    expect(spy).toHaveBeenCalledWith({
      query: "some words",
      limit: FREE_SEARCH_LIMIT,
      offset: 0,
      signal: controller.signal,
    });
  });

  it("uses the 'being prepared' provider by default, and AI is never involved", async () => {
    expect(getFreeSearchProvider()).toBe(preparingProvider);
    const out = await getFreeSearchProvider().search({ query: "for god so loved", limit: 5 });
    expect(out).toMatchObject({
      status: "preparing",
      results: [],
      searchedEditions: [],
      hasMore: false,
    });
  });
});

describe("search screen states for free search", () => {
  const base: SearchViewInput = {
    hasSubmitted: true,
    canTryAi: true,
    stopMessage: null,
    ready: true,
    canRun: false,
    isPending: false,
    isError: false,
    freeStatus: "ready",
  };
  const kind = (patch: Partial<SearchViewInput>) => deriveSearchView({ ...base, ...patch }).kind;
  const free = (patch: Partial<NonNullable<SearchViewInput["free"]>>) => ({
    isPending: false,
    isError: false,
    resultCount: 0,
    ...patch,
  });

  it("loading, results, no results, error", () => {
    expect(kind({ free: free({ isPending: true }) })).toBe("free_loading");
    expect(kind({ free: free({ resultCount: 3 }) })).toBe("free_results");
    expect(kind({ free: free({}) })).toBe("free_no_results");
    expect(
      deriveSearchView({ ...base, free: free({ isError: true, errorKind: "limit" }) }),
    ).toEqual({
      kind: "free_error",
      reason: "limit",
    });
  });

  it("an unknown error is a plain failure", () => {
    expect(deriveSearchView({ ...base, free: free({ isError: true }) })).toEqual({
      kind: "free_error",
      reason: "failed",
    });
  });

  it("'preparing' stays the approved unindexed state, with no results claimed", () => {
    expect(kind({ freeStatus: "preparing", free: free({}) })).toBe("unindexed");
  });

  it("results are never hidden by a later error", () => {
    expect(kind({ free: free({ resultCount: 2, isError: true }) })).toBe("free_results");
  });

  it("Smart Search states appear only after an explicit request", () => {
    expect(kind({ free: free({}), canRun: false })).toBe("free_no_results");
    expect(kind({ free: free({}), canRun: true, isPending: true })).toBe("loading");
  });
});

describe("large result sets stay light", () => {
  const synthetic = (n: number): FreeSearchHit[] =>
    Array.from({ length: n }, (_, i) => ({
      translation: i % 2 ? "WEB" : "KJAV",
      bookId: "psalms",
      bookName: "Psalms",
      chapter: (i % 150) + 1,
      verse: (i % 30) + 1,
      reference: `Psalms ${(i % 150) + 1}:${(i % 30) + 1}`,
      text: `Synthetic verse ${i} `.repeat(8),
    }));

  it("only the visible page is sliced, whatever the size of the set", () => {
    const items = synthetic(10_000);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) pageOfResults(items, FREE_SEARCH_PAGE_SIZE);
    const ms = performance.now() - t0;
    console.info(`pageOfResults x1000 over 10,000 hits: ${ms.toFixed(1)} ms`);
    expect(pageOfResults(items, FREE_SEARCH_PAGE_SIZE)).toHaveLength(FREE_SEARCH_PAGE_SIZE);
    expect(pageOfResults(items, -5)).toEqual([]);
    expect(ms).toBeLessThan(250);
  });

  it("renders only one page of rows for 10,000 results", async () => {
    const items = synthetic(10_000);
    const root = createRootRoute();
    const list = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () =>
        createElement(SearchResultsList, {
          items,
          shown: FREE_SEARCH_PAGE_SIZE,
          onShowMore: () => {},
        }),
    });
    const verse = createRoute({
      getParentRoute: () => root,
      path: "/verse/$translation/$book/$chapter/$verse",
      component: () => null,
    });
    const router = createRouter({
      routeTree: root.addChildren([list, verse]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const t0 = performance.now();
    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
    const ms = performance.now() - t0;
    console.info(
      `render of 10,000-hit list (one page shown): ${ms.toFixed(1)} ms, ${markup.length} bytes`,
    );
    expect(markup.match(/<li[ >]/g)).toHaveLength(FREE_SEARCH_PAGE_SIZE);
    expect(markup).toContain("Show more verses");
    expect(markup.length).toBeLessThan(20_000);
  });

  it("shows no 'Show more' button when everything is already visible", async () => {
    const items = synthetic(4);
    const root = createRootRoute();
    const list = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () => createElement(SearchResultsList, { items, shown: 10, onShowMore: () => {} }),
    });
    const verse = createRoute({
      getParentRoute: () => root,
      path: "/verse/$translation/$book/$chapter/$verse",
      component: () => null,
    });
    const router = createRouter({
      routeTree: root.addChildren([list, verse]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    expect(renderToStaticMarkup(createElement(RouterProvider, { router }))).not.toContain(
      "Show more verses",
    );
  });

  it("the provider contract clamps to 25 results over a Bible-sized corpus and stays fast", async () => {
    // ~62,000 verses (two editions' worth) of synthetic text containing a common word.
    const verses: MockVerse[] = Array.from({ length: 62_000 }, (_, i) => ({
      translation: i % 2 ? "WEB" : "KJAV",
      bookId: "psalms",
      bookName: "Psalms",
      chapter: (i % 150) + 1,
      verse: (i % 30) + 1,
      reference: `Psalms ${(i % 150) + 1}:${(i % 30) + 1}`,
      text: `the lord is my shepherd number ${i} and I shall not want`,
      order: i,
    }));
    const big = createMockFreeSearchProvider({ verses, indexedEditions: ["KJAV", "WEB"] });
    const t0 = performance.now();
    const out = await big.search({ query: "lord shepherd", limit: 1000 });
    const ms = performance.now() - t0;
    console.info(`mock search over 62,000 verses: ${ms.toFixed(0)} ms, total ${out.total}`);
    expect(out.total).toBe(62_000);
    expect(out.results).toHaveLength(25);
    expect(ms).toBeLessThan(2000);
  });
});
