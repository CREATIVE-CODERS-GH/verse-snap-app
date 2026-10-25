import type { QuotaLimits } from "./config.server";
import type { Identity } from "./identity.server";

/**
 * Database-enforced quota (see supabase/migrations/20261019000200_ai_search_rate_limit.sql).
 * One atomic call checks the caller's minute and day windows, then the global day and month
 * windows. Any failure to get a clear answer is treated as a denial (fail closed): a paid request
 * must never happen without a recorded "allowed".
 */

export type QuotaDenial = "minute" | "day" | "global_day" | "global_month" | "unavailable";

export type QuotaDecision =
  { allowed: true } | { allowed: false; reason: QuotaDenial; retryAfterSeconds: number };

export interface QuotaRpcResult {
  data: unknown;
  error: unknown;
}

export interface QuotaRpcArgs {
  p_subject: string;
  p_minute_limit: number;
  p_day_limit: number;
  p_global_day_limit: number;
  p_global_month_limit: number;
}

export type ConsumeRpc = (args: QuotaRpcArgs) => Promise<QuotaRpcResult>;

const REASONS = new Set(["minute", "day", "global_day", "global_month"]);

export async function consumeQuota(
  identity: Identity,
  limits: QuotaLimits,
  rpc: ConsumeRpc,
): Promise<QuotaDecision> {
  try {
    const { data, error } = await rpc({
      p_subject: identity.subject,
      p_minute_limit: identity.kind === "user" ? limits.userMinute : limits.guestMinute,
      p_day_limit: identity.kind === "user" ? limits.userDay : limits.guestDay,
      p_global_day_limit: limits.globalDay,
      p_global_month_limit: limits.globalMonth,
    });
    if (error) return unavailable();
    const row: unknown = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") return unavailable();
    const { allowed, reason, retry_after_seconds } = row as Record<string, unknown>;
    if (allowed === true) return { allowed: true };
    if (allowed === false && typeof reason === "string" && REASONS.has(reason)) {
      const seconds = Number(retry_after_seconds);
      return {
        allowed: false,
        reason: reason as QuotaDenial,
        retryAfterSeconds: Number.isFinite(seconds) && seconds >= 1 ? Math.ceil(seconds) : 60,
      };
    }
    return unavailable();
  } catch {
    return unavailable();
  }
}

function unavailable(): QuotaDecision {
  return { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };
}

/** Production RPC: the server-only service-role client, loaded lazily so it never reaches the browser. */
export const supabaseConsumeRpc: ConsumeRpc = async (args) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The generated database types predate migration 6, so the function is not in them yet.
  const admin = supabaseAdmin as unknown as {
    rpc(name: string, args: QuotaRpcArgs): PromiseLike<QuotaRpcResult>;
  };
  const { data, error } = await admin.rpc("consume_ai_search_quota", args);
  return { data, error };
};
