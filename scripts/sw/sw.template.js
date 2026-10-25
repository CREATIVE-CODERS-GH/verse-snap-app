/* Verse Snap service worker. Generated into the build by scripts/sw/build-sw.mjs; edit this template.
 *
 * What it does, and nothing more:
 *  - precaches the built JS/CSS, icons and manifest, plus one copy of the app's HTML document with
 *    no page content in it (the "shell", the /offline-shell route), so a closed app can start and hydrate with no connection;
 *  - navigations go to the network first; only when that fails (offline, timeout, 5xx) the shell is
 *    served, and the app's router renders whatever the address bar says;
 *  - never touches the Bible text (that lives in IndexedDB), Supabase, server functions or any
 *    other request: those are not handled here, so they behave exactly as without a worker.
 * Cache names are versioned per build; the current and the previous build are kept so a page that
 * is still open across a deployment can finish loading its lazy chunks.
 */
const VERSION = "__VERSION__";
const PREFIX = "vs-app-";
const CACHE = PREFIX + VERSION;
const FONT_CACHE = "vs-fonts-v1";
const PRECACHE = __PRECACHE__;
const SHELL_KEY = "/__vs_shell";
const NAV_TIMEOUT_MS = 4000;
const STATIC_PREFIXES = ["/assets/", "/icons/", "/stitch/"];
const STATIC_FILES = ["/favicon.ico", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error("precache failed: " + url);
          await cache.put(url, response);
        }),
      );
      // The shell: the app's own HTML with no page content, fetched fresh, kept only if it is the real document.
      const shell = await fetch("/offline-shell", {
        cache: "reload",
        headers: { accept: "text/html" },
      });
      const type = shell.headers.get("content-type") || "";
      if (!shell.ok || !type.includes("text/html")) throw new Error("shell unavailable");
      await cache.put(SHELL_KEY, shell);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith(PREFIX)).sort();
      // Names sort by build time (the version starts with a base-36 timestamp): keep the newest two.
      const keep = new Set(names.slice(-2).concat(CACHE));
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

function isStatic(url) {
  return (
    STATIC_FILES.includes(url.pathname) || STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))
  );
}

async function shellResponse() {
  const cached = await caches.match(SHELL_KEY);
  return cached || Response.error();
}

async function navigate(request) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.status >= 502 && response.status <= 504) return await shellResponse();
    return response;
  } catch {
    return await shellResponse();
  }
}

async function staticAsset(request, url) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && url.pathname.startsWith("/assets/")) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// Web fonts are public files from Google; stale-while-revalidate keeps the type right offline.
async function font(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(font(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  if (isStatic(url)) event.respondWith(staticAsset(request, url));
});
