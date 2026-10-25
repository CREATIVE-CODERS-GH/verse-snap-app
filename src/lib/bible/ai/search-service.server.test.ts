import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS, type AiSearchConfig } from "./config.server";
import {
  MESSAGES,
  retryMessage,
  runAiSearch,
  type SearchServiceDeps,
  type UsageLog,
} from "./search-service.server";
import { AiProviderError, type ReferenceProvider, type ScriptureSearchResult } from "./types";

const API_KEY = "sk-test-SECRET-never-in-a-response-0123456789";
const SALT = "unit-test-salt-0123456789abcdef0123456789";
const USER_ID = "3f2a9c1e-5b7d-4c8a-9e10-abcdef012345";
const SOCKET_IP = "203.0.113.9";
const QUERY = "love is patient";

const config: AiSearchConfig = {
  enabled: true,
  provider: "openai",
  model: "gpt-6-luna",
  effort: "none",
  limits: DEFAULT_LIMITS,
};

const result: ScriptureSearchResult = {
  translation: "KJAV",
  bookId: "1corinthians",
  bookName: "1 Corinthians",
  chapter: 13,
  verse: 4,
  reference: "1 Corinthians 13:4",
  text: "Charity suffereth long.",
};

const allowed = { data: [{ allowed: true, reason: null, retry_after_seconds: 0 }], error: null };
const denied = (reason: string, seconds = 30) => ({
  data: [{ allowed: false, reason, retry_after_seconds: seconds }],
  error: null,
});

function setup(
  over: Partial<SearchServiceDeps> = {},
  providerImpl?: ReferenceProvider["findCandidates"],
) {
  const findCandidates = vi.fn(
    providerImpl ??
      (async () => ({
        candidates: [{ book: "1 Corinthians", chapter: 13, verse: 4 }],
        usage: {
          inputTokens: 299,
          outputTokens: 172,
          reasoningTokens: 0,
          estimatedCostUsd: 0.000116,
        },
      })),
  );
  const provider: ReferenceProvider = { id: "openai", findCandidates };
  const consumeRpc = vi.fn(async (_args: unknown) => allowed as { data: unknown; error: unknown });
  const resolveAndRank = vi.fn(async () => [result]);
  const log = vi.fn((_entry: UsageLog) => undefined);
  const deps: SearchServiceDeps = {
    readConfig: () => config,
    env: { OPENAI_API_KEY: API_KEY, RATE_LIMIT_SALT: SALT },
    onVercel: false,
    createProvider: () => provider,
    verifyToken: vi.fn(async () => null),
    consumeRpc,
    resolveAndRank,
    cache: new Map(),
    log,
    ...over,
  };
  return { deps, findCandidates, consumeRpc, resolveAndRank, log };
}

const ctx = (headers: Record<string, string> = {}) => ({
  headers: new Headers(headers),
  socketIp: SOCKET_IP,
});

const search = (
  deps: SearchServiceDeps,
  query = QUERY,
  headers: Record<string, string> = {},
  translation?: string,
) => runAiSearch({ query, translation }, ctx(headers), deps);

afterEach(() => vi.restoreAllMocks());

describe("kill switch and configuration", () => {
  it("does nothing at all when AI search is disabled", async () => {
    const { deps, findCandidates, consumeRpc, resolveAndRank } = setup({
      readConfig: () => ({ ...config, enabled: false }),
    });
    const response = await search(deps);
    expect(response).toEqual({
      results: [],
      failed: true,
      errorMessage: MESSAGES.notConfigured,
      aiStatus: "off",
    });
    expect(findCandidates).not.toHaveBeenCalled();
    expect(consumeRpc).not.toHaveBeenCalled();
    expect(resolveAndRank).not.toHaveBeenCalled();
  });

  it("reports 'not configured' without spending quota when the provider cannot be built (missing key)", async () => {
    const { deps, consumeRpc } = setup({ createProvider: () => null });
    const response = await search(deps);
    expect(response.errorMessage).toBe(MESSAGES.notConfigured);
    expect(consumeRpc).not.toHaveBeenCalled();
  });

  it("reports 'not configured' when the rate-limit salt is missing or blank", async () => {
    for (const env of [
      { OPENAI_API_KEY: API_KEY },
      { OPENAI_API_KEY: API_KEY, RATE_LIMIT_SALT: "  " },
    ]) {
      const { deps, findCandidates, consumeRpc } = setup({ env });
      const response = await search(deps);
      expect(response.errorMessage).toBe(MESSAGES.notConfigured);
      expect(findCandidates).not.toHaveBeenCalled();
      expect(consumeRpc).not.toHaveBeenCalled();
    }
  });
});

describe("input rules (checked before any quota or paid call)", () => {
  it("rejects a description over 200 characters, accepts exactly 200", async () => {
    const tooLong = setup();
    const response = await search(tooLong.deps, "a".repeat(201));
    expect(response.failed).toBe(true);
    expect(response.errorMessage).toContain("200");
    expect(tooLong.consumeRpc).not.toHaveBeenCalled();
    expect(tooLong.findCandidates).not.toHaveBeenCalled();

    const exact = setup();
    expect((await search(exact.deps, "a".repeat(200))).failed).toBe(false);
    expect(exact.findCandidates).toHaveBeenCalledTimes(1);
  });

  it("rejects empty, one-character and control-character searches", async () => {
    for (const query of ["", " ", "a", "hello\u0000world"]) {
      const { deps, consumeRpc, findCandidates } = setup();
      const response = await search(deps, query);
      expect(response.failed).toBe(true);
      expect(consumeRpc).not.toHaveBeenCalled();
      expect(findCandidates).not.toHaveBeenCalled();
    }
  });

  it("rejects an unsupported translation before spending anything", async () => {
    const { deps, consumeRpc, findCandidates } = setup();
    const response = await search(deps, QUERY, {}, "NIV");
    expect(response.errorMessage).toBe(MESSAGES.translation);
    expect(consumeRpc).not.toHaveBeenCalled();
    expect(findCandidates).not.toHaveBeenCalled();
  });

  it("maps the legacy KJV code to KJAV", async () => {
    const { deps, resolveAndRank } = setup();
    await search(deps, QUERY, {}, "KJV");
    expect(resolveAndRank).toHaveBeenCalledWith(QUERY, "KJAV", expect.any(Array));
  });
});

describe("happy path", () => {
  it("consumes quota, calls the provider once, verifies with the Bible source, and returns the contract shape", async () => {
    const { deps, findCandidates, consumeRpc, resolveAndRank } = setup();
    const response = await search(deps);
    expect(response).toEqual({ results: [result], failed: false, source: "ai", aiStatus: "used" });
    expect(consumeRpc).toHaveBeenCalledTimes(1);
    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(findCandidates).toHaveBeenCalledWith({ query: QUERY, maxCandidates: 12 });
    expect(resolveAndRank).toHaveBeenCalledWith(QUERY, "KJAV", [
      { book: "1 Corinthians", chapter: 13, verse: 4 },
    ]);
  });

  it("charges a guest by a salted hash, never by the address, and uses guest limits", async () => {
    const { deps, consumeRpc } = setup();
    await search(deps);
    const args = consumeRpc.mock.calls[0]![0] as Record<string, unknown>;
    expect(args["p_subject"]).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(JSON.stringify(args)).not.toContain(SOCKET_IP);
    expect(args).toMatchObject({ p_minute_limit: 3, p_day_limit: 15 });
  });

  it("charges a signed-in user by their verified id and uses the user limits", async () => {
    const verifyToken = vi.fn(async () => ({ sub: USER_ID, role: "authenticated" }));
    const { deps, consumeRpc } = setup({ verifyToken });
    await search(deps, QUERY, { authorization: "Bearer aaaa.bbbb.cccc" });
    expect(consumeRpc.mock.calls[0]![0]).toMatchObject({
      p_subject: `user:${USER_ID}`,
      p_minute_limit: 6,
      p_day_limit: 60,
    });
  });

  it("falls back to guest limits when the token is invalid", async () => {
    const { deps, consumeRpc } = setup({ verifyToken: vi.fn(async () => null) });
    await search(deps, QUERY, { authorization: "Bearer aaaa.bbbb.cccc" });
    expect(String((consumeRpc.mock.calls[0]![0] as { p_subject: string }).p_subject)).toMatch(
      /^ip:/,
    );
  });

  it("logs usage numbers and outcomes only: no query, no caller, no secrets", async () => {
    const { deps, log } = setup();
    await search(deps, "my private description of a verse");
    const text = JSON.stringify(log.mock.calls);
    expect(text).toContain("inputTokens");
    expect(text).not.toContain("private description");
    expect(text).not.toContain(SOCKET_IP);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(SALT);
    expect(text).not.toContain(USER_ID);
  });
});

describe("quota enforcement happens before any paid request", () => {
  it("blocks a per-minute denial and tells the user how long to wait", async () => {
    const { deps, findCandidates, resolveAndRank } = setup({
      consumeRpc: vi.fn(async () => denied("minute", 12)),
    });
    const response = await search(deps);
    expect(response).toEqual({
      results: [],
      failed: true,
      errorMessage: retryMessage(12),
      aiStatus: "limit",
    });
    expect(response.errorMessage).toContain("12 seconds");
    expect(findCandidates).not.toHaveBeenCalled();
    expect(resolveAndRank).not.toHaveBeenCalled();
  });

  it("uses a minute for long waits", () => {
    expect(retryMessage(75)).toContain("a minute");
    expect(retryMessage(0.2)).toContain("1 seconds");
  });

  it("tells guests to sign in when their daily allowance is used, and signed-in users to wait", async () => {
    const guest = setup({ consumeRpc: vi.fn(async () => denied("day")) });
    expect((await search(guest.deps)).errorMessage).toBe(MESSAGES.guestDaily);

    const signedIn = setup({
      consumeRpc: vi.fn(async () => denied("day")),
      verifyToken: vi.fn(async () => ({ sub: USER_ID, role: "authenticated" })),
    });
    expect(
      (await search(signedIn.deps, QUERY, { authorization: "Bearer aaaa.bbbb.cccc" })).errorMessage,
    ).toBe(MESSAGES.userDaily);
    expect(guest.findCandidates).not.toHaveBeenCalled();
    expect(signedIn.findCandidates).not.toHaveBeenCalled();
  });

  it("gives no detail when a global cap is hit", async () => {
    for (const reason of ["global_day", "global_month"]) {
      const { deps, findCandidates } = setup({ consumeRpc: vi.fn(async () => denied(reason)) });
      expect((await search(deps)).errorMessage).toBe(MESSAGES.unavailable);
      expect(findCandidates).not.toHaveBeenCalled();
    }
  });

  it("FAILS CLOSED: no paid request when quota cannot be checked", async () => {
    const broken: Array<SearchServiceDeps["consumeRpc"]> = [
      vi.fn(async () => ({ data: null, error: { message: "db down" } })),
      vi.fn(async () => {
        throw new Error("network");
      }),
      vi.fn(async () => ({ data: [], error: null })),
      vi.fn(async () => ({ data: [{ allowed: "yes" }], error: null })),
      vi.fn(async () => ({ data: undefined, error: null })),
    ];
    for (const consumeRpc of broken) {
      const { deps, findCandidates, resolveAndRank } = setup({ consumeRpc });
      const response = await search(deps);
      expect(response).toEqual({
        results: [],
        failed: true,
        errorMessage: MESSAGES.unavailable,
        aiStatus: "unavailable",
      });
      expect(findCandidates).not.toHaveBeenCalled();
      expect(resolveAndRank).not.toHaveBeenCalled();
    }
  });

  it("fails closed when the caller cannot be identified (hashing fails)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps, findCandidates, consumeRpc } = setup({
      env: { OPENAI_API_KEY: API_KEY, RATE_LIMIT_SALT: SALT },
      verifyToken: vi.fn(async () => {
        throw new Error("x");
      }),
    });
    const spy = vi
      .spyOn(globalThis.crypto.subtle, "importKey")
      .mockRejectedValue(new Error("no crypto"));
    const response = await search(deps);
    spy.mockRestore();
    expect(response.errorMessage).toBe(MESSAGES.unavailable);
    expect(findCandidates).not.toHaveBeenCalled();
    expect(consumeRpc).not.toHaveBeenCalled();
  });
});

describe("the cache cannot be used to dodge the limits", () => {
  it("still consumes quota on a cache hit, but makes no second provider call", async () => {
    const { deps, findCandidates, consumeRpc, resolveAndRank } = setup();
    const first = await search(deps);
    const second = await search(deps);
    expect(second).toEqual(first);
    expect(consumeRpc).toHaveBeenCalledTimes(2);
    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(resolveAndRank).toHaveBeenCalledTimes(1);
  });

  it("denies a repeated query once the limit is reached, even though the answer is cached", async () => {
    const rpc = vi
      .fn<SearchServiceDeps["consumeRpc"]>()
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(denied("minute", 20));
    const { deps, findCandidates } = setup({ consumeRpc: rpc });
    expect((await search(deps)).failed).toBe(false);
    const blocked = await search(deps);
    expect(blocked.failed).toBe(true);
    expect(blocked.results).toEqual([]);
    expect(findCandidates).toHaveBeenCalledTimes(1);
  });

  it("treats differently-spaced or cased copies of a query as one cache entry", async () => {
    const { deps, findCandidates } = setup();
    await search(deps, "Love is patient");
    await search(deps, "  love   IS patient ");
    expect(findCandidates).toHaveBeenCalledTimes(1);
  });

  it("keeps separate entries per translation", async () => {
    const { deps, findCandidates } = setup();
    await search(deps, QUERY, {}, "KJAV");
    await search(deps, QUERY, {}, "BSB");
    expect(findCandidates).toHaveBeenCalledTimes(2);
  });

  it("never caches failures", async () => {
    let calls = 0;
    const { deps, findCandidates } = setup({}, async () => {
      calls += 1;
      if (calls === 1) throw new AiProviderError("unavailable", 503);
      return { candidates: [{ book: "John", chapter: 3, verse: 16 }] };
    });
    expect((await search(deps)).failed).toBe(true);
    expect((await search(deps)).failed).toBe(false);
    expect(findCandidates).toHaveBeenCalledTimes(2);
  });
});

describe("forwarding headers cannot choose the rate-limit bucket", () => {
  async function subjectFor(headers: Record<string, string>, onVercel: boolean) {
    const { deps, consumeRpc } = setup({ onVercel });
    await search(deps, QUERY, headers);
    return (consumeRpc.mock.calls[0]![0] as { p_subject: string }).p_subject;
  }

  it("off Vercel, spoofed x-forwarded-for, x-real-ip and cf-connecting-ip do not change the subject", async () => {
    const plain = await subjectFor({}, false);
    const spoofed = await subjectFor(
      { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8", "cf-connecting-ip": "9.9.9.9" },
      false,
    );
    expect(spoofed).toBe(plain);
  });

  it("on Vercel, the platform-provided address is used, and cf-connecting-ip still is not", async () => {
    const a = await subjectFor({ "x-vercel-forwarded-for": "198.51.100.1" }, true);
    const b = await subjectFor({ "x-vercel-forwarded-for": "198.51.100.2" }, true);
    const c = await subjectFor(
      { "x-vercel-forwarded-for": "198.51.100.1", "cf-connecting-ip": "9.9.9.9" },
      true,
    );
    expect(a).not.toBe(b);
    expect(c).toBe(a);
  });
});

describe("provider failures", () => {
  const cases: Array<[string, AiProviderError, string, string]> = [
    ["unavailable", new AiProviderError("unavailable", 503), MESSAGES.unavailable, "unavailable"],
    [
      "rate limited upstream",
      new AiProviderError("unavailable", 429),
      MESSAGES.unavailable,
      "unavailable",
    ],
    ["invalid output", new AiProviderError("invalid_output"), MESSAGES.unavailable, "unavailable"],
    ["bad credentials", new AiProviderError("not_configured", 401), MESSAGES.notConfigured, "off"],
  ];

  for (const [name, error, message, aiStatus] of cases) {
    it(`shows a fixed message for: ${name}`, async () => {
      const { deps, resolveAndRank } = setup({}, async () => {
        throw error;
      });
      const response = await search(deps);
      expect(response).toEqual({ results: [], failed: true, errorMessage: message, aiStatus });
      expect(resolveAndRank).not.toHaveBeenCalled();
    });
  }

  it("treats a refusal as 'nothing found', not as a failure", async () => {
    const { deps } = setup({}, async () => {
      throw new AiProviderError("refused");
    });
    expect(await search(deps)).toEqual({
      results: [],
      failed: false,
      source: "ai",
      aiStatus: "used",
    });
  });

  it("never lets a raw provider or database error text reach the browser", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leaky = new Error(`401 Incorrect API key provided: ${API_KEY}; salt ${SALT}`);
    const { deps } = setup({}, async () => {
      throw leaky;
    });
    const response = await search(deps);
    const text = JSON.stringify(response);
    expect(response.failed).toBe(true);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(SALT);
    expect(text).not.toContain("Incorrect API key");
  });

  it("returns a safe failure, and logs only the error type, if verification itself blows up", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { deps } = setup({
      resolveAndRank: vi.fn(async () => {
        throw new Error(`secret detail ${API_KEY}`);
      }),
    });
    const response = await search(deps);
    expect(response).toEqual({
      results: [],
      failed: true,
      errorMessage: MESSAGES.unavailable,
      aiStatus: "unavailable",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(API_KEY);
  });

  it("makes exactly one provider attempt per search (no retry loop)", async () => {
    const { deps, findCandidates } = setup({}, async () => {
      throw new AiProviderError("unavailable", 429);
    });
    await search(deps);
    expect(findCandidates).toHaveBeenCalledTimes(1);
  });

  it("does not leak secrets anywhere in a successful response", async () => {
    const { deps } = setup();
    const text = JSON.stringify(await search(deps));
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(SALT);
  });
});

describe("diagnostic log lines", () => {
  const TOKEN = "aaaa.bbbb.cccc";

  it("record the edition and whether a token was sent, never the token, the query or the caller", async () => {
    const { deps, log } = setup({
      verifyToken: vi.fn(async () => ({ sub: USER_ID, role: "authenticated" })),
    });
    await search(
      deps,
      "my private description of a verse",
      { authorization: `Bearer ${TOKEN}` },
      "BSB",
    );
    const entries = log.mock.calls.map((call) => call[0]);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toMatchObject({ translation: "BSB", tokenPresent: true, subjectKind: "user" });
    }
    const text = JSON.stringify(entries);
    for (const forbidden of [TOKEN, "private description", USER_ID, SOCKET_IP, API_KEY, SALT]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("show tokenPresent=false for a guest and still identify a denial", async () => {
    const { deps, log } = setup({ consumeRpc: vi.fn(async () => denied("global_day")) });
    await search(deps);
    expect(log.mock.calls[0]![0]).toMatchObject({
      outcome: "denied_global_day",
      subjectKind: "guest",
      tokenPresent: false,
      translation: "KJAV",
    });
  });

  it("tell a guest with an invalid token apart from one who sent none", async () => {
    const { deps, log } = setup({
      verifyToken: vi.fn(async () => null),
      consumeRpc: vi.fn(async () => denied("day")),
    });
    await search(deps, QUERY, { authorization: `Bearer ${TOKEN}` });
    expect(log.mock.calls[0]![0]).toMatchObject({ subjectKind: "guest", tokenPresent: true });
  });
});
