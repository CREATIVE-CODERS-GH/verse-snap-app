import type { QueryClient } from "@tanstack/react-query";
import { AI_SEARCH_QUERY_KEY } from "./bible/ai/search-query";

/**
 * What the app does when Supabase reports an authentication event.
 *
 * supabase-js emits SIGNED_IN again every time a tab with a session becomes visible, even though
 * nothing changed. Treating that as a real sign-in refetched every active query, including the paid
 * AI search. Rules now:
 *  - INITIAL_SESSION only records who is signed in;
 *  - SIGNED_IN for the same person as before does nothing;
 *  - a real sign-in, a profile update, or a sign-out refreshes user-specific data;
 *  - paid AI search results are never invalidated by an auth event.
 */

export interface AuthEventPlan {
  invalidateRouter: boolean;
  invalidateQueries: boolean;
  /** The user id to remember after this event. */
  userId: string | null;
}

export function planAuthEvent(
  event: string,
  userId: string | null,
  lastUserId: string | null,
): AuthEventPlan {
  switch (event) {
    case "INITIAL_SESSION":
      return { invalidateRouter: false, invalidateQueries: false, userId };
    case "SIGNED_IN":
      return userId !== null && userId === lastUserId
        ? { invalidateRouter: false, invalidateQueries: false, userId }
        : { invalidateRouter: true, invalidateQueries: true, userId };
    case "USER_UPDATED":
      return { invalidateRouter: true, invalidateQueries: true, userId };
    case "SIGNED_OUT":
      return { invalidateRouter: true, invalidateQueries: false, userId: null };
    default:
      return { invalidateRouter: false, invalidateQueries: false, userId: lastUserId };
  }
}

/** Refreshes everything that depends on who is signed in, except paid AI search results. */
export function invalidateUserQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== AI_SEARCH_QUERY_KEY,
  });
}
