import type { ScriptureSearchResult } from "./ai/types";

/**
 * The free (no AI, no cost) Bible text search.
 *
 * The full-text index is not installed yet (hybrid search, Phase B). Until it is, a descriptive search
 * ends in a plain "being prepared" state. Nothing here uses the network, a key, or an AI provider,
 * so pressing Enter or Search can never spend money.
 */

export const FREE_SEARCH_PREPARING_MESSAGE = "Free Bible search is being prepared.";
export const SMART_SEARCH_LABEL = "Try Smart Search";

export type FreeSearchStatus = "preparing" | "ready";

export interface FreeSearchOutcome {
  status: FreeSearchStatus;
  results: ScriptureSearchResult[];
}

/** Whether the free index can answer. Becomes dynamic when the index and server search exist. */
export function getFreeSearchStatus(): FreeSearchStatus {
  return "preparing";
}

/** Starts the free search for a descriptive query. Pure and synchronous while the index is unavailable. */
export function startFreeSearch(_query: string): FreeSearchOutcome {
  return { status: getFreeSearchStatus(), results: [] };
}
