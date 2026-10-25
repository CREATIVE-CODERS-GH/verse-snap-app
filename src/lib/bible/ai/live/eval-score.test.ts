import { describe, expect, it } from "vitest";
import { EVAL_QUERIES, type EvalQuery } from "./eval-queries";
import { formatSummaries, referenceKey, summarize, type EvalRun } from "./eval-score";

function run(
  query: EvalQuery,
  candidates: Array<[string, number, number]>,
  over: Partial<EvalRun> = {},
): EvalRun {
  return {
    query,
    candidates: candidates.map(([book, chapter, verse]) => ({ book, chapter, verse })),
    failed: false,
    latencyMs: 1000,
    inputTokens: 300,
    outputTokens: 100,
    reasoningTokens: 0,
    costUsd: 0.0001,
    ...over,
  };
}

const q = (id: number) => EVAL_QUERIES.find((item) => item.id === id)!;

describe("evaluation dataset", () => {
  it("has exactly 40 queries with unique ids and a spread of categories", () => {
    expect(EVAL_QUERIES).toHaveLength(40);
    expect(new Set(EVAL_QUERIES.map((item) => item.id)).size).toBe(40);
    const categories = new Set(EVAL_QUERIES.map((item) => item.category));
    expect([...categories].sort()).toEqual([
      "exact",
      "nonsense",
      "paraphrase",
      "partial",
      "topic",
      "typo",
    ]);
  });

  it("uses only expected references the app can parse", () => {
    for (const item of EVAL_QUERIES) {
      for (const reference of item.expected) {
        expect(referenceKey(reference), `${item.id}: ${reference}`).not.toBeNull();
      }
    }
  });

  it("keeps every query within the app's 200-character limit", () => {
    for (const item of EVAL_QUERIES) expect(item.query.length).toBeLessThanOrEqual(200);
  });

  it("expects nothing for nonsense queries and something for all others", () => {
    for (const item of EVAL_QUERIES) {
      expect(item.expected.length === 0).toBe(item.category === "nonsense");
    }
  });
});

describe("summarize", () => {
  it("scores top-1, top-3 and anywhere, matching references however they are written", () => {
    const runs = [
      run(q(1), [
        ["1 Cor", 13, 4],
        ["Romans", 12, 9],
      ]), // top-1 hit via alias
      run(q(2), [
        ["Romans", 5, 8],
        ["Romans", 8, 28],
        ["John", 3, 16],
      ]), // top-3 but not top-1
      run(q(3), [
        ["Genesis", 1, 1],
        ["Genesis", 1, 2],
        ["Genesis", 1, 3],
        ["Psalms", 23, 1],
      ]), // anywhere only
      run(q(4), [["Genesis", 1, 1]]), // miss
    ];
    const s = summarize("t", runs);
    expect(s.answerable).toBe(4);
    expect(s.top1).toBeCloseTo(0.25);
    expect(s.top3).toBeCloseTo(0.5);
    expect(s.anywhere).toBeCloseTo(0.75);
    expect(s.meanCandidates).toBeCloseTo((2 + 3 + 4 + 1) / 4);
  });

  it("accepts any of several acceptable answers for a topic query", () => {
    const s = summarize("t", [run(q(31), [["Ephesians", 4, 32]])]);
    expect(s.top1).toBe(1);
  });

  it("measures false positives on nonsense queries separately and excludes them from accuracy", () => {
    const s = summarize("t", [
      run(q(39), [["John", 3, 16]]),
      run(q(40), []),
      run(q(1), [["1 Corinthians", 13, 4]]),
    ]);
    expect(s.answerable).toBe(1);
    expect(s.top3).toBe(1);
    expect(s.nonsenseWithCandidates).toBeCloseTo(0.5);
  });

  it("reports latency percentiles, failures and costs", () => {
    const runs = [100, 200, 300, 400, 5000].map((ms, i) =>
      run(q(i + 1), [["John", 3, 16]], { latencyMs: ms, costUsd: 0.001, failed: i === 4 }),
    );
    const s = summarize("t", runs);
    expect(s.latencyMeanMs).toBeCloseTo(1200);
    expect(s.latencyMedianMs).toBe(300);
    expect(s.latencyP95Ms).toBe(5000);
    expect(s.failures).toBe(1);
    expect(s.costTotalUsd).toBeCloseTo(0.005);
    expect(s.costPerQueryUsd).toBeCloseTo(0.001);
  });

  it("breaks top-3 accuracy down by category", () => {
    const s = summarize("t", [
      run(q(1), [["1 Corinthians", 13, 4]]),
      run(q(21), [["Genesis", 1, 1]]),
    ]);
    expect(s.byCategory.exact).toEqual({ top3: 1, of: 1 });
    expect(s.byCategory.paraphrase).toEqual({ top3: 0, of: 1 });
  });

  it("handles an empty run without dividing by zero", () => {
    const s = summarize("t", []);
    expect(s.top3).toBe(0);
    expect(s.latencyP95Ms).toBe(0);
    expect(Number.isNaN(s.meanCandidates)).toBe(false);
  });

  it("ignores candidates that are not real references", () => {
    const s = summarize("t", [run(q(1), [["Not A Book", 1, 1]])]);
    expect(s.top3).toBe(0);
  });
});

describe("formatSummaries", () => {
  it("renders a comparison table with one row per configuration", () => {
    const a = summarize("none", [run(q(1), [["1 Corinthians", 13, 4]])]);
    const b = summarize("low", [run(q(1), [["Genesis", 1, 1]])]);
    const text = formatSummaries([a, b]);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("top-3");
    expect(text).toContain("none");
    expect(text).toContain("low");
  });
});
