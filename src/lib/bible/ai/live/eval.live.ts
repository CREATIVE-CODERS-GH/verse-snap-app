import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAiSearchConfig, type ReasoningEffort } from "../config.server";
import { createOpenAiClient, createOpenAiProvider } from "../providers/openai.server";
import type { ReferenceCandidate } from "../types";
import { EVAL_QUERIES } from "./eval-queries";
import { formatSummaries, summarize, type EvalRun } from "./eval-score";
import { appendLedger, describePlan, isApproved, planSpend, readLedger } from "./spend-guard";

/**
 * MANUAL FULL EVALUATION (40 queries x reasoning efforts). REAL, PAID requests: NOT approved to run yet.
 * Compares reasoning effort "none" and "low" on top-3 accuracy, candidate count, latency and cost.
 * Off unless both variables are set; never part of `npm test`.
 *
 *   $env:AI_LIVE_EVAL_APPROVED = "I-APPROVE-FULL-EVALUATION"
 *   npm run live:eval
 *
 * It prints the worst-case cost and refuses to start if that would exceed the $0.50 live allowance
 * (taking the ledger's previous spending into account).
 */

const APPROVAL_PHRASE = "I-APPROVE-FULL-EVALUATION";
const EFFORTS: ReasoningEffort[] = ["none", "low"];
const LEDGER = path.resolve(process.cwd(), ".ai-spend-ledger.json");
const approved = isApproved(process.env, "AI_LIVE_EVAL_APPROVED", APPROVAL_PHRASE);

describe.skipIf(!approved)("LIVE evaluation (spends real money)", () => {
  it("compares reasoning efforts over the 40-query set", async () => {
    const config = readAiSearchConfig({ ...process.env, AI_SEARCH_ENABLED: "true" });
    const total = EVAL_QUERIES.length * EFFORTS.length;
    const plan = planSpend({
      requests: total,
      model: config.model,
      ledger: readLedger(LEDGER),
      maxRequests: 100,
    });
    console.log(`\n${describePlan(plan)}\n`);
    expect(plan.ok, plan.reason).toBe(true);

    const apiKey = process.env["OPENAI_API_KEY"];
    expect(apiKey, "OPENAI_API_KEY is missing").toBeTruthy();
    const client = createOpenAiClient(apiKey!);

    const summaries = [];
    for (const effort of EFFORTS) {
      const provider = createOpenAiProvider({ model: config.model, effort, client });
      const runs: EvalRun[] = [];
      for (const query of EVAL_QUERIES) {
        const started = Date.now();
        let candidates: ReferenceCandidate[] = [];
        let failed = false;
        let usage = {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          estimatedCostUsd: 0 as number | null,
        };
        try {
          const found = await provider.findCandidates({ query: query.query, maxCandidates: 12 });
          candidates = found.candidates;
          if (found.usage) usage = found.usage;
        } catch {
          failed = true;
          usage.estimatedCostUsd = null; // unknown: counted at the worst case in the ledger
        }
        appendLedger(LEDGER, {
          at: new Date().toISOString(),
          label: `eval-${effort}-${query.id}${failed ? "-failed" : ""}`,
          model: config.model,
          effort,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
        });
        runs.push({
          query,
          candidates,
          failed,
          latencyMs: Date.now() - started,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          costUsd: usage.estimatedCostUsd ?? 0,
        });
      }
      summaries.push(summarize(`${config.model} / ${effort}`, runs));
      const out = path.resolve(process.cwd(), "evals/ai-search", `results-${effort}.json`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(
        out,
        `${JSON.stringify(
          runs.map((r) => ({ ...r, query: { id: r.query.id, category: r.query.category } })),
          null,
          2,
        )}\n`,
      );
    }
    console.log(`\n${formatSummaries(summaries)}\n`);
    expect(summaries).toHaveLength(EFFORTS.length);
  });
});

describe.skipIf(approved)("live evaluation is OFF", () => {
  it("stays skipped unless explicitly approved (no spending)", () => {
    console.log(
      `Live evaluation is off. It has NOT been approved to run. Required: AI_LIVE_EVAL_APPROVED=${APPROVAL_PHRASE}.`,
    );
    expect(approved).toBe(false);
  });
});
