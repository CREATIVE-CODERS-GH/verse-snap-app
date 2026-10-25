/**
 * AI search configuration, read from server environment variables on every call so it
 * can be changed (or the feature switched off) without a code change.
 * Never import this from browser code.
 */

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface QuotaLimits {
  guestMinute: number;
  guestDay: number;
  userMinute: number;
  userDay: number;
  globalDay: number;
  globalMonth: number;
}

export interface AiSearchConfig {
  /** Master switch. Off unless AI_SEARCH_ENABLED is exactly "true". */
  enabled: boolean;
  provider: string;
  model: string;
  effort: ReasoningEffort;
  limits: QuotaLimits;
}

type Env = Record<string, string | undefined>;

/** Development defaults: deliberately low. Raise them with the AI_LIMIT_* variables. */
export const DEFAULT_LIMITS: QuotaLimits = {
  guestMinute: 3,
  guestDay: 15,
  userMinute: 6,
  userDay: 60,
  globalDay: 300,
  globalMonth: 5000,
};

export const DEFAULT_MODEL = "gpt-6-luna";
export const DEFAULT_EFFORT: ReasoningEffort = "none";

const EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium", "high"];

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d{1,9}$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  return parsed >= 1 ? parsed : fallback;
}

export function readAiSearchConfig(env: Env = process.env): AiSearchConfig {
  const effort = env["AI_SEARCH_EFFORT"]?.trim().toLowerCase();
  return {
    enabled: env["AI_SEARCH_ENABLED"]?.trim().toLowerCase() === "true",
    provider: env["AI_PROVIDER"]?.trim().toLowerCase() || "openai",
    model: env["AI_SEARCH_MODEL"]?.trim() || DEFAULT_MODEL,
    effort: EFFORTS.find((item) => item === effort) ?? DEFAULT_EFFORT,
    limits: {
      guestMinute: positiveInt(env["AI_LIMIT_GUEST_MINUTE"], DEFAULT_LIMITS.guestMinute),
      guestDay: positiveInt(env["AI_LIMIT_GUEST_DAY"], DEFAULT_LIMITS.guestDay),
      userMinute: positiveInt(env["AI_LIMIT_USER_MINUTE"], DEFAULT_LIMITS.userMinute),
      userDay: positiveInt(env["AI_LIMIT_USER_DAY"], DEFAULT_LIMITS.userDay),
      globalDay: positiveInt(env["AI_LIMIT_GLOBAL_DAY"], DEFAULT_LIMITS.globalDay),
      globalMonth: positiveInt(env["AI_LIMIT_GLOBAL_MONTH"], DEFAULT_LIMITS.globalMonth),
    },
  };
}
