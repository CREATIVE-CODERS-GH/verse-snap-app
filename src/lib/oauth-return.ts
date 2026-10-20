/**
 * Bookkeeping for the Google (OAuth) round trip.
 *
 * Starting Google sign-in navigates away from the app. If the person cancels, or
 * Google/Supabase rejects the attempt, Supabase sends them back to the app with
 * `error` parameters in the URL and supabase-js ignores them. We remember that an
 * attempt was started so that, on return, a failure can be explained without
 * mistaking other auth errors (for example an expired password-reset link) for it.
 */

const PENDING_KEY = "versesnap.oauth.pending";
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

export interface OAuthReturnError {
  /** True when the person backed out at Google rather than a failure occurring. */
  cancelled: boolean;
}

export function markOAuthPending(): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: failures just won't be explained */
  }
}

export function clearOAuthPending(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function hasRecentPending(): boolean {
  try {
    const started = Number(window.sessionStorage.getItem(PENDING_KEY));
    return Number.isFinite(started) && started > 0 && Date.now() - started < PENDING_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function readParams(): URLSearchParams {
  const merged = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("=")) {
    for (const [key, value] of new URLSearchParams(hash)) merged.set(key, value);
  }
  return merged;
}

let consumed: OAuthReturnError | null | undefined;

/**
 * Called when the app loads. Returns the failure to report if this page load is
 * the return from a failed Google attempt, and always ends the attempt. The
 * result is remembered so a repeated call (for example a development remount)
 * reports the same answer. Error parameters are removed from the address bar
 * when they were ours.
 */
export function consumeOAuthReturnError(): OAuthReturnError | null {
  if (typeof window === "undefined") return null;
  if (consumed !== undefined) return consumed;

  const pending = hasRecentPending();
  clearOAuthPending();
  consumed = null;
  if (!pending) return consumed;

  const error = readParams().get("error");
  if (!error) return consumed;

  const search = new URLSearchParams(window.location.search);
  for (const key of ["error", "error_code", "error_description"]) search.delete(key);
  const query = search.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`,
  );

  consumed = { cancelled: error === "access_denied" };
  return consumed;
}
