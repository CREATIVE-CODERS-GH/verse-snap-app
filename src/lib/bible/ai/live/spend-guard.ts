import fs from "node:fs";
import { MAX_OUTPUT_TOKENS, PRICES_PER_MILLION } from "../providers/openai.server";
import { MAX_QUERY_LENGTH } from "../input";
import { SYSTEM_PROMPT } from "../prompt";

/**
 * Spending guard for the MANUAL live tests (never used by `npm test`).
 * Every paid request is recorded in a local ledger file; a run is refused when its worst-case cost
 * would take the total past the allowance. The ledger holds token counts and costs only: no API key,
 * no user data, no search text.
 */

/** Total the manual live tests may spend, in USD. The rest of the account credit is reserved for app testing. */
export const LIVE_ALLOWANCE_USD = 0.5;

export interface LedgerEntry {
  at: string;
  label: string;
  model: string;
  effort: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** null when the model has no listed price; counted at the worst case when summing. */
  estimatedCostUsd: number | null;
}

export function readLedger(file: string): LedgerEntry[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as LedgerEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLedger(file: string, entry: LedgerEntry): void {
  const entries = readLedger(file);
  entries.push(entry);
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

/** Worst-case cost of ONE request: a generous input estimate plus the full output cap. */
export function maxCostPerRequest(model: string): number {
  const price = PRICES_PER_MILLION[model];
  if (!price) throw new Error(`No price listed for model "${model}"; refusing to spend.`);
  const maxInputTokens = Math.ceil((SYSTEM_PROMPT.length + MAX_QUERY_LENGTH) / 2) + 50;
  return (maxInputTokens * price.input + MAX_OUTPUT_TOKENS * price.output) / 1_000_000;
}

export function totalSpent(entries: readonly LedgerEntry[], model: string): number {
  return entries.reduce((sum, entry) => {
    if (entry.estimatedCostUsd !== null) return sum + entry.estimatedCostUsd;
    return sum + maxCostPerRequest(model);
  }, 0);
}

export interface SpendPlan {
  requests: number;
  model: string;
  perRequestMaxUsd: number;
  plannedMaxUsd: number;
  spentSoFarUsd: number;
  allowanceUsd: number;
  remainingBeforeUsd: number;
  ok: boolean;
  reason?: string;
}

export function planSpend(args: {
  requests: number;
  model: string;
  ledger: readonly LedgerEntry[];
  allowanceUsd?: number;
  maxRequests?: number;
}): SpendPlan {
  const allowanceUsd = args.allowanceUsd ?? LIVE_ALLOWANCE_USD;
  const perRequestMaxUsd = maxCostPerRequest(args.model);
  const plannedMaxUsd = perRequestMaxUsd * args.requests;
  const spentSoFarUsd = totalSpent(args.ledger, args.model);
  const remainingBeforeUsd = Math.max(0, allowanceUsd - spentSoFarUsd);
  const base = {
    requests: args.requests,
    model: args.model,
    perRequestMaxUsd,
    plannedMaxUsd,
    spentSoFarUsd,
    allowanceUsd,
    remainingBeforeUsd,
  };
  if (!Number.isInteger(args.requests) || args.requests < 1) {
    return {
      ...base,
      ok: false,
      reason: "The number of requests must be a positive whole number.",
    };
  }
  if (args.maxRequests !== undefined && args.requests > args.maxRequests) {
    return {
      ...base,
      ok: false,
      reason: `At most ${args.maxRequests} requests are allowed in one run.`,
    };
  }
  if (spentSoFarUsd + plannedMaxUsd > allowanceUsd) {
    return {
      ...base,
      ok: false,
      reason: `Worst case $${(spentSoFarUsd + plannedMaxUsd).toFixed(4)} would exceed the $${allowanceUsd.toFixed(2)} allowance.`,
    };
  }
  return { ...base, ok: true };
}

export function describePlan(plan: SpendPlan): string {
  return [
    `Planned live OpenAI requests: ${plan.requests} (model ${plan.model})`,
    `Worst-case cost per request:  $${plan.perRequestMaxUsd.toFixed(5)}`,
    `Worst-case total this run:    $${plan.plannedMaxUsd.toFixed(5)}`,
    `Already spent (ledger):       $${plan.spentSoFarUsd.toFixed(5)}`,
    `Live-test allowance:          $${plan.allowanceUsd.toFixed(2)} (remaining before this run: $${plan.remainingBeforeUsd.toFixed(5)})`,
    plan.ok ? "Within the allowance." : `REFUSED: ${plan.reason ?? "over allowance"}`,
  ].join("\n");
}

/** A live run needs this exact variable set to the exact phrase; anything else keeps it off. */
export function isApproved(
  env: Record<string, string | undefined>,
  name: string,
  phrase: string,
): boolean {
  return env[name] === phrase;
}
