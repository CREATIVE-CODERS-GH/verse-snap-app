import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createYouVersionLimiter } from "./youversion-limits";
import { createYouVersionProvider } from "./youversion-provider";
import type { YouVersionChapterResult } from "./youversion-protocol";

describe("YouVersion rate limiter", () => {
  it("lets normal chapter navigation through and blocks a flood from one client", () => {
    let t = 0;
    const limiter = createYouVersionLimiter({
      perClient: 5,
      perClientWindowMs: 60_000,
      now: () => t,
    });
    for (let i = 0; i < 5; i += 1) expect(limiter.checkClient("a")).toEqual({ ok: true });
    expect(limiter.checkClient("a")).toMatchObject({ ok: false, scope: "client" });
    expect(limiter.checkClient("b")).toEqual({ ok: true }); // another reader is unaffected
    t = 60_001; // the window slides
    expect(limiter.checkClient("a")).toEqual({ ok: true });
  });

  it("tells the caller how long to wait", () => {
    let t = 1_000;
    const limiter = createYouVersionLimiter({
      perClient: 1,
      perClientWindowMs: 10_000,
      now: () => t,
    });
    limiter.checkClient("a");
    t = 4_000;
    expect(limiter.checkClient("a")).toEqual({ ok: false, scope: "client", retryAfterSeconds: 7 });
  });

  it("caps upstream calls globally", () => {
    let t = 0;
    const limiter = createYouVersionLimiter({ global: 3, globalWindowMs: 60_000, now: () => t });
    for (let i = 0; i < 3; i += 1) expect(limiter.checkUpstream().ok).toBe(true);
    expect(limiter.checkUpstream()).toMatchObject({ ok: false, scope: "global" });
    t = 60_001;
    expect(limiter.checkUpstream().ok).toBe(true);
  });

  it("stops sending upstream after a 429, honours Retry-After within a bound, then resumes", () => {
    let t = 0;
    const limiter = createYouVersionLimiter({ maxCooldownSeconds: 120, now: () => t });
    limiter.coolDown("10");
    expect(limiter.checkUpstream()).toMatchObject({
      ok: false,
      scope: "cooldown",
      retryAfterSeconds: 10,
    });
    t = 10_001;
    expect(limiter.checkUpstream().ok).toBe(true);
    limiter.coolDown("99999");
    t += 119_000;
    expect(limiter.checkUpstream().ok).toBe(false); // bounded to 120 s, not 99999
    t += 2_000;
    expect(limiter.checkUpstream().ok).toBe(true);
    limiter.coolDown(null); // missing header: a default pause
    expect(limiter.checkUpstream().ok).toBe(false);
  });

  it("remembers a bounded number of clients", () => {
    const limiter = createYouVersionLimiter({ perClient: 1, maxClients: 3 });
    for (const id of ["a", "b", "c", "d"]) limiter.checkClient(id);
    // "a" was evicted, so it gets a fresh allowance instead of memory growing without bound.
    expect(limiter.checkClient("a")).toEqual({ ok: true });
    expect(limiter.checkClient("d")).toMatchObject({ ok: false });
  });
});

describe("rate limiting inside the server client", () => {
  async function loadServer() {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    return import("./youversion.server");
  }
  const page = () =>
    new Response(
      JSON.stringify({ content: '<div class="p"><span class="yv-v" v="1"></span>One</div>' }),
      { status: 200 },
    );
  const env = { YOUVERSION_APP_KEY: "k" };
  const request = (chapter: number) => ({ translation: "AMP", bookId: "john", chapter });
  afterEach(() => vi.unstubAllEnvs());

  it("answers a flood with a friendly message, without calling YouVersion for the blocked ones", async () => {
    const { getChapterFromYouVersion } = await loadServer();
    const limiter = createYouVersionLimiter({ perClient: 2 });
    const fetchImpl = vi.fn(async () => page());
    const client = { headers: { get: () => null }, socketIp: "203.0.113.5" };
    const results = [];
    for (const chapter of [1, 2, 3]) {
      results.push(
        await getChapterFromYouVersion(request(chapter), { env, fetchImpl, limiter, client }),
      );
    }
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: true });
    expect(results[2]).toMatchObject({
      ok: false,
      kind: "provider",
      message: expect.stringMatching(/moving quickly/i),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("buckets clients by the platform-vouched address, not by a spoofable header", async () => {
    const { getChapterFromYouVersion } = await loadServer();
    const limiter = createYouVersionLimiter({ perClient: 1 });
    const fetchImpl = vi.fn(async () => page());
    // Off Vercel, x-forwarded-for is ignored: both calls share the socket address's allowance.
    const spoof = (value: string) => ({
      headers: { get: (name: string) => (name === "x-forwarded-for" ? value : null) },
      socketIp: "203.0.113.5",
    });
    await getChapterFromYouVersion(request(1), {
      env,
      fetchImpl,
      limiter,
      client: spoof("198.51.100.1"),
    });
    const second = await getChapterFromYouVersion(request(2), {
      env,
      fetchImpl,
      limiter,
      client: spoof("198.51.100.2"),
    });
    expect(second).toMatchObject({ ok: false });
  });

  it("pauses all upstream calls after YouVersion answers 429, and tells the user kindly", async () => {
    const { getChapterFromYouVersion } = await loadServer();
    const limiter = createYouVersionLimiter({});
    const fetchImpl = vi.fn(
      async () =>
        new Response("Rate limit exceeded.", { status: 429, headers: { "retry-after": "20" } }),
    );
    const first = await getChapterFromYouVersion(request(1), { env, fetchImpl, limiter });
    expect(first).toMatchObject({
      ok: false,
      kind: "provider",
      message: expect.stringMatching(/busy/i),
    });
    const second = await getChapterFromYouVersion(request(2), { env, fetchImpl, limiter });
    expect(second).toMatchObject({ ok: false, message: expect.stringMatching(/busy/i) });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the second never reached YouVersion
    expect(JSON.stringify([first, second])).not.toMatch(/Rate limit exceeded/);
  });

  it("applies the global ceiling", async () => {
    const { getChapterFromYouVersion } = await loadServer();
    const limiter = createYouVersionLimiter({ global: 1 });
    const fetchImpl = vi.fn(async () => page());
    await getChapterFromYouVersion(request(1), { env, fetchImpl, limiter });
    const next = await getChapterFromYouVersion(request(2), { env, fetchImpl, limiter });
    expect(next).toMatchObject({ ok: false, message: expect.stringMatching(/busy/i) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("bridged verses and no chapter retention", () => {
  const at = (verse: number) => ({ bookId: "john", bookName: "John", chapter: 3, verse });
  const ref = { bookId: "john", bookName: "John", chapter: 3 };

  it("resolves a bridged verse from either of its numbers and walks past it", async () => {
    const provider = createYouVersionProvider(async () => ({
      ok: true as const,
      verses: [
        { verse: 2, text: "two" },
        { verse: 3, through: 4, text: "three and four" },
        { verse: 5, text: "five" },
      ],
    }));
    expect((await provider.getVerse(at(4), "NIV"))?.text).toBe("three and four");
    expect((await provider.getVerse(at(3), "NIV"))?.through).toBe(4);
    expect((await provider.getNeighbour(at(4), 1, "NIV"))?.verse).toBe(5);
    expect((await provider.getNeighbour(at(4), -1, "NIV"))?.verse).toBe(2);
    expect(await provider.getVerse(at(9), "NIV")).toBeNull();
  });

  it("shares one request between simultaneous asks, and retains nothing once it settles", async () => {
    const load = vi.fn(async (): Promise<YouVersionChapterResult> => ({
      ok: true,
      verses: [
        { verse: 1, text: "a" },
        { verse: 2, text: "b" },
      ],
    }));
    const provider = createYouVersionProvider(load);
    await Promise.all([
      provider.getVerse(at(1), "AMP"),
      provider.getVerse(at(2), "AMP"),
      provider.getNeighbour(at(1), 1, "AMP"),
    ]);
    expect(load).toHaveBeenCalledTimes(1); // simultaneous: one call
    await provider.getVerse(at(1), "AMP");
    expect(load).toHaveBeenCalledTimes(2); // later: asked again, nothing was kept
    await provider.getVerse(at(1), "NIV"); // another edition is a different chapter
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("asks again after a failure too", async () => {
    let failing = true;
    const flaky = vi.fn(async (): Promise<YouVersionChapterResult> =>
      failing
        ? { ok: false, kind: "provider", message: "no" }
        : { ok: true, verses: [{ verse: 1, text: "a" }] },
    );
    const provider = createYouVersionProvider(flaky);
    await expect(provider.getChapter(ref, "NIV")).rejects.toBeDefined();
    failing = false;
    expect(await provider.getChapter(ref, "NIV")).not.toBeNull();
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("has no memo, timer or store: nothing can retain licensed text", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/bible/youversion-provider.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "") // comments may name the stores they avoid
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|MEMO|Date\.now/);
    expect(source).toMatch(/inFlight\.delete/); // the in-flight entry is dropped as soon as it settles
  });
});

describe("licensed editions: export, citation and copy rules", () => {
  async function load() {
    vi.resetModules();
    vi.stubEnv("VITE_YOUVERSION_TRANSLATIONS", "true");
    const translations = await import("./translations");
    const format = await import("../reflection-format");
    const card = await import("../share-verse-card");
    return { ...translations, ...format, ...card };
  }
  afterEach(() => vi.unstubAllEnvs());
  const verse = {
    translation: "NIV",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    text: "TEXT",
    reference: "John 3:16",
  };

  it("allows image export for every edition except NIV", async () => {
    const { canExportImage } = await load();
    for (const code of ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV", "AMP"]) {
      expect(canExportImage(code)).toBe(true);
    }
    expect(canExportImage("NIV")).toBe(false);
  });

  it("refuses to render a NIV image at all, so no entry point can bypass the rule", async () => {
    await load();
    const { createVerseImageBlob } = await import("../share-verse-image");
    const { renderVerseCard } = await import("../verse-card-render");
    await expect(createVerseImageBlob(verse)).rejects.toThrow(/not available/i);
    await expect(
      renderVerseCard(verse, { theme: "pine", format: "square", type: "serif", scale: 1 }),
    ).rejects.toThrow(/not available/i);
  });

  it("puts the publisher notice on copied and shared text, once per edition", async () => {
    const { verseShareText, appendPublisherNotices } = await load();
    expect(verseShareText(verse)).toContain("Biblica, Inc.");
    expect(verseShareText({ ...verse, translation: "AMP" })).toContain("Lockman");
    expect(verseShareText({ ...verse, translation: "BSB" })).toBe("John 3:16\nBSB\n\nTEXT");
    const joined = appendPublisherNotices("x", ["NIV", "NIV", "KJAV", "AMP"]);
    expect(joined.split("Used by Permission of Biblica")).toHaveLength(2);
    expect(joined).toContain("Lockman");
    expect(appendPublisherNotices("x", ["KJAV"])).toBe("x");
  });

  it("inserts only the reference when a note quotes a licensed verse, and the full quote for others", async () => {
    const { scriptureCitation } = await load();
    expect(scriptureCitation("LICENSED TEXT", "John 3:16", "NIV")).toBe("John 3:16 (NIV)");
    expect(scriptureCitation("LICENSED TEXT", "John 3:16", "AMP")).not.toContain("LICENSED TEXT");
    expect(scriptureCitation(" free ", "John 3:16", "BSB")).toBe("“free” — John 3:16 (BSB)");
  });
});
