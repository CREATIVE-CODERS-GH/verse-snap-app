import type { QueryClient } from "@tanstack/react-query";
import {
  readSavedSearch,
  saveSearch,
  searchKey,
  SEARCH_CACHE_TTL_MS,
  type SavedSearch,
  type StorageLike,
} from "./search-session";
import type { ScriptureSearchResponse } from "./types";

/**
 * Query behaviour for AI search on the browser side. Every rule here exists so that nothing except an
 * explicit user action can cause a paid request, and so a good result is never lost:
 *  - the query only runs when preferences have loaded AND (a saved result exists OR the user asked);
 *  - a saved result is used as the data, so reloads and restarts cost nothing;
 *  - no refetch on mount, window focus or reconnect; results never go stale on their own;
 *  - concurrent requests for the same search share one request;
 *  - a failed or refused response never replaces a successful one for the same search.
 */

export const AI_SEARCH_QUERY_KEY = "scripture-search";

export function aiSearchQueryKey(description: string, translation: string) {
  return [AI_SEARCH_QUERY_KEY, description, translation] as const;
}

/** Safe to log: event names and lengths only, never the words, an address, a token or a key. */
export interface SearchDiagnostic {
  event:
    | "request"
    | "restored_from_session"
    | "waiting_for_user"
    | "duplicate_blocked"
    | "kept_previous_result";
  translation: string;
  queryLength: number;
}

/** Development-only console diagnostics. Nothing is logged in production builds. */
export function logSearchDiagnostic(diagnostic: SearchDiagnostic): void {
  if (import.meta.env.DEV) console.debug("[ai-search:client]", JSON.stringify(diagnostic));
}

export type RunSearch = (query: string, translation: string) => Promise<ScriptureSearchResponse>;

export interface PaidSearchDeps {
  run: RunSearch;
  storage: StorageLike | undefined;
  log?: (diagnostic: SearchDiagnostic) => void;
  now?: () => number;
}

const inFlight = new Map<string, Promise<ScriptureSearchResponse>>();

/** For tests. */
export function resetInFlightSearches(): void {
  inFlight.clear();
}

function note(
  deps: PaidSearchDeps,
  event: SearchDiagnostic["event"],
  description: string,
  translation: string,
): void {
  deps.log?.({ event, translation, queryLength: description.length });
}

/**
 * The only function that sends a paid search from the browser. Joins an identical request that is
 * already running instead of starting another, saves successes, and refuses to let a failure
 * overwrite an earlier success.
 */
export function fetchPaidSearch(
  queryClient: QueryClient,
  deps: PaidSearchDeps,
  description: string,
  translation: string,
): Promise<ScriptureSearchResponse> {
  const key = searchKey(description, translation);
  const running = inFlight.get(key);
  if (running) {
    note(deps, "duplicate_blocked", description, translation);
    return running;
  }

  const promise = (async () => {
    note(deps, "request", description, translation);
    const response = await deps.run(description, translation);
    const now = deps.now?.() ?? Date.now();
    if (!response.failed) {
      saveSearch(deps.storage, description, translation, response, now);
      return response;
    }
    const previous =
      queryClient.getQueryData<ScriptureSearchResponse>(
        aiSearchQueryKey(description, translation),
      ) ?? readSavedSearch(deps.storage, description, translation, now)?.response;
    if (previous && !previous.failed && previous.results.length > 0) {
      note(deps, "kept_previous_result", description, translation);
      return previous;
    }
    return response;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

export interface AiSearchOptionsInput {
  queryClient: QueryClient;
  deps: PaidSearchDeps;
  description: string;
  translation: string;
  /** Preferences (including the translation) have finished loading. */
  ready: boolean;
  /** The user asked for this search in the current page session. */
  allowed: boolean;
  /** A valid saved result for this search, if any. */
  saved: SavedSearch | null;
}

export function canRunAiSearch(
  input: Pick<AiSearchOptionsInput, "description" | "ready" | "allowed" | "saved">,
): boolean {
  return input.ready && input.description.length > 0 && (input.allowed || input.saved !== null);
}

/** Options for useQuery. */
export function aiSearchQueryOptions(input: AiSearchOptionsInput) {
  const { queryClient, deps, description, translation, saved } = input;
  return {
    queryKey: aiSearchQueryKey(description, translation),
    queryFn: () => fetchPaidSearch(queryClient, deps, description, translation),
    enabled: canRunAiSearch(input),
    ...(saved ? { initialData: saved.response, initialDataUpdatedAt: saved.savedAt } : {}),
    staleTime: Infinity,
    gcTime: SEARCH_CACHE_TTL_MS,
    refetchOnMount: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    retry: false as const,
  };
}
