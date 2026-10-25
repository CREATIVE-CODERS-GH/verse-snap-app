import { parseReference } from "../../parse-reference";
import type { ReferenceCandidate } from "../types";
import type { EvalCategory, EvalQuery } from "./eval-queries";

/** Pure scoring for the evaluation: no network, fully unit-testable with made-up results. */

export interface EvalRun {
  query: EvalQuery;
  /** Candidates in the model's order; empty when none were proposed or the request failed. */
  candidates: ReferenceCandidate[];
  failed: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface EvalSummary {
  label: string;
  queries: number;
  failures: number;
  /** Over queries that have an expected answer. */
  answerable: number;
  top1: number;
  top3: number;
  /** Any expected reference anywhere in the candidate list. */
  anywhere: number;
  meanCandidates: number;
  /** Over "nonsense" queries: share that still produced at least one candidate. */
  nonsenseWithCandidates: number;
  latencyMeanMs: number;
  latencyMedianMs: number;
  latencyP95Ms: number;
  costTotalUsd: number;
  costPerQueryUsd: number;
  byCategory: Partial<Record<EvalCategory, { top3: number; of: number }>>;
}

export function referenceKey(text: string): string | null {
  const parsed = parseReference(text);
  return parsed && parsed.verse !== undefined
    ? `${parsed.bookId}-${parsed.chapter}-${parsed.verse}`
    : null;
}

function candidateKeys(candidates: readonly ReferenceCandidate[]): Array<string | null> {
  return candidates.map((c) => referenceKey(`${c.book} ${c.chapter}:${c.verse}`));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarize(label: string, runs: readonly EvalRun[]): EvalSummary {
  const answerable = runs.filter((run) => run.query.expected.length > 0);
  const nonsense = runs.filter((run) => run.query.category === "nonsense");
  const byCategory: EvalSummary["byCategory"] = {};

  let top1 = 0;
  let top3 = 0;
  let anywhere = 0;
  for (const run of answerable) {
    const expected = new Set(
      run.query.expected.map(referenceKey).filter((k): k is string => k !== null),
    );
    const keys = candidateKeys(run.candidates);
    const hit1 = keys.slice(0, 1).some((k) => k !== null && expected.has(k));
    const hit3 = keys.slice(0, 3).some((k) => k !== null && expected.has(k));
    const hitAny = keys.some((k) => k !== null && expected.has(k));
    if (hit1) top1 += 1;
    if (hit3) top3 += 1;
    if (hitAny) anywhere += 1;
    const bucket = (byCategory[run.query.category] ??= { top3: 0, of: 0 });
    bucket.of += 1;
    if (hit3) bucket.top3 += 1;
  }

  const latencies = runs.map((run) => run.latencyMs).sort((a, b) => a - b);
  const costTotalUsd = runs.reduce((sum, run) => sum + run.costUsd, 0);
  const rate = (n: number, of: number) => (of === 0 ? 0 : n / of);

  return {
    label,
    queries: runs.length,
    failures: runs.filter((run) => run.failed).length,
    answerable: answerable.length,
    top1: rate(top1, answerable.length),
    top3: rate(top3, answerable.length),
    anywhere: rate(anywhere, answerable.length),
    meanCandidates: rate(
      runs.reduce((sum, run) => sum + run.candidates.length, 0),
      runs.length,
    ),
    nonsenseWithCandidates: rate(
      nonsense.filter((run) => run.candidates.length > 0).length,
      nonsense.length,
    ),
    latencyMeanMs: rate(
      latencies.reduce((a, b) => a + b, 0),
      latencies.length,
    ),
    latencyMedianMs: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    costTotalUsd,
    costPerQueryUsd: rate(costTotalUsd, runs.length),
    byCategory,
  };
}

export function formatSummaries(summaries: readonly EvalSummary[]): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const rows: string[][] = [
    [
      "config",
      "queries",
      "failed",
      "top-1",
      "top-3",
      "anywhere",
      "mean cands",
      "nonsense w/ cands",
      "lat mean ms",
      "lat p95 ms",
      "cost total $",
      "cost/query $",
    ],
    ...summaries.map((s) => [
      s.label,
      String(s.queries),
      String(s.failures),
      pct(s.top1),
      pct(s.top3),
      pct(s.anywhere),
      s.meanCandidates.toFixed(1),
      pct(s.nonsenseWithCandidates),
      s.latencyMeanMs.toFixed(0),
      s.latencyP95Ms.toFixed(0),
      s.costTotalUsd.toFixed(5),
      s.costPerQueryUsd.toFixed(6),
    ]),
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => (row[col] ?? "").length)));
  return rows
    .map((row) => row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  "))
    .join("\n");
}
