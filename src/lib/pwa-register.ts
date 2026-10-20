/**
 * The only place the app's service worker is managed.
 *
 * OFFLINE SUPPORT IS CURRENTLY OFF. There is no service worker in the build yet (the earlier
 * vite-plugin-pwa setup never reached the deployed static output, so /sw.js returned 404 on
 * every page load). Until the real offline system ships, the app never registers a worker and
 * only removes a previously registered Verse Snap worker, if a browser still has one.
 *
 * To turn offline support on later: build a real /sw.js into the deployed static output, then set
 * OFFLINE_ENABLED to true. The refused contexts below still apply: a worker must never run in dev
 * or Lovable preview contexts, because it is browser-held state that could keep serving stale
 * pages after the code changes.
 */

export const SW_URL = "/sw.js";

/** Flip to true only once a real service worker is built and deployed (see Step 2 plan). */
export const OFFLINE_ENABLED = false;

export interface WorkerContext {
  prod: boolean;
  inFrame: boolean;
  hostname: string;
  search: string;
}

/** Contexts in which a worker must never run, even once offline support is enabled. */
export function isRefusedContext({ prod, inFrame, hostname, search }: WorkerContext): boolean {
  if (!prod || inFrame) return true;
  if (hostname.startsWith("id-preview--") || hostname.startsWith("preview--")) return true;
  if (hostname === "lovableproject.com" || hostname.endsWith(".lovableproject.com")) return true;
  if (hostname === "lovableproject-dev.com" || hostname.endsWith(".lovableproject-dev.com"))
    return true;
  if (hostname === "beta.lovable.dev" || hostname.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(search).has("sw")) return true; // ?sw=off kill switch
  return false;
}

export function shouldRegister(context: WorkerContext, enabled = OFFLINE_ENABLED): boolean {
  return enabled && !isRefusedContext(context);
}

/** True only for this app's own worker (same origin, /sw.js); other registrations are left alone. */
export function isAppWorker(scriptURL: string | undefined, origin: string): boolean {
  if (!scriptURL) return false;
  try {
    const url = new URL(scriptURL);
    return url.origin === origin && url.pathname === SW_URL;
  } catch {
    return false;
  }
}

async function unregisterAppWorker(origin: string): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => {
          const worker = registration.active ?? registration.waiting ?? registration.installing;
          return isAppWorker(worker?.scriptURL, origin);
        })
        .map((registration) => registration.unregister()),
    );
  } catch {
    /* best effort cleanup */
  }
}

/** Called once on startup: registers the worker when allowed, otherwise cleans up an old one. */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const context: WorkerContext = {
    prod: import.meta.env.PROD,
    inFrame: window.self !== window.top,
    hostname: window.location.hostname,
    search: window.location.search,
  };
  if (!shouldRegister(context)) {
    await unregisterAppWorker(window.location.origin);
    return;
  }
  try {
    await navigator.serviceWorker.register(SW_URL);
  } catch {
    /* offline support is best effort; the app works without it */
  }
}
