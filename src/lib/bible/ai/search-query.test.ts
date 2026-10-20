import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateUserQueries } from "../../auth-events";
import { DEFAULT_LIMITS } from "./config.server";
import {
  aiSearchQueryOptions,
  canRunAiSearch,
  fetchPaidSearch,
  resetInFlightSearches,
  type PaidSearchDeps,
  type RunSearch,
  type SearchDiagnostic,
} from "./search-query";
import {
  allowPaidSearch,
  isPaidSearchAllowed,
  readSavedSearch,
  resetPaidSearchIntent,
  saveSearch,
  type StorageLike,
} from "./search-session";
import { runAiSearch, type SearchServiceDeps } from "./search-service.server";
import type { ReferenceProvider, ScriptureSearchResponse } from "./types";

// These tests drive the same option builder the search page uses, with TanStack Query's real cache
// logic and mocked servers. No network, no OpenAI.

class FakeStorage implements StorageLike {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const GOOD: ScriptureSearchResponse = {
  failed: false,
  results: [
    {
      translation: "KJAV",
      bookId: "1corinthians",
      bookName: "1 Corinthians",
      chapter: 13,
      verse: 4,
      reference: "1 Corinthians 13:4",
      text: "Charity suffereth long.",
    },
  ],
};
const DENIED: ScriptureSearchResponse = {
  results: [],
  failed: true,
  errorMessage: "Scripture search is unavailable right now.",
};

const QUERY = "love is patient";

beforeEach(() => {
  resetPaidSearchIntent();
  resetInFlightSearches();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

const newClient = () =>
  new QueryClient({
    // the application's own defaults (src/router.tsx)
    defaultOptions: {
      queries: { staleTime: 600000, gcTime: 3600000, refetchOnWindowFocus: false, retry: 1 },
    },
  });

interface Page {
  client: QueryClient;
  storage: FakeStorage;
  run: ReturnType<typeof vi.fn<RunSearch>>;
  log: SearchDiagnostic[];
}

function page(over: Partial<Page> & { run?: RunSearch } = {}): Page {
  return {
    client: over.client ?? newClient(),
    storage: over.storage ?? new FakeStorage(),
    run: (over.run as Page["run"]) ?? vi.fn<RunSearch>(async () => GOOD),
    log: over.log ?? [],
  };
}

/** What search.tsx does on each render. */
function options(p: Page, description: string, translation: string, ready = true) {
  const saved = ready && description ? readSavedSearch(p.storage, description, translation) : null;
  const deps: PaidSearchDeps = {
    run: p.run,
    storage: p.storage,
    log: (entry) => p.log.push(entry),
  };
  return aiSearchQueryOptions({
    queryClient: p.client,
    deps,
    description,
    translation,
    ready,
    allowed: isPaidSearchAllowed(description, translation),
    saved,
  });
}

function mount(p: Page, description = QUERY, translation = "KJAV", ready = true) {
  const observer = new QueryObserver(p.client, options(p, description, translation, ready));
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe };
}

type Obs = ReturnType<typeof mount>["observer"];
const settle = async (observer: Obs) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe("idle"));
  return observer.getCurrentResult();
};

describe("normal explicit searches still work", () => {
  it("runs once for an explicit search, shows the result, and remembers it", async () => {
    const p = page();
    allowPaidSearch(QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p);
    const result = await settle(observer);
    expect(p.run).toHaveBeenCalledTimes(1);
    expect(p.run).toHaveBeenCalledWith(QUERY, "KJAV");
    expect(result.data).toEqual(GOOD);
    expect(readSavedSearch(p.storage, QUERY, "KJAV")?.response).toEqual(GOOD);
    unsubscribe();
  });

  it("a different search, or the same search in another translation, is a new explicit request", async () => {
    const p = page();
    allowPaidSearch(QUERY, "KJAV");
    allowPaidSearch("love is kind", "KJAV");
    allowPaidSearch(QUERY, "BSB");
    for (const [q, t] of [
      [QUERY, "KJAV"],
      ["love is kind", "KJAV"],
      [QUERY, "BSB"],
    ] as const) {
      const { observer, unsubscribe } = mount(p, q, t);
      await settle(observer);
      unsubscribe();
    }
    expect(p.run.mock.calls.map((c) => c.join("|"))).toEqual([
      `${QUERY}|KJAV`,
      "love is kind|KJAV",
      `${QUERY}|BSB`,
    ]);
  });

  it("showing the same search again in this session does not pay again", async () => {
    const p = page();
    allowPaidSearch(QUERY, "KJAV");
    const first = mount(p);
    await settle(first.observer);
    first.unsubscribe();
    const second = mount(p); // component remounted (for example by navigation)
    const result = await settle(second.observer);
    expect(result.data).toEqual(GOOD);
    expect(p.run).toHaveBeenCalledTimes(1);
    second.unsubscribe();
  });

  it("an explicit retry after a failure does pay for a new attempt, and success replaces the failure", async () => {
    const run = vi.fn<RunSearch>().mockResolvedValueOnce(DENIED).mockResolvedValueOnce(GOOD);
    const p = page({ run });
    allowPaidSearch(QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p);
    expect((await settle(observer)).data).toEqual(DENIED);
    expect(readSavedSearch(p.storage, QUERY, "KJAV")).toBeNull(); // failures are never saved
    await observer.refetch();
    expect((await settle(observer)).data).toEqual(GOOD);
    expect(run).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("reload and Vite restart", () => {
  it("restores a saved result after a full reload with no request", async () => {
    const storage = new FakeStorage();
    const before = page({ storage });
    allowPaidSearch(QUERY, "KJAV");
    const first = mount(before);
    await settle(first.observer);
    first.unsubscribe();

    // Reload: new JS session (empty cache, no intent), same sessionStorage.
    resetPaidSearchIntent();
    resetInFlightSearches();
    const after = page({ storage });
    const second = mount(after);
    const result = await settle(second.observer);
    expect(after.run).not.toHaveBeenCalled();
    expect(result.data).toEqual(GOOD);
    expect(result.isSuccess).toBe(true);
    second.unsubscribe();
  });

  it("a Vite restart (page reload on the ?q= URL) restores the result and never repeats the paid request", async () => {
    const storage = new FakeStorage();
    saveSearch(storage, QUERY, "KJAV", GOOD);
    for (let restart = 0; restart < 3; restart += 1) {
      resetPaidSearchIntent();
      const p = page({ storage });
      const { observer, unsubscribe } = mount(p);
      expect((await settle(observer)).data).toEqual(GOOD);
      expect(p.run).not.toHaveBeenCalled();
      unsubscribe();
    }
  });

  it("with a ?q= URL but no valid saved result, nothing runs until the person asks", async () => {
    const p = page();
    const { observer, unsubscribe } = mount(p);
    const result = await settle(observer);
    expect(p.run).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
    expect(result.fetchStatus).toBe("idle");
    unsubscribe();
  });

  it("an expired saved result is treated as absent: still no automatic request", async () => {
    const storage = new FakeStorage();
    saveSearch(storage, QUERY, "KJAV", GOOD, Date.now() - 61 * 60 * 1000);
    const p = page({ storage });
    const { observer, unsubscribe } = mount(p);
    await settle(observer);
    expect(p.run).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("a corrupted saved result is ignored: no request and no crash", async () => {
    const storage = new FakeStorage();
    saveSearch(storage, QUERY, "KJAV", GOOD);
    storage.setItem(storage.key(0)!, "{broken");
    const p = page({ storage });
    const { observer, unsubscribe } = mount(p);
    await settle(observer);
    expect(p.run).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("the person's action then starts exactly one request", async () => {
    const p = page();
    const { observer, unsubscribe } = mount(p);
    await settle(observer);
    allowPaidSearch(QUERY, "KJAV"); // pressing Search / Enter
    observer.setOptions(options(p, QUERY, "KJAV"));
    const result = await settle(observer);
    expect(p.run).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual(GOOD);
    unsubscribe();
  });
});

describe("no automatic refetching", () => {
  it("the query options switch off every automatic refetch trigger (each is a separate safeguard)", () => {
    const o = options(page(), QUERY, "KJAV");
    expect(o).toMatchObject({
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    });
    expect(o.gcTime).toBe(60 * 60 * 1000);
  });

  async function shown() {
    const p = page();
    allowPaidSearch(QUERY, "KJAV");
    const mounted = mount(p);
    await settle(mounted.observer);
    return { p, ...mounted };
  }

  it("window focus and reconnect do not refetch", async () => {
    const { p, observer, unsubscribe } = await shown();
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await settle(observer);
    expect(p.run).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("remounting does not refetch, even long after (results never go stale on their own)", async () => {
    const { p, observer, unsubscribe } = await shown();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 50 * 60 * 1000);
    const again = new QueryObserver(p.client, options(p, QUERY, "KJAV"));
    const off = again.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(p.run).toHaveBeenCalledTimes(1);
    off();
    unsubscribe();
    void observer;
  });

  it("the sign-in/focus event handler (invalidateUserQueries) never re-runs the paid search, while other user data is refreshed", async () => {
    const { p, observer, unsubscribe } = await shown();
    let savedCalls = 0;
    const saved = new QueryObserver(p.client, {
      queryKey: ["saved", "is", "u1"],
      queryFn: async () => ++savedCalls,
      staleTime: Infinity,
    });
    const offSaved = saved.subscribe(() => undefined);
    await vi.waitFor(() => expect(p.client.isFetching()).toBe(0));
    expect(savedCalls).toBe(1);

    await invalidateUserQueries(p.client);
    await vi.waitFor(() => expect(savedCalls).toBe(2));
    await settle(observer);
    expect(p.run).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toEqual(GOOD);
    offSaved();
    unsubscribe();
  });

  it("(why the guard exists) an unfiltered invalidation WOULD repeat the paid request", async () => {
    const { p, observer, unsubscribe } = await shown();
    await p.client.invalidateQueries();
    await vi.waitFor(() => expect(p.run).toHaveBeenCalledTimes(2));
    await settle(observer);
    unsubscribe();
  });
});

describe("translation preferences", () => {
  it("nothing runs before preferences are ready, so the translation cannot change after the request", async () => {
    const p = page();
    allowPaidSearch(QUERY, "KJAV");
    allowPaidSearch(QUERY, "BSB");
    // First render: defaults (KJAV), not ready.
    const early = mount(p, QUERY, "KJAV", false);
    await settle(early.observer);
    expect(p.run).not.toHaveBeenCalled();
    early.unsubscribe();
    // Preferences load: the saved translation (BSB) is now known.
    const late = mount(p, QUERY, "BSB", true);
    await settle(late.observer);
    expect(p.run.mock.calls).toEqual([[QUERY, "BSB"]]);
    late.unsubscribe();
  });

  it("a saved result is not restored until preferences are ready", () => {
    const storage = new FakeStorage();
    saveSearch(storage, QUERY, "KJAV", GOOD);
    expect(
      canRunAiSearch({
        description: QUERY,
        ready: false,
        allowed: true,
        saved: readSavedSearch(storage, QUERY, "KJAV"),
      }),
    ).toBe(false);
    expect(
      canRunAiSearch({
        description: QUERY,
        ready: true,
        allowed: false,
        saved: readSavedSearch(storage, QUERY, "KJAV"),
      }),
    ).toBe(true);
    expect(canRunAiSearch({ description: "", ready: true, allowed: true, saved: null })).toBe(
      false,
    );
  });

  it("changing the translation without asking does not pay, but a saved result for it is restored", async () => {
    const storage = new FakeStorage();
    saveSearch(storage, QUERY, "BSB", {
      ...GOOD,
      results: [{ ...GOOD.results[0]!, translation: "BSB" }],
    });
    const p = page({ storage });
    const noAsk = mount(p, QUERY, "WEB");
    await settle(noAsk.observer);
    expect(p.run).not.toHaveBeenCalled();
    noAsk.unsubscribe();
    const restored = mount(p, QUERY, "BSB");
    expect((await settle(restored.observer)).data?.results[0]?.translation).toBe("BSB");
    expect(p.run).not.toHaveBeenCalled();
    restored.unsubscribe();
  });
});

describe("a failed refetch never overwrites a successful result", () => {
  it("keeps the good result when a later request is refused", async () => {
    const run = vi.fn<RunSearch>().mockResolvedValueOnce(GOOD).mockResolvedValueOnce(DENIED);
    const p = page({ run });
    allowPaidSearch(QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p);
    await settle(observer);
    await observer.refetch();
    const result = await settle(observer);
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual(GOOD);
    expect(result.data?.failed).toBe(false);
    expect(readSavedSearch(p.storage, QUERY, "KJAV")?.response).toEqual(GOOD);
    expect(p.log.map((entry) => entry.event)).toContain("kept_previous_result");
    unsubscribe();
  });

  it("keeps the good result when the request itself throws", async () => {
    const run = vi
      .fn<RunSearch>()
      .mockResolvedValueOnce(GOOD)
      .mockRejectedValueOnce(new Error("network down"));
    const p = page({ run });
    allowPaidSearch(QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p);
    await settle(observer);
    await observer.refetch();
    const result = await settle(observer);
    expect(result.data).toEqual(GOOD); // the page also hides the error banner while results exist
    unsubscribe();
  });

  it("keeps a result restored from a previous page load when a new request is refused", async () => {
    const storage = new FakeStorage();
    saveSearch(storage, QUERY, "KJAV", GOOD);
    const p = page({ storage, run: vi.fn<RunSearch>(async () => DENIED) });
    const { observer, unsubscribe } = mount(p);
    await settle(observer);
    allowPaidSearch(QUERY, "KJAV");
    await observer.refetch();
    expect((await settle(observer)).data).toEqual(GOOD);
    unsubscribe();
  });

  it("does not hide a failure when there was no earlier success", async () => {
    const p = page({ run: vi.fn<RunSearch>(async () => DENIED) });
    allowPaidSearch(QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p);
    expect((await settle(observer)).data).toEqual(DENIED);
    unsubscribe();
  });
});

describe("duplicate in-flight submissions", () => {
  function slowRun() {
    let release!: (value: ScriptureSearchResponse) => void;
    const run = vi.fn<RunSearch>(
      () => new Promise<ScriptureSearchResponse>((resolve) => (release = resolve)),
    );
    return { run, finish: (value: ScriptureSearchResponse = GOOD) => release(value) };
  }

  it("two identical requests at once share one", async () => {
    const { run, finish } = slowRun();
    const p = page({ run });
    const deps: PaidSearchDeps = { run, storage: p.storage, log: (entry) => p.log.push(entry) };
    const a = fetchPaidSearch(p.client, deps, QUERY, "KJAV");
    const b = fetchPaidSearch(p.client, deps, QUERY, "KJAV");
    finish();
    expect(await a).toEqual(GOOD);
    expect(await b).toEqual(GOOD);
    expect(run).toHaveBeenCalledTimes(1);
    expect(p.log.map((e) => e.event)).toEqual(["request", "duplicate_blocked"]);
  });

  it("clicking 'Search again' repeatedly while a request runs still pays once", async () => {
    const { run, finish } = slowRun();
    const p = page({ run });
    allowPaidSearch(QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const clicks = [observer.refetch(), observer.refetch(), observer.refetch()]; // cancelRefetch restarts the query function
    finish();
    await Promise.all(clicks);
    expect(run).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("two page instances for the same search (a remount during the request) pay once", async () => {
    const { run, finish } = slowRun();
    const p = page({ run });
    allowPaidSearch(QUERY, "KJAV");
    const a = mount(p);
    const b = mount(p);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    finish();
    await settle(a.observer);
    expect(run).toHaveBeenCalledTimes(1);
    a.unsubscribe();
    b.unsubscribe();
  });

  it("after the request ends, a new explicit request is allowed again", async () => {
    const p = page();
    const deps: PaidSearchDeps = { run: p.run, storage: p.storage };
    await fetchPaidSearch(p.client, deps, QUERY, "KJAV");
    await fetchPaidSearch(p.client, deps, QUERY, "KJAV");
    expect(p.run).toHaveBeenCalledTimes(2);
  });

  it("releases the slot even when the request throws", async () => {
    const run = vi
      .fn<RunSearch>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(GOOD);
    const p = page({ run });
    const deps: PaidSearchDeps = { run, storage: p.storage };
    await expect(fetchPaidSearch(p.client, deps, QUERY, "KJAV")).rejects.toThrow("boom");
    expect(await fetchPaidSearch(p.client, deps, QUERY, "KJAV")).toEqual(GOOD);
  });
});

describe("diagnostics are safe", () => {
  it("record events, translation and length only: never the words, tokens or addresses", async () => {
    const SECRET_QUERY = "my private prayer request about my family";
    const p = page();
    allowPaidSearch(SECRET_QUERY, "KJAV");
    const { observer, unsubscribe } = mount(p, SECRET_QUERY, "KJAV");
    await settle(observer);
    const text = JSON.stringify(p.log);
    expect(text).not.toContain("private prayer");
    expect(text).not.toContain("family");
    expect(p.log[0]).toEqual({
      event: "request",
      translation: "KJAV",
      queryLength: SECRET_QUERY.length,
    });
    unsubscribe();
  });
});

describe("end to end with the real server rules (cap of one paid search)", () => {
  function server() {
    let consumed = 0;
    const providerCalls = vi.fn();
    const provider: ReferenceProvider = {
      id: "openai",
      findCandidates: async () => {
        providerCalls();
        return { candidates: [{ book: "1 Corinthians", chapter: 13, verse: 4 }] };
      },
    };
    const consumeRpc = vi.fn(async () => {
      consumed += 1;
      return consumed <= 1
        ? { data: [{ allowed: true, reason: null, retry_after_seconds: 0 }], error: null }
        : {
            data: [{ allowed: false, reason: "global_day", retry_after_seconds: 3600 }],
            error: null,
          };
    });
    const deps: SearchServiceDeps = {
      readConfig: () => ({
        enabled: true,
        provider: "openai",
        model: "gpt-6-luna",
        effort: "none",
        limits: { ...DEFAULT_LIMITS, globalDay: 1 },
      }),
      env: { OPENAI_API_KEY: "sk-x", RATE_LIMIT_SALT: "salt-0123456789abcdef0123456789abcd" },
      onVercel: false,
      createProvider: () => provider,
      verifyToken: async () => null,
      consumeRpc,
      resolveAndRank: async () => GOOD.results,
      cache: new Map(),
      log: () => undefined,
    };
    const run: RunSearch = (query, translation) =>
      runAiSearch({ query, translation }, { headers: new Headers(), socketIp: "127.0.0.1" }, deps);
    return { run, providerCalls, consumeRpc };
  }

  it("the first-browser-test sequence: result shown, then reload, focus, sign-in event and restart cost nothing and keep the result", async () => {
    const { run, providerCalls, consumeRpc } = server();
    const storage = new FakeStorage();
    const runSpy = vi.fn<RunSearch>(run);

    // 1. The person searches.
    const first = page({ storage, run: runSpy });
    allowPaidSearch(QUERY, "KJAV");
    const a = mount(first);
    expect((await settle(a.observer)).data).toMatchObject(GOOD);

    // 2. Everything that used to cause a second request.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await invalidateUserQueries(first.client); // SIGNED_IN on tab focus
    await settle(a.observer);
    a.unsubscribe();

    // 3. Reload / Vite restart: empty cache and intent, same sessionStorage.
    resetPaidSearchIntent();
    resetInFlightSearches();
    const reloaded = page({ storage, run: runSpy });
    const b = mount(reloaded);
    expect((await settle(b.observer)).data).toMatchObject(GOOD);

    // Whole sequence: one paid request, one quota unit, one provider call.
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(consumeRpc).toHaveBeenCalledTimes(1);
    expect(providerCalls).toHaveBeenCalledTimes(1);

    // 4. A deliberate retry is refused by the server, and the good result stays on screen.
    allowPaidSearch(QUERY, "KJAV");
    await b.observer.refetch();
    const result = await settle(b.observer);
    expect(consumeRpc).toHaveBeenCalledTimes(2); // quota-before-cache rule is unchanged
    expect(providerCalls).toHaveBeenCalledTimes(1); // but no second OpenAI call
    expect(result.data).toMatchObject(GOOD);
    b.unsubscribe();
  });
});
