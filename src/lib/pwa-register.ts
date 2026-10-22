/**
 * The only place the app's service worker is managed.
 *
 * The worker (/sw.js) is generated after the build by scripts/sw/build-sw.mjs and only exists in
 * builds where scripts/sw/flag.mjs says so (Preview builds; Production stays off until the Preview
 * is accepted). In every other build there is no /sw.js and nothing registers: the app only removes
 * a previously registered Verse Snap worker and its caches, if a browser still has them.
 *
 * Recovery: opening any page with ?sw=off unregisters the worker and deletes its caches.
 * The refused contexts below still apply: a worker must never run in dev or Lovable preview
 * contexts, because it is browser-held state that could keep serving stale pages.
 */

export const SW_URL = "/sw.js";

/** True only in builds that ship the worker (see scripts/sw/flag.mjs). */
export const OFFLINE_ENABLED = import.meta.env["VITE_OFFLINE_SW"] === "true";

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
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("vs-")).map((n) => caches.delete(n)));
  } catch {
    /* best effort cleanup */
  }
}

/**
 * An installed app can stay open for days, so ask for a newer worker when it comes back to the
 * foreground or the connection returns (a deployment then reaches it without a reinstall).
 */
function keepWorkerFresh(registration: ServiceWorkerRegistration): void {
  const check = () => void registration.update().catch(() => undefined);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("online", check);
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
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    keepWorkerFresh(registration);
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    /* offline support is best effort; the app works without it */
  }
}
