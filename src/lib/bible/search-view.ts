import type { AiStatus } from "./ai/types";
import type { FreeSearchErrorKind, FreeSearchStatus } from "./free-search";

/**
 * Which state the search page shows. Pure and independent of React so the distinctions the approved
 * designs need (initial, unindexed, loading, no results, network error, Smart Search unavailable)
 * are tested without a browser.
 */
export type SearchView =
  | { kind: "initial" }
  /** A vague, too long or nonsense query: say what to change; never offers AI. */
  | { kind: "hint"; message: string }
  /** Preferences are still loading: show nothing yet. */
  | { kind: "idle" }
  /** A description, and the free full-text index is not installed yet. */
  | { kind: "unindexed" }
  /** Free search is running. */
  | { kind: "free_loading" }
  | { kind: "free_results" }
  /** Free search searched the indexed editions and found nothing. */
  | { kind: "free_no_results" }
  /** Free search itself failed; the person can retry it. */
  | { kind: "free_error"; reason: FreeSearchErrorKind }
  /** Smart Search (explicitly requested) is running. */
  | { kind: "loading" }
  | { kind: "results" }
  /** Smart Search ran and found no verses. */
  | { kind: "no_results" }
  /** The request could not reach the server. */
  | { kind: "network_error" }
  /** Smart Search is switched off or the AI provider is unavailable. */
  | { kind: "smart_unavailable" }
  | { kind: "smart_limit"; message: string }
  | { kind: "smart_failed"; message: string };

export interface SearchViewInput {
  hasSubmitted: boolean;
  /** Whether the submitted text is a real description that Smart Search could be offered for. */
  canTryAi: boolean;
  /** Whether the text can be searched at all (one word is enough). Defaults to `canTryAi`. */
  canSearch?: boolean | undefined;
  /** Router message for refine / nonsense queries, otherwise null. */
  stopMessage: string | null;
  ready: boolean;
  /** Smart Search may run: the person asked for it, or a saved result exists. */
  canRun: boolean;
  isPending: boolean;
  isError: boolean;
  data?:
    | {
        resultCount: number;
        failed?: boolean | undefined;
        aiStatus?: AiStatus | undefined;
        errorMessage?: string | undefined;
      }
    | undefined;
  freeStatus: FreeSearchStatus;
  /**
   * The state of the free search request. Omitted before free search is wired in, in which case a
   * description shows "unindexed" while the index is being prepared.
   */
  free?:
    | {
        isPending: boolean;
        isError: boolean;
        errorKind?: FreeSearchErrorKind | undefined;
        resultCount: number;
      }
    | undefined;
}

export function deriveSearchView(input: SearchViewInput): SearchView {
  if (!input.hasSubmitted) return { kind: "initial" };
  if (!(input.canSearch ?? input.canTryAi)) {
    return input.stopMessage ? { kind: "hint", message: input.stopMessage } : { kind: "initial" };
  }
  if (!input.ready) return { kind: "idle" };
  if (!input.canRun) return freeView(input);

  const count = input.data?.resultCount ?? 0;
  // A good result is never hidden by a later failure.
  if (count > 0) return { kind: "results" };
  if (input.isError) return { kind: "network_error" };
  if (input.data?.failed) {
    const message = input.data.errorMessage ?? "Couldn't complete that search.";
    switch (input.data.aiStatus) {
      case "off":
      case "unavailable":
        return { kind: "smart_unavailable" };
      case "limit":
        return { kind: "smart_limit", message };
      default:
        return { kind: "smart_failed", message };
    }
  }
  if (input.data) return { kind: "no_results" };
  return input.isPending ? { kind: "loading" } : { kind: "idle" };
}

/** Free search is what Enter and Search start; Smart Search states only follow an explicit request. */
function freeView(input: SearchViewInput): SearchView {
  const free = input.free;
  if (!free) return input.freeStatus === "preparing" ? { kind: "unindexed" } : { kind: "idle" };
  if (free.resultCount > 0) return { kind: "free_results" };
  if (free.isError) return { kind: "free_error", reason: free.errorKind ?? "failed" };
  if (free.isPending) return { kind: "free_loading" };
  return input.freeStatus === "preparing" ? { kind: "unindexed" } : { kind: "free_no_results" };
}
