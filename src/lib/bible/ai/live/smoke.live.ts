import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAiSearchConfig, type ReasoningEffort } from "../config.server";
import { createProvider } from "../providers/index.server";
import { runAiSearch, type SearchServiceDeps, type UsageLog } from "../search-service.server";
import type { ReferenceProvider } from "../types";
import { EVAL_QUERIES } from "./eval-queries";
import { appendLedger, describePlan, isApproved, planSpend, readLedger } from "./spend-guard";

/**
 * MANUAL LIVE SMOKE TEST. Makes REAL, PAID OpenAI requests, so it is OFF unless you opt in.
 * It is not part of `npm test` and cannot run by accident:
 *   - only `npm run live:smoke` (vitest.live.config.ts) even looks at *.live.ts files, and
 *   - it does nothing unless BOTH variables below are set in the shell that launches it.
 *
 *   PowerShell:
 *     $env:AI_LIVE_SMOKE_APPROVED = "I-APPROVE-LIVE-OPENAI-SPEND"
 *     $env:AI_LIVE_SMOKE_REQUESTS = "3"        # 1 to 5
 *     npm run live:smoke
 *
 * What it does: runs N searches (N paid requests, one each, no retries, no fallback model) through
 * the real orchestrator and provider, with an in-memory stand-in for the quota database (no
 * database writes) and real HelloAO verification (free). It refuses to start if the worst-case
 * cost would exceed the $0.50 live-test allowance, and it records every request's tokens and cost
 * in .ai-spend-ledger.json (no key, no search text, no user data).
 */

const APPROVAL_PHRASE = "I-APPROVE-LIVE-OPENAI-SPEND";
const MAX_REQUESTS = 5;
const LEDGER = path.resolve(process.cwd(), ".ai-spend-ledger.json");

const requests = Number(process.env["AI_LIVE_SMOKE_REQUESTS"] ?? 0);
const approved = isApproved(process.env, "AI_LIVE_SMOKE_APPROVED", APPROVAL_PHRASE) && requests > 0;

// A fixed, varied sample: exact quote, paraphrase, topic, typo, nonsense.
const SAMPLE_IDS = [1, 21, 31, 36, 39];

describe.skipIf(!approved)("LIVE smoke test (spends real money)", () => {
  it("runs the real pipeline for a few searches within the spending allowance", async () => {
    const config = readAiSearchConfig({
      ...process.env,
      AI_SEARCH_ENABLED: "true",
    });
    const effort: ReasoningEffort = config.effort;

    const plan = planSpend({
      requests,
      model: config.model,
      ledger: readLedger(LEDGER),
      maxRequests: MAX_REQUESTS,
    });
    console.log(`\n${describePlan(plan)}\n`);
    expect(plan.ok, plan.reason).toBe(true); // stops here, before any spending, if not

    const apiKey = process.env["OPENAI_API_KEY"];
    expect(apiKey, "OPENAI_API_KEY is missing").toBeTruthy();
    const real = createProvider(config, { OPENAI_API_KEY: apiKey });
    expect(real).not.toBeNull();

    let n = 0;
    const metered: ReferenceProvider = {
      id: real!.id,
      async findCandidates(input) {
        n += 1;
        const label = `smoke-${n}`;
        try {
          const found = await real!.findCandidates(input);
          appendLedger(LEDGER, {
            at: new Date().toISOString(),
            label,
            model: config.model,
            effort,
            inputTokens: found.usage?.inputTokens ?? 0,
            outputTokens: found.usage?.outputTokens ?? 0,
            reasoningTokens: found.usage?.reasoningTokens ?? 0,
            estimatedCostUsd: found.usage?.estimatedCostUsd ?? null,
          });
          return found;
        } catch (error) {
          // Unknown whether a failed request was billed: count it at the worst case.
          appendLedger(LEDGER, {
            at: new Date().toISOString(),
            label: `${label}-failed`,
            model: config.model,
            effort,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            estimatedCostUsd: null,
          });
          throw error;
        }
      },
    };

    const logs: UsageLog[] = [];
    const deps: SearchServiceDeps = {
      readConfig: () => config,
      env: {
        OPENAI_API_KEY: apiKey,
        RATE_LIMIT_SALT: "live-smoke-salt-not-a-real-secret-0000000000",
      },
      onVercel: false,
      createProvider: () => metered,
      verifyToken: async () => null,
      // Stand-in for the quota database: allows everything and writes nothing.
      consumeRpc: async () => ({
        data: [{ allowed: true, reason: null, retry_after_seconds: 0 }],
        error: null,
      }),
      resolveAndRank: async (query, translation, candidates) => {
        const { resolveAndRank } = await import("../rank");
        return resolveAndRank(query, translation, candidates);
      },
      cache: new Map(),
      log: (entry) => logs.push(entry),
    };

    const sample = SAMPLE_IDS.slice(0, requests).map((id) =>
      EVAL_QUERIES.find((q) => q.id === id)!,
    );
    for (const item of sample) {
      const started = Date.now();
      const response = await runAiSearch(
        { query: item.query },
        { headers: new Headers(), socketIp: "127.0.0.1" },
        deps,
      );
      const used = logs[logs.length - 1];
      console.log(
        [
          `#${item.id} [${item.category}]`,
          `failed=${response.failed}`,
          `results=${response.results.length}`,
          `top=${response.results[0]?.reference ?? "-"}`,
          `ms=${Date.now() - started}`,
          `tokens in/out/reasoning=${used?.inputTokens ?? "?"}/${used?.outputTokens ?? "?"}/${used?.reasoningTokens ?? "?"}`,
          `cost=$${(used?.estimatedCostUsd ?? 0).toFixed(6)}`,
        ].join("  "),
      );
      expect(response.failed).toBe(false);
    }

    const after = readLedger(LEDGER);
    console.log(
      `\nLedger total after this run: $${after.reduce((s, e) => s + (e.estimatedCostUsd ?? 0), 0).toFixed(6)} of $0.50 allowance\n`,
    );
    expect(n).toBe(requests); // exactly one paid request per search
  });
});

describe.skipIf(approved)("live smoke test is OFF", () => {
  it("stays skipped unless explicitly approved (no spending)", () => {
    console.log(
      `Live smoke test is off. To run it you must set AI_LIVE_SMOKE_APPROVED=${APPROVAL_PHRASE} and AI_LIVE_SMOKE_REQUESTS=1..${MAX_REQUESTS}.`,
    );
    expect(approved).toBe(false);
  });
});
