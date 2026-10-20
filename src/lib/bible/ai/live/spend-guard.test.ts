import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIVE_ALLOWANCE_USD,
  appendLedger,
  describePlan,
  isApproved,
  maxCostPerRequest,
  planSpend,
  readLedger,
  totalSpent,
  type LedgerEntry,
} from "./spend-guard";

const entry = (cost: number | null): LedgerEntry => ({
  at: "2026-10-19T00:00:00Z",
  label: "t",
  model: "gpt-6-luna",
  effort: "none",
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  estimatedCostUsd: cost,
});

describe("spend guard", () => {
  it("keeps the manual live-test allowance at $0.50", () => {
    expect(LIVE_ALLOWANCE_USD).toBe(0.5);
  });

  it("prices a worst-case request at about a tenth of a cent", () => {
    const worst = maxCostPerRequest("gpt-6-luna");
    expect(worst).toBeGreaterThan(0.0005);
    expect(worst).toBeLessThan(0.002);
  });

  it("refuses to plan spending for a model with no listed price", () => {
    expect(() => maxCostPerRequest("mystery-model")).toThrow();
  });

  it("approves a small run and a full 80-request evaluation on an empty ledger", () => {
    expect(planSpend({ requests: 5, model: "gpt-6-luna", ledger: [], maxRequests: 5 }).ok).toBe(
      true,
    );
    const full = planSpend({ requests: 80, model: "gpt-6-luna", ledger: [] });
    expect(full.ok).toBe(true);
    expect(full.plannedMaxUsd).toBeLessThan(0.2);
  });

  it("refuses a run whose worst case would pass the allowance", () => {
    const plan = planSpend({ requests: 1000, model: "gpt-6-luna", ledger: [] });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain("exceed");
  });

  it("takes earlier spending into account", () => {
    const nearlyFull = [entry(0.499)];
    expect(planSpend({ requests: 1, model: "gpt-6-luna", ledger: nearlyFull }).ok).toBe(false);
  });

  it("counts a failed request of unknown cost at the worst case", () => {
    expect(totalSpent([entry(null)], "gpt-6-luna")).toBeCloseTo(
      maxCostPerRequest("gpt-6-luna"),
      10,
    );
  });

  it("rejects bad request counts and over-large runs", () => {
    for (const requests of [0, -1, 1.5, Number.NaN]) {
      expect(planSpend({ requests, model: "gpt-6-luna", ledger: [] }).ok).toBe(false);
    }
    expect(planSpend({ requests: 6, model: "gpt-6-luna", ledger: [], maxRequests: 5 }).ok).toBe(
      false,
    );
  });

  it("describes the plan with the numbers a person needs before approving", () => {
    const text = describePlan(planSpend({ requests: 3, model: "gpt-6-luna", ledger: [] }));
    expect(text).toContain("Planned live OpenAI requests: 3");
    expect(text).toContain("Worst-case total this run");
    expect(text).toContain("$0.50");
  });

  it("only treats the exact approval phrase as approval", () => {
    expect(isApproved({ X: "I-APPROVE" }, "X", "I-APPROVE")).toBe(true);
    for (const value of [undefined, "", "yes", "true", "i-approve", "I-APPROVE "]) {
      expect(isApproved({ X: value }, "X", "I-APPROVE")).toBe(false);
    }
  });

  it("round-trips the ledger on disk and tolerates a missing or corrupt file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
    const file = path.join(dir, "ledger.json");
    expect(readLedger(file)).toEqual([]);
    appendLedger(file, entry(0.0001));
    appendLedger(file, entry(0.0002));
    expect(readLedger(file)).toHaveLength(2);
    fs.writeFileSync(file, "not json");
    expect(readLedger(file)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stores no secrets or search text in a ledger entry", () => {
    const keys = Object.keys(entry(0.1)).sort();
    expect(keys).toEqual(
      [
        "at",
        "effort",
        "estimatedCostUsd",
        "inputTokens",
        "label",
        "model",
        "outputTokens",
        "reasoningTokens",
      ].sort(),
    );
  });
});
