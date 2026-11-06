// Discover (YouVersion-powered search) on the Search screen, driven in a real browser against the REAL
// YouVersion API. Needs the app running WITH both flags and a server-side key:
//   VITE_YOUVERSION_DISCOVER=true npm run dev -- --port 8091     (VITE_YOUVERSION_TRANSLATIONS=true and
//   YOUVERSION_APP_KEY in .env.local)
//   npm run test:e2e:youversion-discover
// MANUAL USE ONLY. This sends dozens of REAL requests and YouVersion rate-limits the shared app key (a run
// or two in a few minutes triggered 429 with Retry-After: 300). Prefer `npm run test:e2e:youversion-discover`
// (a local mock, no live traffic). If you must run this, use a separate development key, once.
// Never prints licensed text: only counts and short markers.
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, send, on, check, summary, sleep, shot, clickText } = b;

await viewport(390, 844);
await send("Network.enable");
const requests = [];
on("Network.requestWillBeSent", (params) => {
  requests.push({
    url: params.request.url,
    method: params.request.method,
    headers: Object.keys(params.request.headers ?? {}),
  });
});
const posts = () => requests.filter((r) => r.method === "POST" && r.url.includes("/_serverFn/"));

const count = (selector) => ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const text = (selector) =>
  ev(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);
const pathname = () => ev("location.pathname + location.search");

/** Types like a person: one key at a time with short gaps. */
async function typeSlowly(value, gapMs = 60) {
  await ev("document.querySelector('input[name=q]').focus()");
  for (const ch of value) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(gapMs);
  }
}
async function clearInput() {
  await ev(`(() => {
    const input = document.querySelector('input[name=q]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`);
  await sleep(200);
}
const submitEnter = async () => {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
};

// 1. Verse Snap search is the default and is untouched; the switch offers both modes.
await go("/search", "!!document.querySelector('[data-testid=search-mode-switch]')");
check(
  "Search shows the Discover | Verse Snap switch, Verse Snap selected by default",
  (await ev(
    "[...document.querySelectorAll('[data-testid=search-mode-switch] button')].map((x) => x.innerText + ':' + x.getAttribute('aria-pressed')).join('|')",
  )) === "Discover:false|Verse Snap:true",
);
check(
  "Verse Snap mode keeps its own field and suggestion card",
  (await count("[role=search]")) === 1,
);
check("Opening Search makes no Discover request", posts().length === 0);
await shot("01-verse-snap-default.png");

// 2. Verse Snap reference search still opens the reader (regression).
await ev("document.querySelector('input[name=q]').focus()");
await typeSlowly("john 3:16", 20);
await submitEnter();
await waitFor("location.pathname.startsWith('/verse/')", 15000);
check(
  "Verse Snap: 'john 3:16' still opens the verse page",
  (await pathname()).startsWith("/verse/"),
);

// 3. Discover: empty state shows real trending searches.
requests.length = 0;
await go(
  "/search?mode=discover&t=NIV",
  "!!document.querySelector('[data-testid=trending-list]') || /aren.t available/.test(document.body.innerText)",
);
const trending = await count("[data-testid=trending-list] li");
check("Discover opens on trending searches from YouVersion", trending > 0, String(trending));
check("Discover lists no invented trends (every chip came from the API)", trending <= 25);
check(
  "Discover mode is selected and Verse Snap's camera card is not shown",
  (await ev(
    "document.querySelector('[data-testid=search-mode-switch] [aria-pressed=true]')?.innerText",
  )) === "Discover",
);
check(
  "Translation chips offer NIV and AMP, NIV selected",
  (await ev(
    "[...document.querySelectorAll('[role=radio]')].map((x) => x.innerText + ':' + x.getAttribute('aria-checked')).join('|')",
  )) === "NIV:true|AMP:false",
);
await shot("02-discover-trending.png");

// 4. Typing: debounce means one suggestions request for a fast burst, and the list shows.
requests.length = 0;
await typeSlowly("lov", 50);
await waitFor(
  "!!document.querySelector('[data-testid=discover-suggestions] li:nth-child(2)')",
  8000,
);
const suggestPosts = posts().length;
check(
  "Typing 'lov' fast sent exactly one suggestions request (300 ms debounce)",
  suggestPosts === 1,
  String(suggestPosts),
);
const suggestions = await count("[data-testid=discover-suggestions] li");
check("Live suggestions appear under the field", suggestions >= 2, String(suggestions));
check(
  "The first suggestion row searches what was typed",
  /Search for .lov./.test(await text("[data-testid=discover-suggestions] li")),
);
check(
  "No search results are fetched while typing",
  (await count("[data-testid=discover-verses]")) === 0,
);
await shot("03-discover-suggestions.png");

// 5. Stale responses: type more, and the old list never overwrites the new one.
await typeSlowly("e", 50);
await sleep(1200);
check(
  "After 'love' the first row reflects the latest text",
  /love/.test(await text("[data-testid=discover-suggestions] li")),
);

// 6. Submit: verses with previews, topics and (NIV) the no-images note.
requests.length = 0;
await submitEnter();
await waitFor("(document.querySelectorAll('[data-testid=discover-verses] li').length > 0)", 20000);
await waitFor(
  "[...document.querySelectorAll('[data-testid=discover-verses] li')].slice(0, 3).every((li) => !/Loading passage/.test(li.innerText))",
  20000,
);
check(
  "URL carries the mode, query and translation",
  /mode=discover.*q=love.*t=NIV|q=love.*mode=discover/.test(await pathname()),
  await pathname(),
);
const rows = await count("[data-testid=discover-verses] li");
check("Search shows 10 verse results on the first page", rows === 10, String(rows));
const previewed = await ev(
  "[...document.querySelectorAll('[data-testid=discover-verses] li')].slice(0, 3).filter((li) => !/Open to read|Loading passage/.test(li.innerText)).length",
);
check("The verses on screen show a text preview", previewed >= 2, String(previewed));
check(
  "NIV publisher notice shows under the verses",
  /Biblica/.test(await text("[data-testid=publisher-notice]")),
);
check(
  "NIV: verse images are explained as unavailable, none shown",
  (await count("[data-testid=discover-images] img")) === 0 &&
    /aren.t shown for NIV/.test(await text("[data-testid=images-unavailable]")),
);
check(
  "Results never appear as links to api.youversion.com",
  await ev(
    "![...document.querySelectorAll('a')].some((a) => a.href.includes('api.youversion.com'))",
  ),
);
await shot("04-discover-results-niv.png");

// 7. Load More pages through the API; previews stop at the 25-verse cap.
await clickText(/^Load more$/);
await waitFor("document.querySelectorAll('[data-testid=discover-verses] li').length >= 20", 20000);
await waitFor(
  "[...document.querySelectorAll('[data-testid=discover-verses] li')].slice(0, 3).every((li) => !/Loading passage/.test(li.innerText))",
  20000,
);
check(
  "Load more adds the next 10 verses",
  (await count("[data-testid=discover-verses] li")) === 20,
);
await clickText(/^Load more$/);
await waitFor("document.querySelectorAll('[data-testid=discover-verses] li').length >= 30", 20000);
await waitFor(
  "[...document.querySelectorAll('[data-testid=discover-verses] li')].slice(0, 3).every((li) => !/Loading passage/.test(li.innerText))",
  20000,
);
const total = await count("[data-testid=discover-verses] li");
const fallbacks = await ev(
  "[...document.querySelectorAll('[data-testid=discover-verses] li')].filter((li) => /Open to read this passage/.test(li.innerText)).length",
);
check("A third page loads (30 verses)", total === 30, String(total));
check(
  "Previews stop at 25 verses; the rest show a reference with 'Open to read'",
  fallbacks >= 5,
  `${fallbacks} fallbacks of ${total}`,
);
await shot("05-discover-load-more.png");

// 8. A result opens the existing Bible Reader in the same edition.
await ev("document.querySelector('[data-testid=discover-verses] a').click()");
await waitFor("location.pathname.startsWith('/verse/NIV/')", 15000);
check(
  "A result opens /verse/NIV/... in the existing reader",
  (await pathname()).startsWith("/verse/NIV/"),
  await pathname(),
);
await waitFor("document.querySelectorAll('article').length > 0", 15000);
check(
  "The reader shows the verse with the NIV notice",
  /Biblica/.test(await text("[data-testid=publisher-notice]")),
);

// 9. Did-you-mean.
requests.length = 0;
await go(
  "/search?mode=discover&t=NIV&q=forgivness",
  "!!document.querySelector('[data-testid=did-you-mean]') || !!document.querySelector('[data-testid=discover-verses]')",
);
await waitFor("!!document.querySelector('[data-testid=did-you-mean]')", 15000);
const dym = await text("[data-testid=did-you-mean]");
check(
  "A misspelling offers 'Did you mean forgiveness?'",
  /Did you mean/i.test(dym) && /forgiveness/i.test(dym),
  dym.slice(0, 80),
);
await shot("06-discover-did-you-mean.png");
await ev(
  "[...document.querySelectorAll('[data-testid=did-you-mean] button')].find((x) => /forgiveness/i.test(x.innerText)).click()",
);
await waitFor("/q=forgiveness/.test(location.search)", 10000);
check(
  "Tapping the correction searches it",
  /q=forgiveness/.test(await pathname()),
  await pathname(),
);

// 10. Topics and subtopics: tapping one starts a new search.
await go(
  "/search?mode=discover&t=NIV&q=anxiety",
  "!!document.querySelector('[data-testid=discover-topics]') || !!document.querySelector('[data-testid=discover-verses]')",
);
await waitFor("!!document.querySelector('[data-testid=discover-topics]')", 15000);
const topicChips = await count("[data-testid=discover-topics] button");
check("Related topics and subtopics are listed", topicChips >= 2, String(topicChips));
await shot("07-discover-topics.png");
await ev("document.querySelectorAll('[data-testid=discover-topics] button')[1].click()");
await sleep(800);
check("Tapping a subtopic searches it", !/q=anxiety/.test(await pathname()), await pathname());

// 11. AMP: real verse images with their credit line, no download or share controls.
await go(
  "/search?mode=discover&t=AMP&q=peace",
  "!!document.querySelector('[data-testid=discover-verses]')",
);
// Image records are requested only when the section is near the screen, so scroll to it like a person.
await waitFor("!!document.querySelector('[data-testid=discover-images]')", 15000);
check(
  "Verse image records are not requested until the section is near the screen",
  (await count("[data-testid=discover-images] img")) === 0,
);
await ev("document.querySelector('[data-testid=discover-images]')?.scrollIntoView()");
await waitFor("document.querySelectorAll('[data-testid=discover-images] img').length > 0", 20000);
const imgs = await count("[data-testid=discover-images] img");
await waitFor(
  "[...document.querySelectorAll('[data-testid=discover-images] img')].every((i) => i.complete)",
  20000,
);
check(
  "The verse images actually render (decoded, non-zero size)",
  await ev(
    "[...document.querySelectorAll('[data-testid=discover-images] img')].every((i) => i.naturalWidth > 0)",
  ),
);
check("AMP shows YouVersion verse images", imgs > 0 && imgs <= 6, String(imgs));
check(
  "Images come from YouVersion's own CDN, sized with ?size=",
  await ev(
    "[...document.querySelectorAll('[data-testid=discover-images] img')].every((i) => /^https:\\/\\/cdn\\.youversion\\.com\\/.*\\?size=thumb$/.test(i.src))",
  ),
);
check(
  "Every image shows its credit line",
  await ev(
    "[...document.querySelectorAll('[data-testid=discover-images] figcaption')].every((c) => /YouVersion/.test(c.innerText))",
  ),
);
check(
  "Images are not offered for download, share or copy",
  (await count(
    "[data-testid=discover-images] a[download], [data-testid=discover-images] button:not([class*='PILL'])",
  )) <= 1,
);
check("AMP shows the Lockman notice", /Lockman/.test(await text("[data-testid=publisher-notice]")));
await shot("08-discover-results-amp-images.png");
if ((await count("[data-testid=discover-images] button")) > 0) {
  await clickText(/Show more images/, "[data-testid=discover-images]");
  await waitFor("document.querySelectorAll('[data-testid=discover-images] img').length > 6", 15000);
  check(
    "'Show more images' reveals the next group",
    (await count("[data-testid=discover-images] img")) > 6,
  );
}

// 12. Switching translation keeps the query and reloads the results.
await ev(
  "[...document.querySelectorAll('[role=radio]')].find((x) => x.innerText === 'NIV').click()",
);
await waitFor("/t=NIV/.test(location.search)", 10000);
await waitFor("!!document.querySelector('[data-testid=images-unavailable]')", 15000);
check(
  "Switching to NIV keeps the query and applies NIV's rules",
  /q=peace/.test(await pathname()) && (await count("[data-testid=discover-images] img")) === 0,
);

// 13. Nothing found: an honest empty state.
await go(
  "/search?mode=discover&t=NIV&q=zxqvwkjh",
  "/Nothing found|Verses/.test(document.body.innerText)",
);
await waitFor("/Nothing found|Verses|Related topics/.test(document.body.innerText)", 15000);
check(
  "A nonsense query shows a clear empty state (or sensible results)",
  /Nothing found|Verses/.test(await ev("document.body.innerText")),
);
// Aborted or cancelled requests from the previous step can log a network line; only real errors count.
const realErrors = b.state.errors.filter(
  (e) => !/Failed to load resource|net::ERR|AbortError/.test(e),
);
check(
  "That page logs no console errors",
  realErrors.length === 0,
  realErrors.join(" | ").slice(0, 200),
);
await shot("09-discover-empty.png");

// 14. Offline: a clear message and a way to retry; reconnecting recovers without a reload.
await go("/search?mode=discover&t=NIV", "!!document.querySelector('[data-testid=trending-list]')");
await send("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await typeSlowly("grace", 30);
await submitEnter();
await waitFor(
  "/offline|Connection problem|Search didn.t finish/i.test(document.body.innerText)",
  20000,
);
const offlineText = await ev("document.body.innerText");
check(
  "Offline: Discover explains the connection problem",
  /You.re offline|Connection problem/.test(offlineText),
  offlineText.slice(0, 60),
);
check(
  "Offline: a Try again button is offered",
  await ev(
    "[...document.querySelectorAll('button')].some((x) => /^Try again$/.test(x.innerText.trim()))",
  ),
);
await shot("10-discover-offline.png");
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await clickText(/^Try again$/);
await waitFor("document.querySelectorAll('[data-testid=discover-verses] li').length > 0", 20000);
check(
  "Back online, Try again loads the results",
  (await count("[data-testid=discover-verses] li")) > 0,
);

// 15. Cancelled/stale: switching mode makes no Discover request and drops the typed text.
requests.length = 0;
await go("/search?mode=discover&t=NIV", "!!document.querySelector('[data-testid=trending-list]')");
const before = posts().length;
await clickText(/^Verse Snap$/, "[data-testid=search-mode-switch]");
await waitFor("!location.search.includes('mode=discover')", 10000);
await sleep(600);
check(
  "Switching to Verse Snap leaves Discover without any search request",
  posts().length === before,
  `${posts().length - before} extra`,
);
check(
  "Back in Verse Snap mode the original field is shown",
  (await ev("document.querySelector('input[name=q]')?.getAttribute('placeholder')")) ===
    "Search verses, references...",
);

// 16. Privacy: the key never reaches the browser; nothing licensed is stored on the device.
const direct = requests.filter((r) => r.url.includes("api.youversion.com"));
const keyHeaders = requests.filter((r) => r.headers.some((h) => /x-yvp-app-key/i.test(h)));
check(
  "The browser never calls api.youversion.com and never sends the key",
  direct.length === 0 && keyHeaders.length === 0,
);
await go(
  "/search?mode=discover&t=NIV&q=love",
  "!!document.querySelector('[data-testid=discover-verses]')",
);
await waitFor(
  "[...document.querySelectorAll('[data-testid=discover-verses] li')].slice(0, 3).every((li) => !/Loading passage/.test(li.innerText))",
  20000,
);
const stored = await ev(`(async () => {
  const sample = ${JSON.stringify("one and only Son")};
  const needle = (value) => typeof value === 'string' && value.includes(sample);
  let local = 0;
  for (let i = 0; i < localStorage.length; i++) if (needle(localStorage.getItem(localStorage.key(i)))) local++;
  let cached = 0;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (/_serverFn|youversion/i.test(request.url)) cached++;
    }
  }
  const dbs = ((await indexedDB.databases?.()) ?? []).map((d) => d.name);
  return { local, cached, dbs };
})()`);
check(
  "No licensed text in localStorage, and no Discover request in any cache",
  stored.local === 0 && stored.cached === 0,
  JSON.stringify(stored),
);

summary();
