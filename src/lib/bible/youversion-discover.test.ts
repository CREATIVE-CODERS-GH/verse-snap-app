import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePassageId } from "./youversion-discover-refs";
import { discoverRequestSchema } from "./youversion-discover-protocol";

const KEY = "test-key-never-returned-123456";
const root = process.cwd();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("passage ids", () => {
  it("parses a verse, a range and numbered books", () => {
    expect(parsePassageId("JHN.3.16")).toMatchObject({
      bookId: "john",
      bookName: "John",
      chapter: 3,
      verse: 16,
      label: "John 3:16",
    });
    expect(parsePassageId("PHP.4.6-7")).toMatchObject({
      verse: 6,
      endVerse: 7,
      label: "Philippians 4:6–7",
    });
    expect(parsePassageId("1CO.13.4-7")?.bookName).toBe("1 Corinthians");
    expect(parsePassageId("3JN.1.2")?.chapter).toBe(1);
  });

  it("drops what Verse Snap cannot open", () => {
    expect(parsePassageId("JHN.3")).toBeNull(); // chapter only
    expect(parsePassageId("XXX.1.1")).toBeNull(); // unknown book
    expect(parsePassageId("JHN.99.1")).toBeNull(); // chapter past the end of the book
    expect(parsePassageId("PHP.4.7-6")).toBeNull(); // range runs backwards
    expect(parsePassageId("john.3.16")).toBeNull();
    expect(parsePassageId("JHN.3.16; DROP")).toBeNull();
  });
});

describe("request validation", () => {
  it("accepts the operations and rejects malformed input", () => {
    const parse = (value: unknown) => discoverRequestSchema.safeParse(value).success;
    expect(parse({ op: "trending" })).toBe(true);
    expect(parse({ op: "suggest", query: "lov" })).toBe(true);
    expect(parse({ op: "suggest", query: "   " })).toBe(false);
    expect(parse({ op: "suggest", query: "x".repeat(101) })).toBe(false);
    expect(parse({ op: "verses", translation: "NIV", query: "love", pageToken: "abc" })).toBe(true);
    expect(parse({ op: "passages", translation: "NIV", ids: ["JHN.3.16"] })).toBe(true);
    expect(parse({ op: "passages", translation: "NIV", ids: ["../../keys"] })).toBe(false);
    expect(
      parse({
        op: "passages",
        translation: "NIV",
        ids: Array.from({ length: 11 }, () => "JHN.3.16"),
      }),
    ).toBe(false);
    expect(parse({ op: "images", translation: "AMP", ids: ["abc"] })).toBe(true);
    // Real image ids are about 540 characters long (found with the live API).
    expect(parse({ op: "images", translation: "AMP", ids: ["a1B2-c3_D4.".repeat(48)] })).toBe(true);
    expect(parse({ op: "images", translation: "AMP", ids: ["a".repeat(1501)] })).toBe(false);
    expect(parse({ op: "images", translation: "AMP", ids: ["../../v1/bibles"] })).toBe(false);
    expect(parse({ op: "images", translation: "AMP", ids: ["abc def"] })).toBe(false);
    expect(parse({ op: "other" })).toBe(false);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function limiter(overrides: Record<string, unknown> = {}) {
  return {
    checkClient: vi.fn(() => ({ ok: true as const })),
    checkUpstream: vi.fn(() => ({ ok: true as const })),
    coolDown: vi.fn(),
    cooldownRemaining: vi.fn(() => 0),
    ...overrides,
  };
}

async function load(options: { translations?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", options.translations === false ? "false" : "true");
  vi.stubEnv("VITE_YOUVERSION_DISCOVER", "true");
  return import("./youversion-discover.server");
}

function setup(responder: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, headers: (init.headers ?? {}) as Record<string, string> });
    return responder(parsed, init);
  });
  return { fetchImpl, calls };
}

const base = { env: { YOUVERSION_APP_KEY: KEY }, enabled: true };

describe("Discover server", () => {
  it("is off without the flag or the key, and never calls YouVersion", async () => {
    const { runDiscover } = await load();
    const { fetchImpl } = setup(() => json({}));
    const off = await runDiscover(
      { op: "trending" },
      { ...base, enabled: false, fetchImpl, limiter: limiter() },
    );
    expect(off).toMatchObject({ ok: false, kind: "disabled" });
    const noKey = await runDiscover(
      { op: "trending" },
      { env: {}, enabled: true, fetchImpl, limiter: limiter() },
    );
    expect(noKey).toMatchObject({ ok: false, kind: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for trending queries, sending the key as a header and English as the language", async () => {
    const { runDiscover } = await load();
    const { fetchImpl, calls } = setup(() =>
      json({ data: [{ text: "renew your mind", source: "trending" }, { text: "  " }] }),
    );
    const result = await runDiscover(
      { op: "trending" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toEqual({ ok: true, data: { queries: ["renew your mind"] } });
    const call = calls[0]!;
    expect(call.url.origin + call.url.pathname).toBe(
      "https://api.youversion.com/v1/search-queries",
    );
    expect(call.url.searchParams.get("trending")).toBe("true");
    expect(call.url.searchParams.get("language_ranges[]")).toBe("en");
    expect(call.headers["X-YVP-App-Key"]).toBe(KEY);
    expect(call.url.toString()).not.toContain(KEY); // the key is never in the URL
  });

  it("treats 204 as an honest empty list, never invented trends", async () => {
    const { runDiscover } = await load();
    const { fetchImpl } = setup(() => new Response(null, { status: 204 }));
    const result = await runDiscover(
      { op: "trending" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toEqual({ ok: true, data: { queries: [] } });
  });

  it("asks for suggestions with the typed text", async () => {
    const { runDiscover } = await load();
    const { fetchImpl, calls } = setup(() => json({ data: [{ text: "love" }, { text: "love" }] }));
    const result = await runDiscover(
      { op: "suggest", query: "lov" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toEqual({ ok: true, data: { queries: ["love"] } });
    expect(calls[0]!.url.pathname).toBe("/v1/search-queries");
    expect(calls[0]!.url.searchParams.get("query")).toBe("lov");
    expect(calls[0]!.url.searchParams.has("trending")).toBe(false);
  });

  it("gets topics, subtopics, image references and spelling help in one unified call", async () => {
    const { runDiscover } = await load();
    const { fetchImpl, calls } = setup(() =>
      json({
        topics: [{ id: 11, text: "Peace", subtopics: ["calm", "calm", "rest"] }],
        images: [{ id: "img-1", passage_id: "PHP.4.6-7" }],
        did_you_mean: ["peace"],
        search_instead_for: "",
        user_intent: "topical",
      }),
    );
    const result = await runDiscover(
      { op: "overview", translation: "AMP", query: "pece" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toEqual({
      ok: true,
      data: {
        topics: [{ text: "Peace", subtopics: ["calm", "rest"] }],
        imageIds: ["img-1"],
        didYouMean: ["peace"],
        searchInsteadFor: null,
      },
    });
    const url = calls[0]!.url;
    expect(url.pathname).toBe("/v1/search-unified");
    expect(url.searchParams.get("bible_id")).toBe("1588"); // AMP
    expect(url.searchParams.getAll("fields[]")).toEqual(["topics", "images"]);
    expect(url.searchParams.get("language_ranges[]")).toBe("en");
  });

  it("pages verse results with the page token and turns ids into Verse Snap references", async () => {
    const { runDiscover } = await load();
    const { fetchImpl, calls } = setup(() =>
      json({
        verses: [
          { reference: "JHN.3.16" },
          { reference: "JHN.3.16" }, // a repeat
          { reference: "ZZZ.1.1" }, // not a book Verse Snap has
          { reference: "PHP.4.6-7" },
        ],
        next_page_token: "token-2",
        did_you_mean: ["forgiveness"],
        search_instead_for: null,
      }),
    );
    const result = await runDiscover(
      { op: "verses", translation: "NIV", query: "forgivness", pageToken: "token-1" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result.ok && result.data.passages.map((passage) => passage.label)).toEqual([
      "John 3:16",
      "Philippians 4:6–7",
    ]);
    expect(result.ok && result.data.nextPageToken).toBe("token-2");
    expect(result.ok && result.data.didYouMean).toEqual(["forgiveness"]);
    const url = calls[0]!.url;
    expect(url.pathname).toBe("/v1/search-verses");
    expect(url.searchParams.get("bible_id")).toBe("111"); // NIV
    expect(url.searchParams.get("page_token")).toBe("token-1");
    expect(url.searchParams.get("page_size")).toBe("10");
  });

  it("ends paging when there is no next token", async () => {
    const { runDiscover } = await load();
    const { fetchImpl } = setup(() => json({ verses: [], next_page_token: null }));
    const result = await runDiscover(
      { op: "verses", translation: "NIV", query: "zzzz" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toMatchObject({ ok: true, data: { passages: [], nextPageToken: null } });
  });

  it("fetches passage text as plain text, only for the ids asked, and skips an omitted verse", async () => {
    const { runDiscover } = await load();
    const { fetchImpl, calls } = setup((url) =>
      url.pathname.endsWith("MRK.9.44")
        ? json({ detail: "not found" }, 404)
        : json({ content: "  Some\n  verse   text " }),
    );
    const result = await runDiscover(
      { op: "passages", translation: "NIV", ids: ["JHN.3.16", "MRK.9.44"] },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toEqual({ ok: true, data: { texts: { "JHN.3.16": "Some verse text" } } });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe("/v1/bibles/111/passages/JHN.3.16");
    expect(calls[0]!.url.searchParams.get("format")).toBe("text");
    expect(calls[0]!.url.searchParams.get("include_notes")).toBe("false");
  });

  it("resolves image records and shows only trusted, credited images", async () => {
    const { runDiscover, isTrustedImageUrl } = await load();
    const records: Record<string, unknown> = {
      good: {
        id: "good",
        image_url: "https://cdn.youversion.com/a/b.jpg",
        attribution: "© YouVersion",
        passage_id: "MAT.11.28-30",
        aspect_ratio: 0.562,
      },
      evil: {
        id: "evil",
        image_url: "https://evil.example.com/a.jpg",
        attribution: "© X",
      },
      uncredited: {
        id: "uncredited",
        image_url: "https://cdn.youversion.com/c.jpg",
        attribution: "  ",
      },
    };
    const { fetchImpl } = setup((url) => {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return records[id] ? json(records[id]) : json({ detail: "Image not found" }, 404);
    });
    const result = await runDiscover(
      { op: "images", translation: "AMP", ids: ["good", "evil", "uncredited", "gone"] },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result.ok && result.data.images).toHaveLength(1);
    expect(result.ok && result.data.images[0]).toMatchObject({
      id: "good",
      url: "https://cdn.youversion.com/a/b.jpg",
      attribution: "© YouVersion",
      aspectRatio: 0.562,
    });
    expect(result.ok && result.data.images[0]?.passage?.label).toBe("Matthew 11:28–30");
    expect(isTrustedImageUrl("http://cdn.youversion.com/a.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://youversion.com.evil.io/a.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://cdn.youversion.com/a.jpg")).toBe(true);
  });

  it("never sends a translation that is not a YouVersion edition", async () => {
    const { runDiscover } = await load();
    const { fetchImpl } = setup(() => json({}));
    const result = await runDiscover(
      { op: "verses", translation: "KJAV", query: "love" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toMatchObject({ ok: false, kind: "denied" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is off for the editions when the YouVersion flag is off", async () => {
    const { runDiscover } = await load({ translations: false });
    const { fetchImpl } = setup(() => json({}));
    const result = await runDiscover(
      { op: "verses", translation: "NIV", query: "love" },
      { ...base, fetchImpl, limiter: limiter() },
    );
    expect(result).toMatchObject({ ok: false, kind: "denied" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe("failures are data with fixed wording and never carry the key or API text", () => {
    const cases: [string, () => Response | Promise<Response>, string][] = [
      ["401 unknown key", () => json({ detail: `bad ${KEY}` }, 401), "denied"],
      [
        "404 Bible not accessible",
        () => json({ detail: "Bible version 111 not found" }, 404),
        "denied",
      ],
      ["400 bad parameter", () => json({ detail: "x" }, 400), "unavailable"],
      ["422 malformed", () => json({ detail: [] }, 422), "unavailable"],
      ["502 upstream", () => json({ detail: "boom" }, 502), "unavailable"],
      ["unreadable body", () => new Response("<html>", { status: 200 }), "unavailable"],
      [
        "timeout",
        () => {
          throw Object.assign(new Error("t"), { name: "TimeoutError" });
        },
        "timeout",
      ],
      [
        "network",
        () => {
          throw new TypeError(`fetch failed ${KEY}`);
        },
        "network",
      ],
    ];
    for (const [label, responder, kind] of cases) {
      it(label, async () => {
        const { runDiscover } = await load();
        const { fetchImpl } = setup(responder);
        const result = await runDiscover(
          { op: "verses", translation: "NIV", query: "love" },
          { ...base, fetchImpl, limiter: limiter() },
        );
        expect(result).toMatchObject({ ok: false, kind });
        expect(JSON.stringify(result)).not.toContain(KEY);
        expect(JSON.stringify(result)).not.toMatch(/Bible version|boom|fetch failed/);
      });
    }

    it("429 pauses all upstream calls and reports a limit", async () => {
      const { runDiscover } = await load();
      const { fetchImpl } = setup(
        () => new Response("{}", { status: 429, headers: { "retry-after": "17" } }),
      );
      const guard = limiter();
      const result = await runDiscover(
        { op: "suggest", query: "lo" },
        { ...base, fetchImpl, limiter: limiter(), shared: guard },
      );
      // The wait shown to the person is YouVersion's own Retry-After, not a made-up number.
      expect(result).toMatchObject({ ok: false, kind: "limit", retryAfterSeconds: 17 });
      expect(guard.coolDown).toHaveBeenCalledWith("17");
    });

    it("reports a long Retry-After in full, up to five minutes (YouVersion has sent 300)", async () => {
      const { runDiscover } = await load();
      const { fetchImpl } = setup(
        () => new Response("{}", { status: 429, headers: { "retry-after": "300" } }),
      );
      const result = await runDiscover(
        { op: "trending" },
        { ...base, fetchImpl, limiter: limiter() },
      );
      expect(result).toMatchObject({ ok: false, kind: "limit", retryAfterSeconds: 300 });
      const { describeDiscoverError, DiscoverError } = await import("./youversion-discover");
      const described = describeDiscoverError(new DiscoverError("limit", "x", 300), {
        translation: "NIV",
        online: true,
      });
      expect(described.message).toContain("5 minutes");
    });

    it("the per-client limit stops a request before YouVersion is called", async () => {
      const { runDiscover } = await load();
      const { fetchImpl } = setup(() => json({}));
      const result = await runDiscover(
        { op: "suggest", query: "lo" },
        {
          ...base,
          fetchImpl,
          limiter: limiter({
            checkClient: () => ({ ok: false, scope: "client", retryAfterSeconds: 9 }),
          }),
        },
      );
      expect(result).toMatchObject({ ok: false, kind: "limit", retryAfterSeconds: 9 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("the upstream limit stops the call and reports when to retry", async () => {
      const { runDiscover } = await load();
      const { fetchImpl } = setup(() => json({}));
      const result = await runDiscover(
        { op: "trending" },
        {
          ...base,
          fetchImpl,
          limiter: limiter({
            checkUpstream: () => ({ ok: false, scope: "global", retryAfterSeconds: 4 }),
          }),
        },
      );
      expect(result).toMatchObject({ ok: false, kind: "limit", retryAfterSeconds: 4 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});

describe("Discover protects the shared YouVersion quota", () => {
  it("a 429 on Discover cools down the shared limiter, so Bible reading stops sending too", async () => {
    const { runDiscover } = await load();
    const { createYouVersionLimiter } = await import("./youversion-limits");
    const { getChapterFromYouVersion } = await import("./youversion.server");
    const shared = createYouVersionLimiter();
    const discover = setup(
      () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }),
    );
    const first = await runDiscover(
      { op: "suggest", query: "lo" },
      { ...base, fetchImpl: discover.fetchImpl, shared, limiter: limiter() },
    );
    expect(first).toMatchObject({ ok: false, kind: "limit", retryAfterSeconds: 120 });
    expect(shared.cooldownRemaining()).toBeGreaterThan(100);

    // The reader, using the same limiter, does not call YouVersion while it is cooling down.
    const reader = setup(() => json({ content: "<p></p>" }));
    const chapter = await getChapterFromYouVersion(
      { translation: "NIV", bookId: "john", chapter: 3 },
      { env: { YOUVERSION_APP_KEY: KEY }, fetchImpl: reader.fetchImpl, limiter: shared },
    );
    expect(chapter).toMatchObject({ ok: false, kind: "provider" });
    expect(reader.fetchImpl).not.toHaveBeenCalled();
  });

  it("a 429 on the reader stops Discover from sending anything until the Retry-After has passed", async () => {
    const { runDiscover } = await load();
    const { createYouVersionLimiter } = await import("./youversion-limits");
    const { getChapterFromYouVersion } = await import("./youversion.server");
    let now = 1_000_000;
    const shared = createYouVersionLimiter({ now: () => now });
    const reader = setup(
      () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }),
    );
    await getChapterFromYouVersion(
      { translation: "NIV", bookId: "john", chapter: 3 },
      { env: { YOUVERSION_APP_KEY: KEY }, fetchImpl: reader.fetchImpl, limiter: shared },
    );

    const discover = setup(() => json({ data: [{ text: "love" }] }));
    const deps = { ...base, fetchImpl: discover.fetchImpl, shared, limiter: limiter() };
    const blocked = await runDiscover({ op: "trending" }, deps);
    expect(blocked).toMatchObject({ ok: false, kind: "limit" });
    expect(blocked.ok ? 0 : (blocked.retryAfterSeconds ?? 0)).toBeGreaterThan(50);
    expect(discover.fetchImpl).not.toHaveBeenCalled(); // not one request while throttled

    now += 61_000; // the Retry-After has passed
    const after = await runDiscover({ op: "trending" }, deps);
    expect(after.ok).toBe(true);
    expect(discover.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Discover has its own, smaller upstream budget, and the default cool-down honours 300 s", async () => {
    const { discoverLimiter } = await load();
    const { DEFAULT_LIMITS } = await import("./youversion-limits");
    let allowed = 0;
    for (let index = 0; index < 400; index += 1) {
      if (discoverLimiter.checkUpstream().ok) allowed += 1;
    }
    expect(allowed).toBe(150); // below the reader's 240 a minute, so reading keeps headroom
    expect(DEFAULT_LIMITS.global).toBe(240);
    expect(DEFAULT_LIMITS.maxCooldownSeconds).toBe(300);
  });

  it("identical requests in flight at the same moment share one upstream call", async () => {
    const { runDiscover } = await load();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImpl } = setup(async () => {
      await gate;
      return json({ data: [{ text: "love" }] });
    });
    const deps = { ...base, fetchImpl, limiter: limiter(), shared: limiter() };
    const a = runDiscover({ op: "suggest", query: "love" }, deps);
    const b = runDiscover({ op: "suggest", query: "love" }, deps);
    const other = runDiscover({ op: "suggest", query: "hope" }, deps);
    release();
    const results = await Promise.all([a, b, other]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // "love" once (shared), "hope" once
    // Nothing is kept afterwards: a later identical request goes upstream again.
    await runDiscover({ op: "suggest", query: "love" }, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("the test seam for the API address", () => {
  it("is honoured only for loopback http outside production and Vercel", async () => {
    const { resolveYouVersionBase, YOUVERSION_API_BASE } = await import("./youversion-base.server");
    const mock = "http://127.0.0.1:5555";
    expect(resolveYouVersionBase({ YOUVERSION_API_BASE_URL: mock })).toEqual({
      base: mock,
      mockOrigin: mock,
    });
    expect(resolveYouVersionBase({ YOUVERSION_API_BASE_URL: "http://localhost:9/x" }).base).toBe(
      "http://localhost:9",
    );
    const real = { base: YOUVERSION_API_BASE, mockOrigin: null };
    expect(resolveYouVersionBase({})).toEqual(real);
    expect(
      resolveYouVersionBase({ YOUVERSION_API_BASE_URL: mock, NODE_ENV: "production" }),
    ).toEqual(real);
    expect(resolveYouVersionBase({ YOUVERSION_API_BASE_URL: mock, VERCEL: "1" })).toEqual(real);
    // Anything that is not loopback http can never redirect the app key.
    for (const wanted of [
      "https://evil.example.com",
      "http://evil.example.com",
      "http://127.0.0.1.evil.com",
      "https://127.0.0.1:5555",
      "not a url",
    ]) {
      expect(resolveYouVersionBase({ YOUVERSION_API_BASE_URL: wanted }), wanted).toEqual(real);
    }
  });

  it("the mock's image host is trusted only while the override is active", async () => {
    const { isTrustedImageUrl } = await load();
    const mockImage = "http://127.0.0.1:5555/cdn/1.png";
    expect(isTrustedImageUrl(mockImage)).toBe(false);
    expect(isTrustedImageUrl(mockImage, "http://127.0.0.1:5555")).toBe(true);
    expect(isTrustedImageUrl("http://127.0.0.1:6666/x.png", "http://127.0.0.1:5555")).toBe(false);
  });
});

describe("Discover client helpers", () => {
  it("callDiscover returns data, throws typed errors and passes aborts through untouched", async () => {
    const { callDiscover, DiscoverError } = await import("./youversion-discover");
    const ok = vi.fn(async () => ({ ok: true as const, data: { queries: ["a"] } }));
    await expect(callDiscover(ok as never, { op: "trending" })).resolves.toEqual({
      queries: ["a"],
    });

    const denied = vi.fn(async () => ({
      ok: false as const,
      kind: "denied" as const,
      message: "m",
    }));
    await expect(callDiscover(denied as never, { op: "trending" })).rejects.toMatchObject({
      kind: "denied",
    });

    const broken = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(callDiscover(broken as never, { op: "trending" })).rejects.toBeInstanceOf(
      DiscoverError,
    );

    const controller = new AbortController();
    const abort = new DOMException("aborted", "AbortError");
    const aborted = vi.fn(async () => {
      controller.abort();
      throw abort;
    });
    await expect(
      callDiscover(aborted as never, { op: "trending" }, controller.signal),
    ).rejects.toBe(abort);
  });

  it("forwards the abort signal to the server function so a replaced search is cancelled", async () => {
    const { suggestOptions } = await import("./youversion-discover");
    const seen: (AbortSignal | undefined)[] = [];
    const run = vi.fn(async (input: { signal?: AbortSignal }) => {
      seen.push(input.signal);
      return { ok: true as const, data: { queries: [] } };
    });
    const options = suggestOptions(run as never, "lov");
    const controller = new AbortController();
    await (options.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>)({
      signal: controller.signal,
    });
    expect(seen[0]).toBe(controller.signal);
  });

  it("previews only the first 25 results, whatever page they came from", async () => {
    const { canPreview } = await import("./youversion-discover");
    expect(canPreview(0)).toBe(true);
    expect(canPreview(24)).toBe(true);
    expect(canPreview(25)).toBe(false);
    expect(canPreview(29)).toBe(false);
    expect(canPreview(2, 3)).toBe(true);
    expect(canPreview(3, 3)).toBe(false);
  });

  it("uses each query key's own root and translation, so licensed text is dropped when unused", async () => {
    const { previewOptions, overviewOptions, versesInfiniteOptions } =
      await import("./youversion-discover");
    const run = vi.fn();
    expect(previewOptions(run as never, "NIV", "JHN.3.16").queryKey).toEqual([
      "discover-preview",
      "NIV",
      "JHN.3.16",
    ]);
    // Reference lists and topics are not Scripture text.
    expect(overviewOptions(run as never, "NIV", "love").queryKey[0]).toBe("discover");
    expect(versesInfiniteOptions(run as never, "AMP", "love").queryKey[0]).toBe("discover");
  });

  it("describes each failure, including offline, without technical wording", async () => {
    const { describeDiscoverError, DiscoverError } = await import("./youversion-discover");
    const describe = (error: unknown, online = true) =>
      describeDiscoverError(error, { translation: "NIV", online });
    expect(describe(new DiscoverError("network", "x"), false).title).toBe("You're offline");
    expect(describe(new DiscoverError("network", "x")).title).toBe("Connection problem");
    expect(describe(new DiscoverError("timeout", "x")).title).toBe("That took too long");
    expect(describe(new DiscoverError("limit", "x", 12)).message).toContain("12 seconds");
    expect(describe(new DiscoverError("denied", "x")).title).toBe("Not available in NIV");
    expect(describe(new DiscoverError("unavailable", "x")).title).toBe("Search didn't finish");
    expect(describe(new Error("random")).kind).toBe("network");
  });

  it("chooses the Discover edition: URL first, then the reader's own, then NIV; never KJAV", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    const { resolveDiscoverTranslation } = await import("./youversion-discover");
    expect(resolveDiscoverTranslation("AMP", "KJAV")).toBe("AMP");
    expect(resolveDiscoverTranslation(undefined, "AMP")).toBe("AMP");
    expect(resolveDiscoverTranslation(undefined, "KJAV")).toBe("NIV");
    expect(resolveDiscoverTranslation("KJAV", "BSB")).toBe("NIV");
    expect(resolveDiscoverTranslation("<script>", "BSB")).toBe("NIV");
  });

  it("Discover is off unless both flags are set", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    vi.stubEnv("VITE_YOUVERSION_DISCOVER", "false");
    expect((await import("./youversion-discover-schema")).YOUVERSION_DISCOVER_ENABLED).toBe(false);
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "false");
    vi.stubEnv("VITE_YOUVERSION_DISCOVER", "true");
    expect((await import("./youversion-discover-schema")).YOUVERSION_DISCOVER_ENABLED).toBe(false);
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    vi.stubEnv("VITE_YOUVERSION_DISCOVER", "true");
    expect((await import("./youversion-discover-schema")).YOUVERSION_DISCOVER_ENABLED).toBe(true);
  });
});

describe("Discover keeps licensed content off the device and the key off the browser", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const clientFiles = [
    "src/components/discover-search.tsx",
    "src/components/search-mode-switch.tsx",
    "src/lib/bible/youversion-discover.ts",
    "src/lib/bible/youversion-discover-protocol.ts",
    "src/lib/bible/youversion-discover-refs.ts",
    "src/lib/bible/youversion-discover-schema.ts",
    "src/lib/bible/youversion-discover.functions.ts",
    "src/lib/use-debounced-value.ts",
  ];

  it("no browser file names the key or the server module outside a dynamic import", () => {
    for (const file of clientFiles) {
      const text = read(file);
      expect(text, file).not.toMatch(/YOUVERSION_APP_KEY|X-YVP-App-Key|api\.youversion\.com/);
      expect(text, file).not.toMatch(/from\s+["'][^"']*youversion-discover\.server["']/);
    }
    expect(read("src/lib/bible/youversion-discover.functions.ts")).toMatch(
      /await import\("\.\/youversion-discover\.server"\)/,
    );
  });

  it("nothing in Discover writes to localStorage, IndexedDB, Cache Storage or a search index", () => {
    for (const file of [...clientFiles, "src/lib/bible/youversion-discover.server.ts"]) {
      // Comments may name these APIs to say they are NOT used; only code counts.
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(
        /localStorage|sessionStorage|indexedDB|\bcaches\b|createStore|persistQueryClient|serviceWorker/,
      );
    }
  });

  it("the server function is a POST, which the service worker never caches", () => {
    expect(read("src/lib/bible/youversion-discover.functions.ts")).toMatch(/method: "POST"/);
  });

  it("Discover files stay out of the free search, AI search and offline modules", () => {
    const offending = /free-search|ai\/|offline-manager|offline-download|search-index/;
    for (const file of [...clientFiles, "src/lib/bible/youversion-discover.server.ts"]) {
      const imports = read(file)
        .split("\n")
        .filter((line) => /^\s*(import|export)\b.*from\s+["']/.test(line));
      for (const line of imports) {
        if (/client-ip\.server/.test(line)) continue; // the shared client-address helper
        expect(line, file).not.toMatch(offending);
      }
    }
  });

  it("no source file outside src/lib/bible lists Discover files in a shared bundle by accident", () => {
    // The route imports the page; nothing imports the .server module.
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
          if (/youversion-discover\.server/.test(readFileSync(full, "utf8"))) importers.push(full);
        }
      }
    };
    walk(join(root, "src"));
    expect(importers.map((file) => file.replace(/\\/g, "/").split("/src/")[1])).toEqual([
      "lib/bible/youversion-discover.functions.ts",
    ]);
  });
});
