/**
 * The only place the app's service worker is registered.
 *
 * The worker must never run in dev or Lovable preview contexts: it is
 * browser-held state and could keep serving stale HTML after the code
 * changes. In any refused context we actively unregister a matching worker
 * instead, so a previously registered one is cleaned up.
 */

const SW_URL = "/sw.js";

function isRefusedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  if (typeof window === "undefined") return true;
  if (window.self !== window.top) return true;
  const { hostname, search } = window.location;
  if (hostname.startsWith("id-preview--") || hostname.startsWith("preview--")) return true;
  if (hostname === "lovableproject.com" || hostname.endsWith(".lovableproject.com")) return true;
  if (hostname === "lovableproject-dev.com" || hostname.endsWith(".lovableproject-dev.com"))
    return true;
  if (hostname === "beta.lovable.dev" || hostname.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(search).has("sw")) return true; // ?sw=off kill switch
  return false;
}

async function unregisterAppWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.active?.scriptURL.endsWith(SW_URL))
        .map((registration) => registration.unregister()),
    );
  } catch {
    /* best effort cleanup */
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (isRefusedContext()) {
    await unregisterAppWorker();
    return;
  }
  try {
    await navigator.serviceWorker.register(SW_URL);
  } catch {
    /* offline support is best effort; the app works without it */
  }
}
