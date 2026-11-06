// YouVersion-backed editions (NIV, AMP) in the Bible Reader, driven in a real browser.
// Needs the app running WITH the feature flag and a server-side key:
//   VITE_YOUVERSION_TRANSLATIONS=true npm run dev -- --port 8091     (YOUVERSION_APP_KEY in .env.local)
//   npm run test:e2e:youversion
// Makes a handful of read-only chapter requests (no bulk fetching). Never prints licensed text:
// it only checks counts and short markers.
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, send, on, check, summary, state } = b;

await viewport(390, 800);
await send("Network.enable");
const requested = [];
on("Network.requestWillBeSent", (params) => {
  requested.push({ url: params.request.url, headers: Object.keys(params.request.headers ?? {}) });
});

const blocks = "document.querySelectorAll('[data-verse-block]').length";
const count = () => ev(blocks);
const notice = () =>
  ev("document.querySelector('[data-testid=\"publisher-notice\"]')?.innerText ?? ''");

// 1. HelloAO is unchanged: KJAV loads and shows no publisher notice.
await go("/chapter/KJAV/john/3", `${blocks} > 20`);
check("KJAV John 3 loads 36 verses through HelloAO", (await count()) === 36, String(await count()));
check("KJAV shows no publisher notice", (await notice()) === "");

// 2. NIV chapter.
await go(
  "/chapter/NIV/john/3",
  `${blocks} > 20 || /isn.t available|trouble|couldn.t/i.test(document.body.innerText)`,
);
check("NIV John 3 loads 36 verses", (await count()) === 36, String(await count()));
const niv = await notice();
check(
  "NIV shows the Biblica notice and link",
  /Biblica/.test(niv) && /New International Version/.test(niv),
);
check(
  "NIV notice links to the publisher",
  await ev(
    "document.querySelector('[data-testid=\"publisher-notice\"] a')?.href === 'https://www.biblica.com/'",
  ),
);
check(
  "NIV verse 16 is present and numbered",
  await ev("/so loved/.test(document.querySelector('[data-verse-block=\"16\"]')?.innerText ?? '')"),
);
check("NIV page has no console errors", state.errors.length === 0, state.errors.join(" | "));

// 3. AMP chapter.
await go(
  "/chapter/AMP/john/3",
  `${blocks} > 20 || /isn.t available|trouble|couldn.t/i.test(document.body.innerText)`,
);
check("AMP John 3 loads 36 verses", (await count()) === 36, String(await count()));
const amp = await notice();
check("AMP shows the Lockman notice and link", /Lockman/.test(amp) && /Amplified/.test(amp));
check(
  "AMP notice links to lockman.org",
  await ev(
    "document.querySelector('[data-testid=\"publisher-notice\"] a')?.href === 'https://www.lockman.org/'",
  ),
);

// 4. Chapter navigation and book edges.
await go("/chapter/NIV/john/4", `${blocks} > 20`);
check("NIV John 4 loads 54 verses", (await count()) === 54, String(await count()));
await go("/chapter/NIV/psalms/23", `${blocks} >= 5`);
check("NIV Psalm 23 loads 6 verses (poetry)", (await count()) === 6, String(await count()));
await go("/chapter/NIV/genesis/1", `${blocks} > 20`);
check("NIV Genesis 1 loads 31 verses", (await count()) === 31, String(await count()));
await go("/chapter/NIV/john/99", "document.body.innerText.length > 40");
check(
  "A chapter that does not exist is a normal not-found state, not a crash",
  !state.errors.some((e) => e.startsWith("exception")) && (await count()) === 0,
  state.errors.join(" | "),
);

// 5. Single verse view.
await go("/verse/NIV/john/3/16", "document.querySelector('article') !== null");
check("NIV verse page shows the notice", /Biblica/.test(await notice()));
check(
  "NIV verse page shows verse 16 text",
  await ev("/so loved/.test(document.querySelector('article')?.innerText ?? '')"),
);

// 6. The selector lists the new editions beside the existing six.
await go("/chapter/KJAV/john/3", `${blocks} > 20`);
await ev(
  "[...document.querySelectorAll('button')].find((el) => /KJAV/.test(el.innerText) && el.getAttribute('aria-haspopup') !== null || /translation/i.test(el.getAttribute('aria-label') ?? ''))?.click()",
);
await b.sleep(600);
const options = await ev("document.body.innerText");
check(
  "Translation selector offers KJAV, BSB, WEB, ASV, BBE, FBV, NIV and AMP",
  ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV", "NIV", "AMP"].every((code) => options.includes(code)),
);

// 7. Nothing licensed is persisted or called directly from the browser.
await go("/chapter/NIV/john/3", `${blocks} > 20`);
const storage = await ev(`(async () => {
  const cached = JSON.parse(localStorage.getItem('versesnap.bible.chapters.v1') ?? '[]');
  const licensedCached = cached.filter((e) => (e.key ?? '').startsWith('NIV/') || (e.key ?? '').startsWith('AMP/') || ['NIV', 'AMP'].includes(e.chapter?.translation)).length;
  // History and last-read may name the translation, but must hold no Scripture text for it.
  const history = JSON.parse(localStorage.getItem('versesnap.library.history.v1') ?? '[]');
  const licensedText = history.filter((e) => ['NIV', 'AMP'].includes(e.translation) && e.verseText).length;
  const dbs = (await indexedDB.databases?.()) ?? [];
  const cacheNames = (await caches?.keys?.()) ?? [];
  // Preview and Production builds ship the offline service worker, so app-shell caches are expected.
  // What must never be in them is a licensed edition: no NIV/AMP chapter request, no server-function
  // response, and no response body carrying a publisher notice or licensed text.
  let cachedEntries = 0;
  let licensedInCaches = 0;
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      cachedEntries += 1;
      const url = request.url;
      if (/_serverFn|youversion|[/](NIV|AMP)[/]/i.test(url)) {
        licensedInCaches += 1;
        continue;
      }
      const response = await cache.match(request);
      const type = response?.headers.get('content-type') ?? '';
      if (!/text|json|javascript/.test(type)) continue;
      const body = await response.clone().text();
      if (/so loved the world|Biblica, Inc|Lockman Foundation/.test(body)) licensedInCaches += 1;
    }
  }
  return { licensedCached, licensedText, dbs: dbs.map((d) => d.name), cacheNames, cachedEntries, licensedInCaches };
})()`);
check(
  "The on-device chapter cache holds no NIV or AMP chapter",
  storage.licensedCached === 0,
  JSON.stringify(storage),
);
check(
  "Reading history stores no NIV or AMP text",
  storage.licensedText === 0,
  JSON.stringify(storage),
);
check(
  "No offline database or service-worker cache holds licensed Scripture",
  storage.dbs.every((n) => !/bible|scripture/i.test(n ?? "")) && storage.licensedInCaches === 0,
  JSON.stringify(storage),
);
check(
  "The browser never calls api.youversion.com and never sends the key",
  requested.every(
    (r) =>
      !r.url.includes("api.youversion.com") && !r.headers.some((h) => /x-yvp-app-key/i.test(h)),
  ),
);
check(
  "Chapter requests go to the app's own server function",
  requested.some((r) => r.url.includes("/_serverFn/") || r.url.includes("youversion")),
);

summary();
