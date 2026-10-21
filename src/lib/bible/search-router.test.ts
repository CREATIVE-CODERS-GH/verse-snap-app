import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "./ai/config.server";
import { EVAL_QUERIES } from "./ai/live/eval-queries";
import { runAiSearch, type SearchServiceDeps } from "./ai/search-service.server";
import type { ReferenceProvider, ScriptureSearchResponse } from "./ai/types";
import {
  ROUTER_THRESHOLDS,
  analyzeQuery,
  routeMessage,
  routeQuery,
  type FreeSearchSignals,
} from "./search-router";

describe("references are routed to the reference path and never offered AI", () => {
  const references = [
    "john 3:16",
    "John 3 16",
    "Jn3:16",
    "1 cor 13 4",
    "psalm 23",
    "psalms 23:1-6",
    "matt 5:3-12",
    "gen 1:1-3",
    "3 john 4",
    "jude 5",
    "james 1 5 6",
    "phillipians 4:13",
    "john 3:16 kjv",
    "1 john 4:8 kjv",
    "psalm 23 to 25",
    "open john 3 16",
    "find romans 8 28",
    "john",
    "ruth",
    "psalm",
    "the book of john",
    "open genesis",
    "go to psalms",
    "read ruth",
    "gospel of john",
    "john three sixteen",
  ];
  for (const query of references) {
    it(query, () => {
      const decision = routeQuery(query);
      expect(decision.route).toBe("reference");
      expect(decision.canTryAi).toBe(false);
      expect(decision.reference).toBeDefined();
      expect(decision.reasons).toEqual(["reference"]);
    });
  }

  it("carries ranges, editions and book-only through to the reference", () => {
    expect(routeQuery("psalms 23:1-6").reference).toMatchObject({
      bookId: "psalms",
      chapter: 23,
      verse: 1,
      endVerse: 6,
    });
    expect(routeQuery("john 3:16 bsb").reference).toMatchObject({
      bookId: "john",
      chapter: 3,
      verse: 16,
      translation: "BSB",
    });
    expect(routeQuery("john 3:16 niv").reference).toMatchObject({ unsupportedTranslation: "NIV" });
    expect(routeQuery("ruth").reference).toMatchObject({
      bookId: "ruth",
      chapter: 1,
      bookOnly: true,
    });
    expect(routeQuery("3 john 4").reference).toMatchObject({
      bookId: "3john",
      chapter: 1,
      verse: 4,
    });
  });
});

describe("ordinary phrases that resemble book names are routed as descriptions", () => {
  const phrases = [
    "mark my words and listen carefully",
    "john the baptist in the wilderness",
    "acts of kindness to strangers",
    "job loss and unemployment",
    "numbers don't lie",
    "what is job",
    "where is acts",
    "find the verse that says love is patient",
    "judges and kings of israel",
  ];
  for (const phrase of phrases) {
    it(phrase, () => {
      const decision = routeQuery(phrase);
      expect(decision.route).not.toBe("reference");
      expect(decision.reference).toBeUndefined();
    });
  }

  it("strips conversational lead-ins from the description", () => {
    expect(routeQuery("find the verse that says love is patient").query).toBe("love is patient");
    expect(routeQuery("what is the verse about courage").query).toContain("courage");
  });
});

describe("queries that never reach AI", () => {
  it("a single word framed as a topic is still enough to search", () => {
    for (const query of [
      "verse about being thankful",
      "a verse on forgiveness",
      "verses for hope",
    ]) {
      expect(routeQuery(query).route, query).toBe("needs_ai");
    }
  });

  it("a single meaningful word is a keyword search: free search yes, Smart Search no", () => {
    for (const query of [
      "love",
      "faith",
      "  hope  ",
      "hello",
      "Melchizedek",
      "Jehovah",
      "sheperd",
      "Selah",
    ]) {
      const decision = routeQuery(query);
      expect(decision.route, query).toBe("keyword");
      expect(decision.canTryAi, query).toBe(false);
      expect(decision.canSearchFree, query).toBe(true);
      expect(decision.query, query).toBe(query.trim());
      expect(routeMessage(decision), query).toBeNull();
    }
  });

  it("real descriptions can use free search too, and Smart Search stays an explicit extra", () => {
    const decision = routeQuery("verse about being thankful");
    expect(decision).toMatchObject({ route: "needs_ai", canTryAi: true, canSearchFree: true });
  });

  it("nothing else reaches free search: references, nonsense, over-long and empty text", () => {
    for (const query of [
      "John 3:16",
      "xqzvwk",
      "qwerty asdf",
      "a loving god ".repeat(20),
      "",
      "   ",
    ]) {
      expect(routeQuery(query).canSearchFree, query).toBe(false);
    }
  });

  it("asks for more when there is nothing meaningful to search", () => {
    for (const query of ["the", "a", "and of", "to be or"]) {
      const decision = routeQuery(query);
      expect(decision.route, query).toBe("refine");
      expect(decision.canTryAi).toBe(false);
      expect(decision.canSearchFree).toBe(false);
    }
    expect(routeQuery("").route).toBe("refine");
    expect(routeQuery("   ").route).toBe("refine");
  });

  it("refuses an over-long description before anything else (200-character limit)", () => {
    const decision = routeQuery("a loving god ".repeat(20));
    expect(decision.route).toBe("refine");
    expect(decision.reasons).toEqual(["too_long"]);
    expect(routeMessage(decision)).toContain("200");
    expect(routeQuery("love is patient ".repeat(12).trim().slice(0, 200)).route).toBe("needs_ai");
  });

  it("recognises keyboard mashing and non-text as nonsense", () => {
    for (const query of [
      "asdf qwerty zxcv",
      "qwertyuiop",
      "asdfghjkl",
      "aaaaaaaa",
      "xzcvbnm",
      "!!!???",
      "12345",
      "😀😀😀",
      "hjkl hjkl hjkl",
    ]) {
      const decision = routeQuery(query);
      expect(decision.route, query).toBe("nonsense");
      expect(decision.canTryAi).toBe(false);
    }
  });

  it("does not call unusual real words nonsense", () => {
    for (const query of [
      "strengths of the righteous",
      "rhythm of the psalms",
      "sixths and twelfths of the land",
      "the lord is my shepherd",
    ]) {
      expect(routeQuery(query).route, query).toBe("needs_ai");
    }
  });
});

describe("with no free search yet, real descriptions are offered AI help, never started automatically", () => {
  it("offers AI for a real description and says why", () => {
    const decision = routeQuery("verse about courage when afraid");
    expect(decision.route).toBe("needs_ai");
    expect(decision.canTryAi).toBe(true);
    expect(decision.reasons).toContain("free_search_unavailable");
    expect(decision.reasons).toContain("topic_cue");
  });

  it("is deterministic and never puts the query text into its reasons", () => {
    const a = routeQuery("my private prayer about my family");
    const b = routeQuery("my private prayer about my family");
    expect(a).toEqual(b);
    expect(JSON.stringify(a.reasons)).not.toContain("prayer");
  });
});

describe("the 40-query evaluation set, offline", () => {
  const decisions = EVAL_QUERIES.map((item) => ({ item, decision: routeQuery(item.query) }));

  it("never treats an evaluation query as a reference", () => {
    expect(
      decisions.filter(({ decision }) => decision.route === "reference").map(({ item }) => item.id),
    ).toEqual([]);
  });

  it("routes real descriptions to needs_ai and the keyboard-mashing query to nonsense", () => {
    const counts: Record<string, number> = {};
    for (const { decision } of decisions)
      counts[decision.route] = (counts[decision.route] ?? 0) + 1;
    expect(counts).toEqual({ needs_ai: 39, nonsense: 1 });
    expect(decisions.find(({ item }) => item.id === 40)?.decision.route).toBe("nonsense");
  });

  it("offers AI for exactly the queries that need it and never for nonsense", () => {
    for (const { item, decision } of decisions) {
      expect(decision.canTryAi).toBe(item.category !== "nonsense" || item.id === 39);
    }
  });

  it("keeps enough meaning in every description: two content words, or one framed as a topic", () => {
    for (const { item, decision } of decisions.filter(({ item }) => item.category !== "nonsense")) {
      const { contentWords, topicCue } = decision.analysis;
      expect(
        contentWords.length >= 2 || (contentWords.length === 1 && topicCue),
        `#${item.id}`,
      ).toBe(true);
    }
  });
});

describe("decisions once free full-text search exists (thresholds, tested with synthetic signals)", () => {
  const signals = (over: Partial<FreeSearchSignals> = {}): FreeSearchSignals => ({
    phraseHit: false,
    bestCoverage: 0,
    resultCount: 0,
    scoreGap: 0,
    outOfVocabularyRate: 0,
    ...over,
  });
  const route = (query: string, free: FreeSearchSignals) => routeQuery(query, free);

  it("a phrase hit is confident and offers no AI", () => {
    const decision = route(
      "love is patient",
      signals({ phraseHit: true, resultCount: 3, bestCoverage: 1 }),
    );
    expect(decision).toMatchObject({ route: "free_confident", canTryAi: false });
  });

  it("strong coverage with a clear lead is confident; without a lead it is only adequate", () => {
    expect(
      route("renew your mind", signals({ resultCount: 5, bestCoverage: 0.9, scoreGap: 0.3 })).route,
    ).toBe("free_confident");
    expect(
      route("renew your mind", signals({ resultCount: 5, bestCoverage: 0.9, scoreGap: 0.05 }))
        .route,
    ).toBe("free_adequate");
  });

  it("partial matches are adequate and may offer AI", () => {
    const decision = route(
      "anxious about tomorrow",
      signals({ resultCount: 4, bestCoverage: 0.6 }),
    );
    expect(decision).toMatchObject({ route: "free_adequate", canTryAi: true });
  });

  it("weak or no free results for a real description need AI", () => {
    expect(
      route("verse about courage when afraid", signals({ resultCount: 2, bestCoverage: 0.2 }))
        .route,
    ).toBe("needs_ai");
    expect(route("verse about courage when afraid", signals()).route).toBe("needs_ai");
  });

  it("a single word with no free results is refine; with results it is shown as free", () => {
    expect(route("faith", signals()).route).toBe("refine");
    expect(route("faith", signals({ resultCount: 6, bestCoverage: 0.55 })).route).toBe(
      "free_adequate",
    );
  });

  it("mostly unknown words with no results is nonsense and never AI", () => {
    const decision = route("blorptastic flumzo wibble", signals({ outOfVocabularyRate: 0.8 }));
    expect(decision).toMatchObject({ route: "nonsense", canTryAi: false });
  });

  it("references and lexical nonsense ignore free signals", () => {
    expect(
      route("john 3:16", signals({ resultCount: 9, bestCoverage: 1, phraseHit: true })).route,
    ).toBe("reference");
    expect(
      route("asdf qwerty zxcv", signals({ resultCount: 9, bestCoverage: 1, phraseHit: true }))
        .route,
    ).toBe("nonsense");
  });

  it("exposes its thresholds for calibration", () => {
    expect(ROUTER_THRESHOLDS.confidentCoverage).toBeGreaterThan(ROUTER_THRESHOLDS.adequateCoverage);
    expect(ROUTER_THRESHOLDS.minContentWords).toBe(2);
  });
});

describe("analysis helpers", () => {
  it("removes stop words and measures letters", () => {
    const a = analyzeQuery("The Lord is my shepherd");
    expect(a.contentWords).toEqual(["lord", "shepherd"]);
    expect(a.letterRatio).toBe(1);
    expect(analyzeQuery("what does the bible say about love").topicCue).toBe(true);
    expect(analyzeQuery("love is patient").topicCue).toBe(false);
  });

  it("gives plain messages only for the routes that stop short", () => {
    expect(routeMessage({ route: "refine", reasons: ["too_few_words"] })).toContain("John 3:16");
    expect(routeMessage({ route: "nonsense", reasons: ["implausible_text"] })).toContain(
      "make sense",
    );
    expect(routeMessage({ route: "needs_ai", reasons: [] })).toBeNull();
    expect(routeMessage({ route: "reference", reasons: [] })).toBeNull();
  });
});

describe("the router never calls OpenAI or the network", () => {
  it("makes no network request while routing the whole evaluation set and all reference forms", () => {
    const spy = vi.fn(() => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", spy);
    for (const item of EVAL_QUERIES) routeQuery(item.query);
    for (const text of ["john 3:16", "ruth", "psalms 23:1-6", "asdf qwerty zxcv", "love"])
      routeQuery(text);
    expect(spy).not.toHaveBeenCalled();
  });

  it("imports nothing that could reach a provider, the database or a secret", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "search-router.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect([...new Set(imports)].sort()).toEqual([
      "./ai/input",
      "./ai/types",
      "./classify-query",
      "./parse-reference",
    ]);
    expect(source).not.toMatch(/openai|supabase|\.server|process\.env|fetch\(/i);
  });
});

describe("AI-disabled behaviour: free routes work, AI is only ever offered, never started", () => {
  function disabledDeps() {
    const findCandidates = vi.fn();
    const consumeRpc = vi.fn();
    const provider: ReferenceProvider = { id: "openai", findCandidates };
    const deps: SearchServiceDeps = {
      readConfig: () => ({
        enabled: false,
        provider: "openai",
        model: "gpt-6-luna",
        effort: "none",
        limits: DEFAULT_LIMITS,
      }),
      env: {},
      onVercel: false,
      createProvider: () => provider,
      verifyToken: async () => null,
      consumeRpc,
      resolveAndRank: vi.fn(),
      cache: new Map(),
      log: () => undefined,
    };
    return { deps, findCandidates, consumeRpc };
  }

  it("a reference is resolved by the router alone; the AI service is never involved", () => {
    const { findCandidates, consumeRpc } = disabledDeps();
    expect(routeQuery("psalm 23:1-6").route).toBe("reference");
    expect(findCandidates).not.toHaveBeenCalled();
    expect(consumeRpc).not.toHaveBeenCalled();
  });

  it("a description that could use AI is only offered it; asking while disabled reports 'off' and spends nothing", async () => {
    const { deps, findCandidates, consumeRpc } = disabledDeps();
    const decision = routeQuery("verse about courage when afraid");
    expect(decision.canTryAi).toBe(true);
    // The router did not start anything.
    expect(findCandidates).not.toHaveBeenCalled();

    const response: ScriptureSearchResponse = await runAiSearch(
      { query: decision.query },
      { headers: new Headers(), socketIp: "127.0.0.1" },
      deps,
    );
    expect(response).toMatchObject({ results: [], failed: true, aiStatus: "off" });
    expect(findCandidates).not.toHaveBeenCalled();
    expect(consumeRpc).not.toHaveBeenCalled();
  });

  it("queries that never qualify for AI are decided without involving it", () => {
    const { deps, findCandidates, consumeRpc } = disabledDeps();
    void deps;
    for (const query of ["love", "asdf qwerty zxcv", "a loving god ".repeat(20)]) {
      expect(routeQuery(query).canTryAi, query).toBe(false);
    }
    expect(findCandidates).not.toHaveBeenCalled();
    expect(consumeRpc).not.toHaveBeenCalled();
  });
});

describe("the response contract stays backward compatible", () => {
  it("accepts the original shape unchanged and the new optional fields", () => {
    const original: ScriptureSearchResponse = { results: [], failed: false };
    const extended: ScriptureSearchResponse = {
      results: [],
      failed: false,
      source: "reference",
      route: "reference",
      canTryAi: false,
      aiStatus: "off",
    };
    expect(JSON.parse(JSON.stringify(original))).toEqual({ results: [], failed: false });
    expect(Object.keys(extended).sort()).toEqual([
      "aiStatus",
      "canTryAi",
      "failed",
      "results",
      "route",
      "source",
    ]);
  });
});
