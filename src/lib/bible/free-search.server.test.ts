import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FREE_LIMITS,
  EDITIONS_CACHE_MS,
  StoreError,
  createSupabaseStore,
  readFreeSearchConfig,
  runFreeSearch,
  type FreeSearchDeps,
  type FreeSearchLog,
  type FreeSearchStore,
  type SearchRow,
} from "./free-search.server";

const SALT = "test-salt-value";
const ctx = (extra: Partial<Parameters<typeof runFreeSearch>[1]> = {}) => ({
  headers: new Headers(),
  socketIp: "203.0.113.9",
  ...extra,
});
const row = (over: Partial<SearchRow> = {}): SearchRow => ({
  edition_code: "BSB",
  book: "JHN",
  chapter: 3,
  verse: 16,
  verse_text: "For God so loved the world",
  total_count: 1,
  corrected_query: null,
  ...over,
});

interface Calls {
  order: string[];
  search: unknown[];
  quota: unknown[];
  editions: number;
}

function harness(
  over: {
    store?: Partial<FreeSearchStore>;
    env?: Record<string, string | undefined>;
    rows?: SearchRow[];
    active?: string[];
    quota?: Awaited<ReturnType<FreeSearchStore["consumeQuota"]>>;
    verify?: FreeSearchDeps["verifyToken"];
    now?: () => number;
  } = {},
) {
  const calls: Calls = { order: [], search: [], quota: [], editions: 0 };
  const logs: FreeSearchLog[] = [];
  const store: FreeSearchStore = {
    listActiveEditions: async () => {
      calls.order.push("editions");
      calls.editions += 1;
      return over.active ?? ["WEB", "BSB", "ASV"];
    },
    consumeQuota: async (args) => {
      calls.order.push("quota");
      calls.quota.push(args);
      return over.quota === undefined
        ? { allowed: true, reason: null, retryAfterSeconds: 0 }
        : over.quota;
    },
    search: async (args) => {
      calls.order.push("search");
      calls.search.push(args);
      return over.rows ?? [row()];
    },
    ...over.store,
  };
  const deps: FreeSearchDeps = {
    readConfig: () => readFreeSearchConfig({ FREE_SEARCH_ENABLED: "true", ...over.env }),
    env: { RATE_LIMIT_SALT: SALT, ...over.env },
    onVercel: false,
    verifyToken: over.verify ?? (async () => null),
    store,
    now: over.now ?? (() => Date.now()),
    log: (entry) => logs.push(entry),
    editionsCache: { value: null, at: 0 },
  };
  return { deps, calls, logs };
}

const ok = (result: Awaited<ReturnType<typeof runFreeSearch>>) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.response;
};

describe("configuration", () => {
  it("is off unless FREE_SEARCH_ENABLED is exactly true, with the agreed default limits", () => {
    expect(readFreeSearchConfig({}).enabled).toBe(false);
    expect(readFreeSearchConfig({ FREE_SEARCH_ENABLED: "yes" }).enabled).toBe(false);
    expect(readFreeSearchConfig({ FREE_SEARCH_ENABLED: " TRUE " }).enabled).toBe(true);
    expect(readFreeSearchConfig({}).limits).toEqual(DEFAULT_FREE_LIMITS);
    expect(DEFAULT_FREE_LIMITS).toMatchObject({
      guestMinute: 30,
      guestDay: 600,
      globalMinute: 300,
    });
  });

  it("limits and the timeout come from the environment, bounded and validated", () => {
    const config = readFreeSearchConfig({
      FREE_LIMIT_GUEST_MINUTE: "5",
      FREE_LIMIT_GUEST_DAY: "abc",
      FREE_SEARCH_TIMEOUT_MS: "99999",
    });
    expect(config.limits.guestMinute).toBe(5);
    expect(config.limits.guestDay).toBe(DEFAULT_FREE_LIMITS.guestDay);
    expect(config.timeoutMs).toBe(5000);
    expect(readFreeSearchConfig({ FREE_SEARCH_TIMEOUT_MS: "10" }).timeoutMs).toBe(500);
  });
});

describe("Production safeguard", () => {
  it("the flag is ignored on a Production deployment, whatever its value or spelling", () => {
    for (const vercelEnv of ["production", "Production", " PRODUCTION "]) {
      expect(
        readFreeSearchConfig({ FREE_SEARCH_ENABLED: "true", VERCEL_ENV: vercelEnv }).enabled,
        vercelEnv,
      ).toBe(false);
    }
  });

  it("Preview, development and a non-Vercel environment can still enable it", () => {
    for (const vercelEnv of ["preview", "development", undefined]) {
      expect(
        readFreeSearchConfig({ FREE_SEARCH_ENABLED: "true", VERCEL_ENV: vercelEnv }).enabled,
        String(vercelEnv),
      ).toBe(true);
    }
    expect(readFreeSearchConfig({ VERCEL_ENV: "preview" }).enabled).toBe(false);
  });

  it("on Production a search answers 'preparing' without touching the database or the quota", async () => {
    const { deps, calls } = harness({ env: { VERCEL_ENV: "production" } });
    const response = ok(await runFreeSearch({ query: "shepherd" }, ctx(), deps));
    expect(response).toMatchObject({ status: "preparing", results: [] });
    expect(calls.order).toEqual([]);
  });

  it("on Preview the same setup searches normally", async () => {
    const { deps, calls } = harness({ env: { VERCEL_ENV: "preview" } });
    expect(ok(await runFreeSearch({ query: "shepherd" }, ctx(), deps)).status).toBe("ready");
    expect(calls.order).toEqual(["editions", "quota", "search"]);
  });
});

describe("kill switch and readiness", () => {
  it("disabled: answers 'preparing' and touches neither the database nor the quota", async () => {
    const { deps, calls, logs } = harness({ env: { FREE_SEARCH_ENABLED: "false" } });
    const response = ok(await runFreeSearch({ query: "shepherd" }, ctx(), deps));
    expect(response).toMatchObject({ status: "preparing", results: [], searchedEditions: [] });
    expect(calls.order).toEqual([]);
    expect(logs[0]?.outcome).toBe("disabled");
  });

  it("enabled but no edition is active yet: 'preparing', and no quota is spent", async () => {
    const { deps, calls } = harness({ active: [] });
    expect(ok(await runFreeSearch({ query: "shepherd" }, ctx(), deps)).status).toBe("preparing");
    expect(calls.order).toEqual(["editions"]);
  });

  it("only editions that are active (and on the allow-list) are searched", async () => {
    const { deps, calls } = harness({ active: ["WEB", "KJAV", "BBE"] });
    const response = ok(await runFreeSearch({ query: "shepherd" }, ctx(), deps));
    expect(response.searchedEditions).toEqual(["WEB"]);
    expect((calls.search[0] as { editions: string[] }).editions).toEqual(["WEB"]);
  });

  it("a requested edition that is not active is not searched, and not claimed as searched", async () => {
    const { deps, calls } = harness({ active: ["WEB", "BSB"] });
    const response = ok(
      await runFreeSearch({ query: "shepherd", editions: ["ASV", "BSB"] }, ctx(), deps),
    );
    expect(response.searchedEditions).toEqual(["BSB"]);
    expect((calls.search[0] as { editions: string[] }).editions).toEqual(["BSB"]);
  });

  it("caches the list of active editions for a minute", async () => {
    let now = 1_000_000;
    const { deps, calls } = harness({ now: () => now });
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(calls.editions).toBe(1);
    now += EDITIONS_CACHE_MS + 1;
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(calls.editions).toBe(2);
  });
});

describe("request validation (nothing reaches the database when it fails)", () => {
  const bad: [string, unknown][] = [
    ["a body that is not an object", "shepherd"],
    ["a missing query", {}],
    ["a query that is not a string", { query: 42 }],
    ["an unknown key", { query: "shepherd", extra: true }],
    ["an edition outside the allow-list (KJAV)", { query: "shepherd", editions: ["KJAV"] }],
    ["an edition outside the allow-list (BBE)", { query: "shepherd", editions: ["BBE"] }],
    ["a lower-case edition", { query: "shepherd", editions: ["web"] }],
    ["an empty edition list", { query: "shepherd", editions: [] }],
    ["a negative offset", { query: "shepherd", offset: -1 }],
    ["an offset beyond 1,000", { query: "shepherd", offset: 1001 }],
    ["a fractional offset", { query: "shepherd", offset: 1.5 }],
    ["a limit above 25", { query: "shepherd", limit: 26 }],
    ["a limit of zero", { query: "shepherd", limit: 0 }],
    ["a query over 2,000 characters", { query: "x".repeat(2001) }],
  ];
  for (const [name, input] of bad) {
    it(`rejects ${name}`, async () => {
      const { deps, calls } = harness();
      const result = await runFreeSearch(input, ctx(), deps);
      expect(result).toEqual({ ok: false, error: "invalid" });
      expect(calls.order).toEqual([]);
    });
  }

  it("rejects queries that are too short or too long after normalising", async () => {
    for (const query of ["", " ", "a", "  a  ", "x".repeat(201), `${"word ".repeat(60)}x`]) {
      const { deps, calls } = harness();
      expect(await runFreeSearch({ query }, ctx(), deps), JSON.stringify(query.length)).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(calls.order).toEqual([]);
    }
  });

  it("typo repair is on by default and off only when the caller asks for its original wording", async () => {
    const on = harness();
    await runFreeSearch({ query: "sheperd" }, ctx(), on.deps);
    expect((on.calls.search[0] as { repair: boolean }).repair).toBe(true);
    const off = harness();
    await runFreeSearch({ query: "sheperd", repair: false }, ctx(), off.deps);
    expect((off.calls.search[0] as { repair: boolean }).repair).toBe(false);
    const explicit = harness();
    await runFreeSearch({ query: "sheperd", repair: true }, ctx(), explicit.deps);
    expect((explicit.calls.search[0] as { repair: boolean }).repair).toBe(true);
  });

  it("rejects a repair flag that is not a boolean", async () => {
    const { deps, calls } = harness();
    for (const repair of ["false", 0, null]) {
      expect(await runFreeSearch({ query: "shepherd", repair }, ctx(), deps)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(calls.order).toEqual([]);
  });

  it("accepts the boundaries: 2 and 200 characters, offset 0 and 1,000, limit 1 and 25", async () => {
    const { deps } = harness();
    for (const request of [
      { query: "ab" },
      { query: "x".repeat(200) },
      { query: "shepherd", offset: 0, limit: 1 },
      { query: "shepherd", offset: 1000, limit: 25 },
    ]) {
      expect((await runFreeSearch(request, ctx(), deps)).ok, JSON.stringify(request)).toBe(true);
    }
  });

  it("normalises the query before it is used: Unicode form, control characters, spacing", async () => {
    const { deps, calls } = harness();
    await runFreeSearch({ query: "  Café\u0007   shep\nherd\t " }, ctx(), deps);
    expect((calls.search[0] as { query: string }).query).toBe("Café shep herd");
  });

  it("passes clamped paging to the database and de-duplicates editions", async () => {
    const { deps, calls } = harness();
    await runFreeSearch(
      { query: "shepherd", editions: ["WEB", "WEB", "BSB"], offset: 50, limit: 10 },
      ctx(),
      deps,
    );
    expect(calls.search[0]).toEqual({
      query: "shepherd",
      editions: ["WEB", "BSB"],
      limit: 10,
      offset: 50,
      repair: true,
    });
  });
});

describe("rate limiting", () => {
  it("is consumed before the search, and the search never runs when it is refused", async () => {
    const { deps, calls } = harness({
      quota: { allowed: false, reason: "minute", retryAfterSeconds: 17 },
    });
    const result = await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(result).toEqual({ ok: false, error: "limit", retryAfterSeconds: 17 });
    expect(calls.order).toEqual(["editions", "quota"]);
  });

  it("order of work on success: editions, quota, search", async () => {
    const { deps, calls } = harness();
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(calls.order).toEqual(["editions", "quota", "search"]);
  });

  it("every page of a search costs one unit", async () => {
    const { deps, calls } = harness();
    await runFreeSearch({ query: "shepherd", offset: 0 }, ctx(), deps);
    await runFreeSearch({ query: "shepherd", offset: 25 }, ctx(), deps);
    expect(calls.quota).toHaveLength(2);
  });

  it("fails closed: an unreadable counter is a refusal, not an unmetered search", async () => {
    const { deps, calls } = harness({ quota: null });
    expect(await runFreeSearch({ query: "shepherd" }, ctx(), deps)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(calls.search).toEqual([]);
  });

  it("a quota call that throws is treated like an unreadable counter", async () => {
    const { deps, calls } = harness({
      store: {
        consumeQuota: async () => {
          throw new Error("boom with secret detail");
        },
      },
    });
    expect(await runFreeSearch({ query: "shepherd" }, ctx(), deps)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(calls.search).toEqual([]);
  });

  it("refuses when no rate-limit salt is configured (it could not meter the caller)", async () => {
    const { deps, calls } = harness({ env: { RATE_LIMIT_SALT: "" } });
    expect(await runFreeSearch({ query: "shepherd" }, ctx(), deps)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(calls.order).toEqual([]);
  });

  it("a guest is metered by a keyed hash of the address, never the address itself", async () => {
    const { deps, calls } = harness();
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    const args = calls.quota[0] as {
      subject: string;
      minuteLimit: number;
      dayLimit: number;
      globalMinuteLimit: number;
    };
    expect(args.subject).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(args.subject).not.toContain("203");
    expect(args).toMatchObject({ minuteLimit: 30, dayLimit: 600, globalMinuteLimit: 300 });
  });

  it("a verified signed-in user gets the user limits and a user subject", async () => {
    const id = "abcdef01-2345-4678-89ab-cdef01234567";
    const { deps, calls } = harness({
      verify: async () => ({ sub: id, role: "authenticated" }),
    });
    await runFreeSearch({ query: "shepherd" }, ctx({ authorization: "Bearer aaa.bbb.ccc" }), deps);
    expect(calls.quota[0]).toMatchObject({
      subject: `user:${id}`,
      minuteLimit: 60,
      dayLimit: 1500,
    });
  });

  it("an invalid token is just a guest, not an error", async () => {
    const { deps, calls } = harness({
      verify: async () => {
        throw new Error("nope");
      },
    });
    const result = await runFreeSearch(
      { query: "shepherd" },
      ctx({ authorization: "Bearer aaa.bbb.ccc" }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect((calls.quota[0] as { subject: string }).subject).toMatch(/^ip:/);
  });
});

describe("results", () => {
  it("returns canonical edition codes, Reader book ids, references and the exact total", async () => {
    const { deps } = harness({
      rows: [
        row({ edition_code: "ASV", book: "1CO", chapter: 13, verse: 4, total_count: 395 }),
        row({ edition_code: "WEB", book: "PSA", chapter: 23, verse: 1, total_count: 395 }),
      ],
    });
    const response = ok(await runFreeSearch({ query: "love" }, ctx(), deps));
    expect(response.results.map((r) => [r.translation, r.bookId, r.reference])).toEqual([
      ["ASV", "1corinthians", "1 Corinthians 13:4"],
      ["WEB", "psalms", "Psalms 23:1"],
    ]);
    expect(response).toMatchObject({ status: "ready", total: 395, offset: 0, hasMore: true });
    expect(response.limitReached).toBe(false);
  });

  it("drops rows it cannot map (unknown book, edition outside the allow-list)", async () => {
    const { deps } = harness({
      rows: [row({ book: "XXX" }), row({ edition_code: "KJAV" }), row()],
    });
    expect(ok(await runFreeSearch({ query: "world" }, ctx(), deps)).results).toHaveLength(1);
  });

  it("reports the corrected query when the database repaired a typo", async () => {
    const { deps } = harness({ rows: [row({ corrected_query: "shepherd" })] });
    expect(ok(await runFreeSearch({ query: "sheperd" }, ctx(), deps)).correctedQuery).toBe(
      "shepherd",
    );
    const plain = harness();
    expect(ok(await runFreeSearch({ query: "shepherd" }, ctx(), plain.deps))).not.toHaveProperty(
      "correctedQuery",
    );
  });

  it("no matches: ready, empty, total 0, and the searched editions are still named", async () => {
    const { deps } = harness({ rows: [], active: ["WEB", "BSB", "ASV"] });
    expect(ok(await runFreeSearch({ query: "zeppelin" }, ctx(), deps))).toMatchObject({
      status: "ready",
      results: [],
      total: 0,
      hasMore: false,
      searchedEditions: ["WEB", "BSB", "ASV"],
    });
  });

  it("paging: more is available until the end, and the 1,025-row limit is reported", async () => {
    const page = (n: number, total: number) =>
      Array.from({ length: n }, (_, i) => row({ chapter: 1, verse: i + 1, total_count: total }));
    const first = harness({ rows: page(25, 60) });
    expect(ok(await runFreeSearch({ query: "grace", offset: 0 }, ctx(), first.deps))).toMatchObject(
      {
        hasMore: true,
        total: 60,
      },
    );
    const last = harness({ rows: page(10, 60) });
    expect(ok(await runFreeSearch({ query: "grace", offset: 50 }, ctx(), last.deps))).toMatchObject(
      {
        hasMore: false,
        limitReached: false,
      },
    );
    const deepest = harness({ rows: page(25, 11900) });
    expect(
      ok(await runFreeSearch({ query: "God", offset: 1000 }, ctx(), deepest.deps)),
    ).toMatchObject({
      hasMore: false,
      limitReached: true,
      total: 11900,
    });
    const before = harness({ rows: page(25, 11900) });
    expect(
      ok(await runFreeSearch({ query: "God", offset: 975 }, ctx(), before.deps)),
    ).toMatchObject({
      hasMore: true,
      limitReached: false,
    });
  });
});

describe("failures never expose internals", () => {
  const SECRET = "SELECT * FROM bible_verses WHERE verse_text = 'my private question'";

  it("a database timeout is a 'timeout' result", async () => {
    const { deps } = harness({
      store: {
        search: async () => {
          throw new StoreError("timeout", "57014");
        },
      },
    });
    expect(await runFreeSearch({ query: "my private question" }, ctx(), deps)).toEqual({
      ok: false,
      error: "timeout",
    });
  });

  it("any other database failure is 'unavailable', and nothing from the error reaches the caller or the logs", async () => {
    const { deps, logs } = harness({
      store: {
        search: async () => {
          throw new Error(SECRET);
        },
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runFreeSearch({ query: "my private question" }, ctx(), deps);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    const everything = JSON.stringify([result, logs, errorSpy.mock.calls]);
    expect(everything).not.toContain("private question");
    expect(everything).not.toContain("SELECT");
    errorSpy.mockRestore();
  });

  it("a failure while reading the active editions is also contained", async () => {
    const { deps } = harness({
      store: {
        listActiveEditions: async () => {
          throw new StoreError("unavailable", "08006");
        },
      },
    });
    expect(await runFreeSearch({ query: "shepherd" }, ctx(), deps)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("an unexpected exception inside the service is contained too", async () => {
    const { deps } = harness();
    deps.readConfig = () => {
      throw new Error("config exploded with my private question");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runFreeSearch({ query: "x y" }, ctx(), deps)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private question");
    errorSpy.mockRestore();
  });
});

describe("time limit and cancellation", () => {
  it("gives the store one signal that fires at the time limit", async () => {
    let seen: AbortSignal | undefined;
    const { deps } = harness({
      env: { FREE_SEARCH_TIMEOUT_MS: "500" },
      store: {
        search: async (_args, signal) => {
          seen = signal;
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (signal.aborted) throw new StoreError("timeout");
          return [];
        },
      },
    });
    const result = await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(seen?.aborted).toBe(true);
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("the caller going away (request abort) reaches the store's signal", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const { deps } = harness({
      store: {
        search: async (_args, signal) => {
          seen = signal;
          controller.abort();
          if (signal.aborted) throw new StoreError("timeout");
          return [];
        },
      },
    });
    await runFreeSearch({ query: "shepherd" }, ctx({ signal: controller.signal }), deps);
    expect(seen?.aborted).toBe(true);
  });
});

describe("privacy: the query text goes nowhere but the database call", () => {
  it("is absent from every log line and every returned value, across outcomes", async () => {
    const query = "zebedee unusual phrase 8842";
    const logsAll: unknown[] = [];
    const returned: unknown[] = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const scenarios = [
      harness(),
      harness({ quota: { allowed: false, reason: "day", retryAfterSeconds: 90 } }),
      harness({ quota: null }),
      harness({ active: [] }),
      harness({ env: { FREE_SEARCH_ENABLED: "false" } }),
      harness({ rows: [row({ corrected_query: "zebedee" })] }),
      harness({
        store: {
          search: async () => {
            throw new StoreError("timeout", "57014");
          },
        },
      }),
    ];
    for (const s of scenarios) {
      returned.push(await runFreeSearch({ query }, ctx(), s.deps));
      logsAll.push(s.logs);
    }
    const text = JSON.stringify([
      logsAll,
      returned.filter((r) => !(r as { ok: boolean }).ok),
      info.mock.calls,
    ]);
    expect(text).not.toContain("zebedee");
    expect(text).not.toContain("8842");
    info.mockRestore();
  });

  it("log entries have a fixed, query-free shape", async () => {
    const { deps, logs } = harness();
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(Object.keys(logs[0]!).sort()).toEqual([
      "durationMs",
      "editions",
      "event",
      "outcome",
      "page",
      "results",
      "subjectKind",
    ]);
  });

  it("stores nothing: there is no cache of results or queries", async () => {
    const { deps, calls } = harness();
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    await runFreeSearch({ query: "shepherd" }, ctx(), deps);
    expect(calls.search).toHaveLength(2);
  });
});

describe("the production store (a fake service-role client)", () => {
  function fakeAdmin(result: { data: unknown; error: unknown }) {
    const rpcCalls: { name: string; args: Record<string, unknown>; signal?: AbortSignal }[] = [];
    const fromCalls: string[] = [];
    const admin = {
      rpc(name: string, args: Record<string, unknown>) {
        return {
          abortSignal(signal: AbortSignal) {
            rpcCalls.push({ name, args, signal });
            return Promise.resolve(result);
          },
        };
      },
      from(table: string) {
        fromCalls.push(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          abortSignal: () => Promise.resolve(result),
        };
        return chain;
      },
    };
    return { admin, rpcCalls, fromCalls };
  }
  const signal = new AbortController().signal;

  it("calls search_bible with named, typed parameters and the abort signal", async () => {
    const { admin, rpcCalls } = fakeAdmin({ data: [row()], error: null });
    const store = createSupabaseStore(async () => admin as never);
    const rows = await store.search(
      { query: "shepherd", editions: ["WEB", "BSB"], limit: 10, offset: 25, repair: true },
      signal,
    );
    expect(rows).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: "search_bible",
      args: {
        p_query: "shepherd",
        p_editions: ["WEB", "BSB"],
        p_limit: 10,
        p_offset: 25,
        p_repair: true,
      },
      signal,
    });
  });

  it("calls consume_free_search_quota and reads its answer defensively", async () => {
    const good = fakeAdmin({
      data: [{ allowed: false, reason: "minute", retry_after_seconds: 12 }],
      error: null,
    });
    expect(
      await createSupabaseStore(async () => good.admin as never).consumeQuota(
        {
          subject: "ip:0123456789abcdef0123456789abcdef",
          minuteLimit: 30,
          dayLimit: 600,
          globalMinuteLimit: 300,
        },
        signal,
      ),
    ).toEqual({ allowed: false, reason: "minute", retryAfterSeconds: 12 });
    expect(good.rpcCalls[0]).toMatchObject({
      name: "consume_free_search_quota",
      args: { p_minute_limit: 30, p_day_limit: 600, p_global_minute_limit: 300 },
    });
    for (const data of [null, [], [{}], [{ allowed: "yes" }]]) {
      const bad = fakeAdmin({ data, error: null });
      expect(
        await createSupabaseStore(async () => bad.admin as never).consumeQuota(
          {
            subject: "ip:0123456789abcdef0123456789abcdef",
            minuteLimit: 1,
            dayLimit: 1,
            globalMinuteLimit: 1,
          },
          signal,
        ),
        JSON.stringify(data),
      ).toBeNull();
    }
  });

  it("reduces any database error to a kind and a code (no message, no details)", async () => {
    const { admin } = fakeAdmin({
      error: {
        code: "57014",
        message: "canceling statement: select ... 'my private question'",
        details: "private",
      },
      data: null,
    });
    const store = createSupabaseStore(async () => admin as never);
    const error = await store
      .search({ query: "x y", editions: ["WEB"], limit: 10, offset: 0, repair: true }, signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoreError);
    expect(error).toMatchObject({ kind: "timeout", code: "57014", message: "timeout" });
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("a client that cannot be created (missing configuration) is 'unavailable', without its message", async () => {
    const store = createSupabaseStore(async () => {
      throw new Error("Missing Supabase environment variable(s): SUPABASE_URL");
    });
    const error = await store
      .search({ query: "x y", editions: ["WEB"], limit: 10, offset: 0, repair: true }, signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unavailable", message: "unavailable" });
  });

  it("lists active editions from the sources table", async () => {
    const { admin, fromCalls } = fakeAdmin({
      data: [{ edition_code: "WEB" }, { nope: 1 }],
      error: null,
    });
    expect(
      await createSupabaseStore(async () => admin as never).listActiveEditions(signal),
    ).toEqual(["WEB"]);
    expect(fromCalls).toEqual(["bible_sources"]);
  });
});
