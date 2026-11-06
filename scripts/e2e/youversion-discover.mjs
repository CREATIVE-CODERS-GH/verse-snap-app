// Discover (YouVersion-powered search) in a real browser, against a LOCAL MOCK of the YouVersion API.
// Repeatable and free: no live YouVersion traffic, no key, no quota. The script starts the mock, starts
// the dev server pointed at it (YOUVERSION_API_BASE_URL, honoured only for loopback in development, see
// src/lib/bible/youversion-base.server.ts) and then drives the app, counting exactly what reached the
// "upstream" for each journey.
//   npm run test:e2e:youversion-discover
// (a live-API variant exists for manual use only: scripts/e2e/youversion-discover-live.mjs)
import { execSync, spawn } from "node:child_process";
import http from "node:http";

// A different port each run: a browser left over from an earlier run could otherwise refetch into this one.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 8200 + (process.pid % 700));
const APP = `http://127.0.0.1:${APP_PORT}`;

// ---------------------------------------------------------------------------------------------------------
// The mock YouVersion API
// ---------------------------------------------------------------------------------------------------------
const upstream = []; // every request the app's server sent: { path, query, hasKey }
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const BOOKS = ["JHN", "ROM", "PSA", "MAT", "PRO", "ISA", "1CO", "PHP", "EPH", "HEB"];
const REFS = Array.from(
  { length: 30 },
  (_, i) => `${BOOKS[i % 10]}.${Math.floor(i / 10) + 1}.${(i % 10) + 1}`,
);
// Real image ids are about 540 characters of letters, digits, "-", "_" and ".".
const imageId = (n) => `mockimg${n}_${"A".repeat(520)}`;
const IMAGE_IDS = Array.from({ length: 12 }, (_, i) => imageId(i + 1));
let mockOrigin = "";

const json = (res, body, status = 200, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

function handle(req, res) {
  const url = new URL(req.url, "http://mock");
  const path = url.pathname;
  if (path.startsWith("/cdn/")) {
    res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=60" });
    return res.end(PNG);
  }
  const query = Object.fromEntries(url.searchParams);
  upstream.push({ path, query, hasKey: Boolean(req.headers["x-yvp-app-key"]) });
  const q = url.searchParams.get("query") ?? "";

  if (q === "throttleme") return json(res, { detail: "slow down" }, 429, { "retry-after": "6" });

  if (path === "/v1/search-queries") {
    if (url.searchParams.get("trending") === "true") {
      return json(res, {
        data: ["psalms 91", "renew your mind", "love", "hope", "fear", "grace", "peace", "joy"].map(
          (text) => ({ text, source: "trending" }),
        ),
      });
    }
    return json(res, {
      data: [q, `${q} verses`, `${q}s`, `${q} in marriage`, `${q} and faith`].map((text) => ({
        text,
        source: "community",
      })),
    });
  }
  if (path === "/v1/search-unified") {
    if (q === "zxqvwkjh") {
      return json(res, { topics: [], images: [], did_you_mean: [], search_instead_for: "" });
    }
    return json(res, {
      topics: [{ id: 11, text: "Peace", subtopics: ["calm", "rest", "relax"] }],
      images: IMAGE_IDS.map((id, i) => ({ id, passage_id: REFS[i] })),
      did_you_mean: q === "forgivness" ? ["forgiveness"] : [],
      search_instead_for: "",
    });
  }
  if (path === "/v1/search-verses") {
    if (q === "forbiddenq") return json(res, { detail: "Bible version not found" }, 404);
    if (q === "zxqvwkjh") {
      return json(res, {
        verses: [],
        next_page_token: null,
        did_you_mean: [],
        search_instead_for: null,
      });
    }
    const page = { p1: 1, p2: 2 }[url.searchParams.get("page_token")] ?? 0;
    return json(res, {
      verses: REFS.slice(page * 10, page * 10 + 10).map((reference) => ({ reference })),
      next_page_token: page < 2 ? `p${page + 1}` : null,
      did_you_mean: q === "forgivness" ? ["forgiveness"] : [],
      search_instead_for: null,
      user_intent: "topical",
    });
  }
  const image = /^\/v1\/images\/mockimg(\d+)_/.exec(path);
  if (image) {
    const n = Number(image[1]);
    return json(res, {
      id: imageId(n),
      image_url: `${mockOrigin}/cdn/${n}.png`,
      attribution: "© YouVersion",
      passage_id: REFS[n - 1],
      aspect_ratio: 0.563,
      width: 1080,
      height: 1920,
      language_tag: "en",
    });
  }
  const passage = /^\/v1\/bibles\/\d+\/passages\/([0-9A-Z]{3})\.(\d+)(?:\.(\d+))?$/.exec(path);
  if (passage) {
    if (passage[3]) {
      return json(res, {
        id: `${passage[1]}.${passage[2]}.${passage[3]}`,
        content: `Mock text for ${passage[1]} ${passage[2]}:${passage[3]}.`,
      });
    }
    const html = Array.from(
      { length: 40 },
      (_, i) =>
        `<div class="p"><span class="yv-v" v="${i + 1}"></span><span class="yv-vlbl">${i + 1}</span>Mock reader text ${i + 1}. </div>`,
    ).join("");
    return json(res, { id: `${passage[1]}.${passage[2]}`, content: html });
  }
  return json(res, { detail: "not found" }, 404);
}

const mock = http.createServer(handle);
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
mockOrigin = `http://127.0.0.1:${mock.address().port}`;

// ---------------------------------------------------------------------------------------------------------
// The dev server, pointed at the mock
// ---------------------------------------------------------------------------------------------------------
const dev = spawn("npm", ["run", "dev", "--", "--port", String(APP_PORT)], {
  shell: true,
  stdio: "ignore",
  env: {
    ...process.env,
    VITE_YOUVERSION_TRANSLATIONS: "true",
    VITE_YOUVERSION_DISCOVER: "true",
    YOUVERSION_APP_KEY: "mock-key-not-a-secret",
    YOUVERSION_API_BASE_URL: mockOrigin,
    // This suite sends far more than one person would in a minute; the real limits are unit-tested.
    DISCOVER_RATE_PER_CLIENT: "5000",
    DISCOVER_RATE_GLOBAL: "5000",
  },
});
const cleanup = () => {
  try {
    if (process.platform === "win32")
      execSync(`taskkill /PID ${dev.pid} /T /F`, { stdio: "ignore" });
    else dev.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  mock.close();
};
process.on("exit", cleanup);

let ready = false;
for (let attempt = 0; attempt < 90 && !ready; attempt += 1) {
  try {
    ready = (await fetch(`${APP}/search`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
if (!ready) {
  console.error(`The dev server did not start on ${APP}.`);
  process.exit(2);
}

process.env.E2E_BASE = APP;
const { openBrowser } = await import("./lib.mjs");
const b = await openBrowser();
const { ev, waitFor, go, viewport, send, on, check, summary, sleep, shot, clickText } = b;

await viewport(390, 844);
await send("Network.enable");
const browserRequests = [];
on("Network.requestWillBeSent", (params) => {
  browserRequests.push({
    url: params.request.url,
    method: params.request.method,
    headers: Object.keys(params.request.headers ?? {}),
  });
});

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------
const count = (selector) => ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const text = (selector) =>
  ev(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);
const pathname = () => ev("location.pathname + location.search");
const bodyText = () => ev("document.body.innerText");
const ROWS = "[data-testid=discover-verses] li";

const isPath = (name) => (c) => c.path === `/v1/${name}`;
const isPassage = (c) => /\/passages\/[0-9A-Z]{3}\.\d+\.\d+$/.test(c.path);
const isChapter = (c) => /\/passages\/[0-9A-Z]{3}\.\d+$/.test(c.path);
const isImage = (c) => c.path.startsWith("/v1/images/");
const since = (mark, predicate = () => true) => upstream.slice(mark).filter(predicate);
const duplicates = (mark) => {
  const seen = new Set();
  const dupes = [];
  for (const c of upstream.slice(mark)) {
    const key = c.path + JSON.stringify(c.query);
    if (seen.has(key)) dupes.push(c.path);
    seen.add(key);
  }
  return dupes;
};

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
const enter = async () => {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
};
/** Scrolls the page to the bottom in steps, as a person reading down the results would. */
async function scrollThrough() {
  for (let i = 0; i < 14; i += 1) {
    await ev("window.scrollBy(0, 700)");
    await sleep(250);
  }
}
const firstRowsReady = (n) =>
  `[...document.querySelectorAll('${ROWS}')].slice(0, ${n}).every((li) => !/Loading passage/.test(li.innerText))`;
const errorsOf = () =>
  b.state.errors.filter((e) => !/Failed to load resource|net::ERR|AbortError/.test(e));

// ---------------------------------------------------------------------------------------------------------
// 1. Verse Snap is the default; the switch offers both modes; opening Search sends nothing
// ---------------------------------------------------------------------------------------------------------
await go("/search", "!!document.querySelector('[data-testid=search-mode-switch]')");
check(
  "Search shows the Discover | Verse Snap switch, Verse Snap selected by default",
  (await ev(
    "[...document.querySelectorAll('[data-testid=search-mode-switch] button')].map((x) => x.innerText + ':' + x.getAttribute('aria-pressed')).join('|')",
  )) === "Discover:false|Verse Snap:true",
);
check(
  "Verse Snap mode keeps its own field",
  (await ev("document.querySelector('input[name=q]')?.placeholder")) ===
    "Search verses, references...",
);
check(
  "Opening Search makes no YouVersion request",
  upstream.length === 0,
  JSON.stringify(upstream.map((c) => c.path + "?" + JSON.stringify(c.query)).slice(0, 4)),
);

// ---------------------------------------------------------------------------------------------------------
// 2. Discover opens on trending (the first request also proves the mock, not the real API, is in use)
// ---------------------------------------------------------------------------------------------------------
await go("/search?mode=discover&t=NIV", "!!document.querySelector('[data-testid=trending-list]')");
if (upstream.length === 0) {
  console.error("No request reached the mock: the API address override is not active. Stopping.");
  process.exit(2);
}
check("Discover opens on trending searches", (await count("[data-testid=trending-list] li")) === 8);
check("Exactly one trending request was sent", since(0, isPath("search-queries")).length === 1);
check(
  "Translation chips: NIV selected, AMP offered",
  (await ev(
    "[...document.querySelectorAll('[role=radio]')].map((x) => x.innerText + ':' + x.getAttribute('aria-checked')).join('|')",
  )) === "NIV:true|AMP:false",
);
await shot("01-discover-trending.png");

// ---------------------------------------------------------------------------------------------------------
// 3. Typing: nothing for one letter, one request for a fast burst, stale lists never win
// ---------------------------------------------------------------------------------------------------------
let mark = upstream.length;
await typeSlowly("l");
await sleep(900);
check("One letter sends no suggestion request", since(mark, isPath("search-queries")).length === 0);
await typeSlowly("ov", 50);
await waitFor(
  "!!document.querySelector('[data-testid=discover-suggestions] li:nth-child(2)')",
  8000,
);
let suggests = since(mark, isPath("search-queries"));
check(
  "Typing 'lov' as a fast burst sent exactly one request, for 'lov' (300 ms debounce)",
  suggests.length === 1 && suggests[0].query.query === "lov",
  JSON.stringify(suggests.map((s) => s.query.query)),
);
check("Live suggestions appear", (await count("[data-testid=discover-suggestions] li")) >= 4);
check("No results are fetched while typing", since(mark, isPath("search-verses")).length === 0);
await shot("02-discover-suggestions.png");
await typeSlowly("e", 50);
await sleep(1200);
suggests = since(mark, isPath("search-queries"));
check(
  "Continuing to 'love' adds one more request; 'lo' was never sent",
  suggests.length === 2 && !suggests.some((s) => s.query.query === "lo"),
  JSON.stringify(suggests.map((s) => s.query.query)),
);
check(
  "The list reflects the latest text",
  /love/.test(await text("[data-testid=discover-suggestions] li")),
);

// ---------------------------------------------------------------------------------------------------------
// 4. Search: two calls, then only what is on screen
// ---------------------------------------------------------------------------------------------------------
mark = upstream.length;
await enter();
await waitFor(`document.querySelectorAll('${ROWS}').length === 10`, 15000);
await waitFor(firstRowsReady(3), 15000);
await sleep(700);
check(
  "URL carries mode, query and translation",
  /mode=discover/.test(await pathname()) &&
    /q=love/.test(await pathname()) &&
    /t=NIV/.test(await pathname()),
);
check("First page shows 10 verses", (await count(ROWS)) === 10);
check(
  "One verses request and one topics/images request were sent",
  since(mark, isPath("search-verses")).length === 1 &&
    since(mark, isPath("search-unified")).length === 1,
);
const initialPassages = since(mark, isPassage).length;
check(
  "Only verses near the screen asked for their text (not all 10 at once, never more than 10)",
  initialPassages >= 3 && initialPassages <= 10,
  String(initialPassages),
);
check("NIV never requests verse images", since(mark, isImage).length === 0);
check(
  "No identical request was sent twice",
  duplicates(mark).length === 0,
  duplicates(mark).join(","),
);
check(
  "The verses on screen show a text preview",
  await ev(
    `[...document.querySelectorAll('${ROWS}')].slice(0, 3).every((li) => /Mock text for/.test(li.innerText))`,
  ),
);
check("NIV publisher notice shows", /Biblica/.test(await text("[data-testid=publisher-notice]")));
check(
  "NIV: images explained as unavailable, none shown",
  (await count("[data-testid=discover-images] img")) === 0 &&
    /aren.t shown for NIV/.test(await text("[data-testid=images-unavailable]")),
);
check(
  "Related topics and subtopics are listed",
  (await count("[data-testid=discover-topics] button")) === 4,
);
const nivInitial = upstream.length - mark;
await shot("03-discover-results-niv.png");

// ---------------------------------------------------------------------------------------------------------
// 5. Load more: one request per page; previews stop at 25 and never go past it
// ---------------------------------------------------------------------------------------------------------
await clickText(/^Load more$/);
await waitFor(`document.querySelectorAll('${ROWS}').length === 20`, 15000);
await clickText(/^Load more$/);
await waitFor(`document.querySelectorAll('${ROWS}').length === 30`, 15000);
await scrollThrough();
await sleep(800);
const verseCalls = since(mark, isPath("search-verses"));
check(
  "Two Load more taps sent exactly two more verses requests (page tokens p1, p2)",
  verseCalls.length === 3 &&
    verseCalls[1].query.page_token === "p1" &&
    verseCalls[2].query.page_token === "p2",
  JSON.stringify(verseCalls.map((v) => v.query.page_token)),
);
const ids = since(mark, isPassage).map((c) => c.path.split("/").pop());
check(
  "Scrolling through all 30 results requested text for at most 25 distinct verses",
  new Set(ids).size === ids.length && ids.length <= 25 && ids.length >= 20,
  `${ids.length} requests`,
);
check(
  "Results 26-30 show the reference and 'Open to read', and sent nothing",
  (await ev(
    `[...document.querySelectorAll('${ROWS}')].slice(25).every((li) => /Open to read this passage/.test(li.innerText))`,
  )) && !ids.some((id) => REFS.slice(25).includes(id)),
);
check("Still no duplicate request", duplicates(mark).length === 0, duplicates(mark).join(","));
await shot("04-discover-load-more.png");
const nivFull = upstream.length - mark;

// ---------------------------------------------------------------------------------------------------------
// 6. A result opens the existing reader in the same edition (mock chapter)
// ---------------------------------------------------------------------------------------------------------
await ev("window.scrollTo(0, 0)");
await ev(`document.querySelector('${ROWS} a').click()`);
await waitFor("location.pathname.startsWith('/verse/NIV/')", 15000);
await waitFor("document.querySelectorAll('article').length > 0", 15000);
check(
  "A result opens /verse/NIV/... with the NIV notice",
  (await pathname()).startsWith("/verse/NIV/") &&
    /Biblica/.test(await text("[data-testid=publisher-notice]")),
  await pathname(),
);

// ---------------------------------------------------------------------------------------------------------
// 7. Spelling help and topics
// ---------------------------------------------------------------------------------------------------------
await go(
  "/search?mode=discover&t=NIV&q=forgivness",
  "!!document.querySelector('[data-testid=did-you-mean]')",
);
check(
  "A misspelling offers 'Did you mean forgiveness?'",
  /Did you mean/.test(await text("[data-testid=did-you-mean]")) &&
    /forgiveness/.test(await text("[data-testid=did-you-mean]")),
);
await shot("05-discover-did-you-mean.png");
await ev(
  "[...document.querySelectorAll('[data-testid=did-you-mean] button')].find((x) => /forgiveness/.test(x.innerText)).click()",
);
await waitFor("/q=forgiveness/.test(location.search)", 10000);
check("Tapping the correction searches it", /q=forgiveness/.test(await pathname()));
await waitFor(
  "document.querySelectorAll('[data-testid=discover-topics] button').length >= 2",
  15000,
);
await ev("document.querySelectorAll('[data-testid=discover-topics] button')[1].click()");
await waitFor("/q=calm/.test(location.search)", 10000);
check("Tapping a subtopic searches it", /q=calm/.test(await pathname()), await pathname());
await shot("06-discover-topics.png");

// ---------------------------------------------------------------------------------------------------------
// 8. AMP verse images: none until near the screen, 6 at a time, and they really load
// ---------------------------------------------------------------------------------------------------------
await go(
  "/search?mode=discover&t=AMP&q=peace",
  `document.querySelectorAll('${ROWS}').length === 10`,
);
await waitFor(firstRowsReady(3), 15000);
await sleep(600);
mark = upstream.length;
check(
  "No image record is requested while the images are far below the screen",
  (await count("[data-testid=discover-images] img")) === 0 && since(0, isImage).length === 0,
);
await ev("document.querySelector('[data-testid=discover-images]')?.scrollIntoView()");
await waitFor("document.querySelectorAll('[data-testid=discover-images] img').length === 6", 15000);
await waitFor(
  "[...document.querySelectorAll('[data-testid=discover-images] img')].every((i) => i.complete)",
  15000,
);
await sleep(300);
check(
  "Exactly 6 image records are requested when the section comes near",
  since(0, isImage).length === 6,
  String(since(0, isImage).length),
);
check(
  "The verse images actually load (decoded, non-zero size)",
  await ev(
    "[...document.querySelectorAll('[data-testid=discover-images] img')].every((i) => i.naturalWidth > 0)",
  ),
);
check(
  "Images are sized with ?size=thumb and every tile shows its credit line",
  (await ev(
    `[...document.querySelectorAll('[data-testid=discover-images] img')].every((i) => i.src.startsWith(${JSON.stringify(mockOrigin)} + '/cdn/') && i.src.endsWith('?size=thumb'))`,
  )) &&
    (await ev(
      "[...document.querySelectorAll('[data-testid=discover-images] figcaption')].every((c) => /YouVersion/.test(c.innerText))",
    )),
);
check(
  "Images offer no download, share or copy control",
  (await count("[data-testid=discover-images] [download]")) === 0,
);
check("AMP shows the Lockman notice", /Lockman/.test(await text("[data-testid=publisher-notice]")));
await shot("07-discover-results-amp-images.png");
await clickText(/Show more images/, "[data-testid=discover-images]");
await waitFor(
  "document.querySelectorAll('[data-testid=discover-images] img').length === 12",
  15000,
);
check(
  "'Show more images' requests the next 6 only (12 in all, never more)",
  since(0, isImage).length === 12,
);
check(
  "The images section ends when the ids run out",
  await ev(
    "![...document.querySelectorAll('[data-testid=discover-images] button')].some((x) => /Show more images/.test(x.innerText))",
  ),
);
const ampImages = since(0, isImage).length;

// 9. Switching translation keeps the query and applies NIV's rules without extra image calls
mark = upstream.length;
await ev(
  "[...document.querySelectorAll('[role=radio]')].find((x) => x.innerText === 'NIV').click()",
);
await waitFor("/t=NIV/.test(location.search)", 10000);
await waitFor("!!document.querySelector('[data-testid=images-unavailable]')", 15000);
check(
  "Switching to NIV keeps the query and requests no images",
  /q=peace/.test(await pathname()) && since(mark, isImage).length === 0,
);

// ---------------------------------------------------------------------------------------------------------
// 10. Empty state, permission denied
// ---------------------------------------------------------------------------------------------------------
// Let the previous page's lazy previews finish first, so they are not counted in this journey.
await waitFor(firstRowsReady(3), 15000);
await sleep(1500);
mark = upstream.length;
await go("/search?mode=discover&t=NIV&q=zxqvwkjh", "/Nothing found/.test(document.body.innerText)");
await sleep(600);
check(
  "A nonsense query shows the 'Nothing found' empty state",
  /Nothing found/.test(await bodyText()) && /See trending searches/.test(await bodyText()),
);
check(
  "The empty state makes only the two search calls (no text, no images)",
  since(mark).length === 2 &&
    since(mark, isPassage).length === 0 &&
    since(mark, isImage).length === 0,
  String(since(mark).length),
);
check(
  "The empty-state page logs no console errors",
  errorsOf().length === 0,
  errorsOf().join(" | ").slice(0, 200),
);
await shot("08-discover-empty.png");

await go(
  "/search?mode=discover&t=AMP&q=forbiddenq",
  "/Not available in AMP/.test(document.body.innerText)",
);
check(
  "A refused translation says it is not available, and offers no pointless retry",
  /Not available in AMP/.test(await bodyText()) &&
    !(await ev(
      "[...document.querySelectorAll('button')].some((x) => /^Try again$/.test(x.innerText.trim()))",
    )),
);
await shot("09-discover-denied.png");

// ---------------------------------------------------------------------------------------------------------
// 11. Throttling: Discover stops, Bible reading stops with it, and both resume together
// ---------------------------------------------------------------------------------------------------------
mark = upstream.length;
await go(
  "/search?mode=discover&t=NIV&q=throttleme",
  "/Slow down a moment/.test(document.body.innerText)",
);
check(
  "A 429 shows 'Slow down a moment' with YouVersion's own wait (6 seconds)",
  /Slow down a moment/.test(await bodyText()) && /about 6 seconds/.test(await bodyText()),
  (await bodyText()).slice(0, 120),
);
await shot("10-discover-rate-limited.png");
const throttled = since(mark).length;
check(
  "Only the in-flight calls reached YouVersion before the pause",
  throttled >= 1 && throttled <= 2,
  String(throttled),
);
await clearInput();
await typeSlowly("hope", 40);
await enter();
await waitFor("/Slow down a moment/.test(document.body.innerText)", 10000);
check(
  "While throttled, a new search sends NOTHING to YouVersion",
  since(mark).length === throttled,
  `${since(mark).length - throttled} extra`,
);
const chaptersBefore = since(0, isChapter).length;
await go(
  "/chapter/NIV/john/3",
  "/busy|isn.t available|Verse Snap couldn.t|trouble|moving quickly/i.test(document.body.innerText) || document.querySelectorAll('[data-verse-block]').length > 0",
);
check(
  "While throttled, the Bible reader sends nothing to YouVersion either",
  since(0, isChapter).length === chaptersBefore,
  `${since(0, isChapter).length - chaptersBefore} chapter requests`,
);
await sleep(6500);
await go("/chapter/NIV/john/3", "document.querySelectorAll('[data-verse-block]').length > 20");
check(
  "After the Retry-After, Bible reading works again",
  (await count("[data-verse-block]")) >= 20 && since(0, isChapter).length === chaptersBefore + 1,
);
await go(
  "/search?mode=discover&t=NIV&q=hope",
  `document.querySelectorAll('${ROWS}').length === 10`,
);
check("...and Discover works again", (await count(ROWS)) === 10);

// ---------------------------------------------------------------------------------------------------------
// 12. Offline, then back online
// ---------------------------------------------------------------------------------------------------------
await go("/search?mode=discover&t=NIV", "!!document.querySelector('[data-testid=trending-list]')");
await send("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await typeSlowly("grace", 30);
await enter();
await waitFor("/You.re offline|Connection problem/.test(document.body.innerText)", 20000);
check(
  "Offline: Discover says so and offers Try again",
  /You.re offline|Connection problem/.test(await bodyText()) &&
    (await ev(
      "[...document.querySelectorAll('button')].some((x) => /^Try again$/.test(x.innerText.trim()))",
    )),
);
await shot("11-discover-offline.png");
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await clickText(/^Try again$/);
await waitFor(`document.querySelectorAll('${ROWS}').length > 0`, 20000);
check("Back online, Try again loads the results", (await count(ROWS)) > 0);

// ---------------------------------------------------------------------------------------------------------
// 13. Switching modes sends nothing; privacy and storage
// ---------------------------------------------------------------------------------------------------------
await go("/search?mode=discover&t=NIV", "!!document.querySelector('[data-testid=trending-list]')");
mark = upstream.length;
await clickText(/^Verse Snap$/, "[data-testid=search-mode-switch]");
await waitFor("!location.search.includes('mode=discover')", 10000);
await sleep(600);
check("Switching to Verse Snap sends nothing to YouVersion", since(mark).length === 0);
check(
  "Back in Verse Snap mode the original field is shown",
  (await ev("document.querySelector('input[name=q]')?.getAttribute('placeholder')")) ===
    "Search verses, references...",
);

const direct = browserRequests.filter(
  // Only YouVersion API addresses count (not, say, Vercel Analytics' own /v1/script.js).
  (r) => r.url.startsWith(`${mockOrigin}/v1/`) || /^https?:\/\/api\.youversion\.com\//.test(r.url),
);
const keyHeaders = browserRequests.filter((r) => r.headers.some((h) => /x-yvp-app-key/i.test(h)));
check(
  "The browser never calls the YouVersion API and never sends the key",
  direct.length === 0 && keyHeaders.length === 0,
  JSON.stringify([...direct, ...keyHeaders].slice(0, 3).map((r) => r.url.slice(0, 90))),
);
check(
  "Every upstream request carried the app key from the server",
  upstream.length > 0 && upstream.every((c) => c.hasKey),
);
await go(
  "/search?mode=discover&t=NIV&q=love",
  `document.querySelectorAll('${ROWS}').length === 10`,
);
await waitFor(firstRowsReady(3), 15000);
const stored = await ev(`(async () => {
  let local = 0;
  for (let i = 0; i < localStorage.length; i++) if ((localStorage.getItem(localStorage.key(i)) ?? '').includes('Mock text for')) local++;
  let cached = 0;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) if (/_serverFn|\\/cdn\\//i.test(request.url)) cached++;
  }
  return { local, cached };
})()`);
check(
  "No Scripture preview in localStorage, and no Discover request or image in any cache",
  stored.local === 0 && stored.cached === 0,
  JSON.stringify(stored),
);

// ---------------------------------------------------------------------------------------------------------
// Request budget (what one search costs the shared YouVersion quota)
// ---------------------------------------------------------------------------------------------------------
console.log("\nUpstream requests, counted at the mock:");
console.log(
  `  NIV search, first screen ........ ${nivInitial}  (1 verses + 1 topics/images + ${initialPassages} visible previews)`,
);
console.log(
  `  NIV, all 30 results read ........ ${nivFull}  (3 verses pages + 1 topics/images + up to 25 previews)`,
);
console.log(
  `  AMP images (12 shown) ........... ${ampImages}  (6 image records per group, only when scrolled to)`,
);
console.log(
  `  typing 'love' ................... 2  (suggestions for 'lov' and 'love'; none for 1 letter)`,
);
check(
  "A search's first screen stays within 12 upstream requests",
  nivInitial <= 12,
  String(nivInitial),
);
check("Reading all 30 results stays within 29 upstream requests", nivFull <= 29, String(nivFull));

// Close the browser properly so no test browser outlives the run.
await send("Browser.close").catch(() => {});
summary();
