// Offline app shell (stage 2) against the PRODUCTION build, in a real browser: cold start with the
// server stopped and the network off, downloaded chapters and verses, navigation, an update, the
// ?sw=off recovery and a build without the worker.
//   NITRO_PRESET=node-server OFFLINE_SW=1 npm run build && npm run test:e2e:offline-sw
// Starts the built server itself (node .output/server/index.mjs) on port 8094 and stops it to go
// offline. Needs the real internet once, to download the WEB text (about 6 MB).
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.E2E_SERVER_PORT ?? 8094);
process.env.E2E_BASE ??= `http://127.0.0.1:${PORT}`;
const outputDir = path.resolve(".output");
const swFile = path.join(outputDir, "public", "sw.js");
if (!fs.existsSync(swFile)) {
  console.error(
    "No .output/public/sw.js. Build first with: NITRO_PRESET=node-server OFFLINE_SW=1 npm run build",
  );
  process.exit(2);
}
const originalSw = fs.readFileSync(swFile, "utf8");

// Like Vercel: files in the built static folder are served from disk first (so /sw.js, written after
// the build, is found); every other request goes to the app's own server.
const TYPES = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};
const publicDir = path.join(outputDir, "public");
let server;
let front;
const startServer = async () => {
  server = spawn(process.execPath, [path.join(outputDir, "server", "index.mjs")], {
    env: { ...process.env, PORT: String(PORT + 1), HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  front = http.createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = path.join(publicDir, pathname);
    if (
      pathname !== "/" &&
      file.startsWith(publicDir) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile()
    ) {
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "cache-control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: PORT + 1,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise((resolve) => front.listen(PORT, "127.0.0.1", resolve));
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(process.env.E2E_BASE, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) return;
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
};
const killServer = () => {
  try {
    if (server) {
      if (process.platform === "win32")
        execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" });
      else server.kill("SIGKILL");
    }
  } catch {
    /* already stopped */
  }
  server = undefined;
};
const stopServer = async () => {
  killServer();
  front?.closeAllConnections?.();
  await new Promise((resolve) => (front ? front.close(resolve) : resolve()));
  front = undefined;
  await new Promise((r) => setTimeout(r, 500));
};
process.on("exit", () => {
  try {
    fs.writeFileSync(swFile, originalSw);
  } catch {
    /* ignore */
  }
  killServer();
});

await startServer();
const { openBrowser } = await import("./lib.mjs");
const b = await openBrowser();
const { ev, waitFor, go, viewport, send, check, summary, sleep, state } = b;

await send("Network.enable");
await send("ServiceWorker.enable");
await viewport(360, 740);

const text = () => ev("document.body.innerText");
const click = (selector, label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => (x.getAttribute('aria-label') || x.innerText).replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true; })()`,
  );
const cacheNames = () => ev("caches.keys()");
const swState = () =>
  ev(
    `navigator.serviceWorker.getRegistration().then((r) => r ? ({ active: !!r.active, waiting: !!r.waiting, controlled: !!navigator.serviceWorker.controller }) : null)`,
  );
const hydrationErrors = () =>
  state.errors.filter((e) => /hydrat|did not match|Minified React error #(418|423|425)/i.test(e));

// ================= install, online =================
await go("/", "document.body.innerText.length > 40");
const ready = await waitFor(
  "navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active))",
  20000,
);
check("the service worker registers and activates on the production build", ready);
await go("/", "document.body.innerText.length > 40"); // a controlled load
check(
  "the page is controlled by the worker after a reload",
  (await swState())?.controlled === true,
);
const names = await cacheNames();
check(
  "one versioned app cache exists",
  names.filter((n) => n.startsWith("vs-app-")).length === 1,
  JSON.stringify(names),
);
const precached = await ev(
  `caches.keys().then(async (k) => { const c = await caches.open(k.find((n) => n.startsWith('vs-app-'))); const keys = (await c.keys()).map((r) => new URL(r.url).pathname); return { n: keys.length, shell: keys.includes('/__vs_shell'), js: keys.some((x) => x.endsWith('.js')), css: keys.some((x) => x.endsWith('.css')), manifest: keys.includes('/manifest.webmanifest'), bible: keys.some((x) => /helloao|bible/i.test(x)) }; })`,
);
check(
  "the cache holds the shell, JS, CSS and manifest and no Bible text",
  precached.shell && precached.js && precached.css && precached.manifest && !precached.bible,
  JSON.stringify(precached),
);

// ================= the iPhone install guide =================
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const guide = () => ev("!!document.querySelector('section[aria-label^=\"Install Verse Snap\"]')");
const userAgent = (userAgent, platform) =>
  send("Emulation.setUserAgentOverride", { userAgent, platform });
await go("/", "document.body.innerText.length > 40");
check("a desktop browser sees no install guide", !(await guide()));
await userAgent(ANDROID_CHROME, "Linux armv8l");
await go("/", "document.body.innerText.length > 40");
check("Android sees no install guide (it has its own install prompt)", !(await guide()));
await userAgent(IPHONE_SAFARI, "iPhone");
await go("/", "document.body.innerText.length > 40");
await waitFor("!!document.querySelector('section[aria-label^=\"Install Verse Snap\"]')", 5000);
check("Safari on an iPhone sees the guide on first open, with nothing downloaded", await guide());
const guideText = await ev(
  "document.querySelector('section[aria-label^=\"Install Verse Snap\"]').innerText",
);
check(
  "the guide explains Share, then Add to Home Screen, and is not a popup",
  /Share/.test(guideText) &&
    /Add to Home Screen/.test(guideText) &&
    !(await ev("!!document.querySelector('[role=dialog]')")),
  guideText,
);
check(
  "the guide fits a 360px screen without sideways scrolling",
  await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth"),
);
await b.shot("ios-guide.png");
await userAgent(IPHONE_SAFARI, "iPhone");
const standaloneScript = await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "Object.defineProperty(navigator, 'standalone', { get: () => true });",
});
await go("/", "document.body.innerText.length > 40");
await sleep(500);
check("an iPhone app already on the Home Screen (standalone) sees no guide", !(await guide()));
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: standaloneScript.identifier });
await go("/", "document.body.innerText.length > 40");
await waitFor("!!document.querySelector('section[aria-label^=\"Install Verse Snap\"]')", 5000);
await click("button", "Dismiss install tip");
check("Dismiss removes the guide", !(await guide()));
await go("/", "document.body.innerText.length > 40");
await sleep(500);
check("a dismissed guide does not come back on the next visit", !(await guide()));
await send("Emulation.setUserAgentOverride", { userAgent: "" });

// ================= download WEB =================
await go("/settings", "document.body.innerText.includes('Bible translation')");
await click("button", "Bible translation");
await waitFor("!!document.querySelector('[role=dialog] fieldset')", 8000);
await click("[role=dialog] button", "Download World English Bible");
const done = await waitFor(
  "!!document.querySelector('[role=dialog] [role=img][aria-label*=\"is downloaded for offline\"]')",
  150000,
);
check("WEB downloads to the device", done);
await go("/", "document.body.innerText.length > 40");
await sleep(500);
check("downloading a translation does not bring a dismissed guide back", !(await guide()));
await ev("localStorage.setItem('vs.test.guest-marker', 'kept')");

// ================= cold offline start =================
await stopServer();
await send("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
});
await send("ServiceWorker.stopAllWorkers");
await send("Page.navigate", { url: "about:blank" });
await sleep(500);

state.errors = [];
await go("/chapter/WEB/john/3", "document.querySelectorAll('[data-verse-block]').length > 20");
check(
  "cold offline: a downloaded chapter opens with its text",
  (await text()).includes("God so loved"),
  (await text()).slice(0, 200),
);
check(
  "the page is the app, not a browser error page",
  (await ev("!!document.querySelector('#root, body > div')")) && !(await text()).includes("ERR_"),
);
check(
  "no hydration errors on a cold offline start",
  hydrationErrors().length === 0,
  JSON.stringify(state.errors),
);
check(
  "the address is still the chapter's (the router rendered it, not the shell's own page)",
  (await ev("location.pathname")) === "/chapter/WEB/john/3",
);
await go("/verse/WEB/john/3/16", "document.body.innerText.includes('God so loved')");
check("cold offline: a downloaded verse opens", (await text()).includes("God so loved"));
check(
  "no hydration errors on the verse page",
  hydrationErrors().length === 0,
  JSON.stringify(state.errors),
);
await go("/", "document.body.innerText.length > 40");
check("cold offline: Home opens", (await text()).length > 40);
const offlineNote = await ev("document.querySelector('[role=status]')?.innerText ?? ''");
check(
  "Home says it is offline, names the downloaded Bible and does not promise search or sync",
  /offline/i.test(offlineNote) &&
    /WEB is downloaded/.test(offlineNote) &&
    /Search, cross-references and account saving need a connection/.test(offlineNote) &&
    !(await ev("!!document.querySelector('[role=dialog]')")),
  offlineNote,
);
await b.shot("offline-home.png");
await go("/books", "document.body.innerText.length > 40");
check(
  "cold offline: the books page opens",
  /Matthew|John/.test(await text()),
  (await text()).slice(0, 200),
);
await go("/settings", "document.body.innerText.length > 40");
check("cold offline: Settings opens", (await text()).length > 40);
await go("/saved", "document.body.innerText.length > 40");
check("cold offline: Saved opens (guest data stays on the device)", (await text()).length > 20);
check(
  "guest data on the device is untouched",
  (await ev("localStorage.getItem('vs.test.guest-marker')")) === "kept",
);

// ================= navigation while offline =================
await go("/chapter/WEB/john/3", "document.querySelectorAll('[data-verse-block]').length > 20");
const nextClicked = await ev(
  `(() => { const a = [...document.querySelectorAll('a, button')].find((x) => /next chapter/i.test(x.getAttribute('aria-label') || '')); if (!a) return false; a.click(); return true; })()`,
);
check("a Next chapter control exists", nextClicked);
await waitFor("location.pathname === '/chapter/WEB/john/4'", 8000);
await waitFor("document.querySelectorAll('[data-verse-block]').length > 5", 8000);
check(
  "offline: Next chapter shows the next downloaded chapter",
  (await ev("location.pathname")) === "/chapter/WEB/john/4" &&
    (await ev("document.querySelectorAll('[data-verse-block]').length")) > 5,
);
await go("/chapter/WEB/genesis/1", "document.querySelectorAll('[data-verse-block]').length > 20");
check("offline: another book opens", (await text()).includes("In the beginning"));
await go(
  "/chapter/WEB/revelation/22",
  "document.querySelectorAll('[data-verse-block]').length > 10",
);
check(
  "offline: the last chapter of the Bible opens",
  (await ev("document.querySelectorAll('[data-verse-block]').length")) > 10,
);
check(
  "no hydration errors while navigating offline",
  hydrationErrors().length === 0,
  JSON.stringify(state.errors),
);

// ================= not downloaded, offline =================
await go("/chapter/KJAV/john/3", "document.body.innerText.includes('Connection problem')");
check(
  "offline: an undownloaded translation says so and offers the downloaded one",
  (await text()).includes("Read in WEB"),
  (await text()).slice(0, 300),
);

// ================= back online, update =================
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
// A new build: same files, a new worker version that also lists one more existing file.
const bumped = originalSw
  .replace(/const VERSION = "[^"]+"/, `const VERSION = "zzzzzzzz-update1"`)
  .replace('"/favicon.ico"', '"/favicon.ico",\n  "/robots.txt"');
fs.writeFileSync(swFile, bumped);
await startServer();
await go("/", "document.body.innerText.length > 40");
await ev("navigator.serviceWorker.getRegistration().then((r) => r.update())");
const updated = await waitFor(
  "caches.keys().then((k) => k.some((n) => n === 'vs-app-zzzzzzzz-update1'))",
  20000,
);
check("back online: a new worker version installs and fills its own cache", updated);
await sleep(1000);
const afterUpdate = await cacheNames();
check(
  "the previous version's cache is kept for pages still open (two app caches)",
  afterUpdate.filter((n) => n.startsWith("vs-app-")).length === 2,
  JSON.stringify(afterUpdate),
);
fs.writeFileSync(
  swFile,
  originalSw.replace(/const VERSION = "[^"]+"/, `const VERSION = "zzzzzzzz-update2"`),
);
await ev("navigator.serviceWorker.getRegistration().then((r) => r.update())");
await waitFor("caches.keys().then((k) => k.includes('vs-app-zzzzzzzz-update2'))", 20000);
await sleep(1000);
const afterSecond = await cacheNames();
check(
  "a third version removes the oldest cache; only two remain",
  afterSecond.filter((n) => n.startsWith("vs-app-")).length === 2 &&
    !afterSecond.some((n) => n.startsWith("vs-app-") && !/zzzz/.test(n)),
  JSON.stringify(afterSecond),
);
check(
  "online navigation is served by the network, not the cached shell",
  await ev(
    `fetch('/chapter/WEB/john/3', { headers: { accept: 'text/html' } }).then((r) => r.text()).then((t) => t.includes('John 3'))`,
  ),
);

// ================= recovery =================
await go("/?sw=off", "document.body.innerText.length > 40");
const gone = await waitFor(
  "navigator.serviceWorker.getRegistration().then((r) => !r) && caches.keys().then((k) => k.filter((n) => n.startsWith('vs-')).length === 0)",
  15000,
);
check(
  "?sw=off unregisters the worker and deletes its caches",
  gone,
  JSON.stringify(await cacheNames()),
);
check(
  "?sw=off leaves the downloaded Bible alone",
  (await ev(
    `new Promise((resolve) => { const o = indexedDB.open('versesnap-offline'); o.onerror = () => resolve(false); o.onsuccess = () => { const tx = o.result.transaction(['chapters'], 'readonly'); const c = tx.objectStore('chapters').count(); tx.oncomplete = () => resolve(c.result > 1000); }; })`,
  )) === true,
);

summary();
