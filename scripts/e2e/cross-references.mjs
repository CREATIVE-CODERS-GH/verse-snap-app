// Scripture cross-references at 320px as a guest, against the live HelloAO dataset: the "Related
// passages (N)" link under the five Reader actions and its sheet, opening a passage and Back, the
// chapter verse sheet's chips and Explore all, the Explorer (testament groups, no sample badges,
// credit), a failed request with retry, and the Settings credit. Never signs in.
//   npm run test:e2e:cross-references      (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, send, check, summary, sleep, state } = b;

await send("Network.enable");
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await viewport(320, 700);

const text = () => ev("document.body.innerText");
const sideways = () => ev("document.documentElement.scrollWidth > innerWidth");
const path = () => ev("location.pathname");
const click = (selector, label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true; })()`,
  );
const touch = async (selector) => {
  const p = await ev(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + Math.min(r.width / 2, 120), y: r.y + Math.min(r.height / 2, 14) }; })()`,
  );
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(450);
};

// ================= the single-verse Reader =================
await go(
  "/verse/KJAV/romans/12/2",
  "!!document.querySelector('[role=group][aria-label=\"Verse actions\"]')",
);
await waitFor("/Related passages \\(\\d+\\)/.test(document.body.innerText)", 15000);
const count = Number((await text()).match(/Related passages \((\d+)\)/)[1]);
check(
  "the Reader still has exactly five actions",
  (await ev(
    "document.querySelectorAll('[role=group][aria-label=\"Verse actions\"] button').length",
  )) === 5,
);
check(
  "a small Related passages (N) link sits beneath them, not a sixth button",
  await ev(`(() => {
  const group = document.querySelector('[role=group][aria-label="Verse actions"]');
  const link = [...document.querySelectorAll('button')].find((x) => /^Related passages/.test(x.innerText.trim()));
  return !!link && !group.contains(link) && link.getBoundingClientRect().top >= group.getBoundingClientRect().bottom - 1;
})()`),
  `count ${count}`,
);
check("Romans 12:2 has a real, large set (not the old 7 samples)", count >= 40, String(count));

await click("button", "Related passages");
await waitFor("!!document.querySelector('[role=dialog]')", 5000);
await waitFor(
  "document.querySelectorAll('[role=dialog] ul[aria-label=\"Related passages\"] > li').length >= 10",
  15000,
);
const sheet = await ev("document.querySelector('[role=dialog]').innerText.replace(/\\s+/g, ' ')");
check(
  "the sheet lists the 10 best passages and says how many there are",
  /Related passages/.test(sheet) &&
    /top 10 of \d+/.test(sheet) &&
    (await ev(
      "document.querySelectorAll('[role=dialog] ul[aria-label=\"Related passages\"] > li').length",
    )) === 10,
  sheet.slice(0, 200),
);
check(
  "the best match comes first (1 Peter 1:14 for Romans 12:2)",
  /^Related passages.*?1 Peter 1:14/.test(sheet),
);
check(
  "passage text loads in the Reader's translation",
  await waitFor(
    "/Be not conformed|fashioning yourselves|as obedient children/i.test(document.querySelector('[role=dialog]').innerText) || document.querySelectorAll('[role=dialog] ul[aria-label=\"Related passages\"] li span.line-clamp-2').length > 0",
    15000,
  ).then(
    () => true,
    () => false,
  ),
);
check(
  "the sheet offers the Explorer and carries the CC BY credit with links",
  await ev(`(() => {
  const d = document.querySelector('[role=dialog]');
  const links = [...d.querySelectorAll('a')].map((a) => a.href);
  return /See all in the Explorer/.test(d.innerText) && links.some((h) => h.includes('openbible.info')) && links.some((h) => h.includes('creativecommons.org/licenses/by/4.0')) && /Reformatted/.test(d.innerText);
})()`),
);
check(
  "the sheet fits 320px",
  (await ev(
    "(() => { const r = document.querySelector('[role=dialog]').getBoundingClientRect(); return r.left >= 0 && r.right <= 320; })()",
  )) && !(await sideways()),
);

// open a passage, then Back
const target = await ev(
  "(() => { const a = [...document.querySelectorAll('[role=dialog] ul[aria-label=\"Related passages\"] > li a')].find((x) => /Ephesians 4:22/.test(x.innerText)); if (!a) return null; const href = a.getAttribute('href'); a.click(); return href; })()",
);
await sleep(900);
check(
  "tapping a passage opens that verse and closes the sheet",
  target !== null &&
    (await path()).startsWith("/verse/KJAV/ephesians/4/22") &&
    !(await ev("!!document.querySelector('[role=dialog]')")),
  `${target} -> ${await path()}`,
);
await ev("history.back()");
await waitFor("location.pathname === '/verse/KJAV/romans/12/2'", 8000);
await waitFor("/Related passages \\(\\d+\\)/.test(document.body.innerText)", 15000);
check("Back returns to the original verse", (await path()) === "/verse/KJAV/romans/12/2");

// ================= a failed request, then retry =================
await send("Network.setBlockedURLs", { urls: ["*open-cross-ref*"] });
await go(
  "/verse/KJAV/john/3/16",
  "!!document.querySelector('[role=group][aria-label=\"Verse actions\"]')",
);
await waitFor(
  "[...document.querySelectorAll('button')].some((x) => /^Related passages/.test(x.innerText.trim()))",
  15000,
);
await click("button", "Related passages");
await waitFor("/Couldn.t load related passages/.test(document.body.innerText)", 20000);
check(
  "a failed request says so and offers Try again",
  /Couldn.t load related passages/.test(await text()) &&
    (await ev(
      "[...document.querySelectorAll('[role=dialog] button')].some((x) => x.innerText.trim() === 'Try again')",
    )),
);
await send("Network.setBlockedURLs", { urls: [] });
await click("[role=dialog] button", "Try again");
await waitFor(
  "document.querySelectorAll('[role=dialog] ul[aria-label=\"Related passages\"] > li').length > 0",
  20000,
);
check("Try again loads the passages once the network is back", true);

// ================= the chapter reader =================
await go("/chapter/KJAV/romans/12", "document.querySelectorAll('[data-verse-block]').length > 15");
await ev("window.scrollTo(0, 0)");
await ev("document.querySelector('[data-verse-block=\"16\"]').scrollIntoView({ block: 'center' })");
await sleep(300);
const scrollBefore = await ev("window.scrollY");
await touch('[data-verse-block="16"]');
await touch('[data-verse-block="16"]');
await waitFor("!!document.querySelector('button[aria-label=\"Show more options\"]')", 8000);
await ev("document.querySelector('button[aria-label=\"Show more options\"]').click()");
await sleep(400);
await waitFor("!!document.querySelector('section[aria-label=\"Cross references\"]')", 8000);
await waitFor(
  "document.querySelectorAll('section[aria-label=\"Cross references\"] a').length > 0",
  15000,
);
const section = await ev(
  "document.querySelector('section[aria-label=\"Cross references\"]').innerText.replace(/\\s+/g, ' ')",
);
check(
  "the verse sheet shows real chips and Explore all (N), no sample wording",
  /cross references/i.test(section) &&
    /Explore all \(\d+\)/.test(section) &&
    !/sample|Thematic/i.test(section) &&
    (await ev("document.querySelectorAll('section[aria-label=\"Cross references\"] a').length")) >=
      3,
  section,
);
const chipHref = await ev(
  "document.querySelector('section[aria-label=\"Cross references\"] a').getAttribute('href')",
);
await ev("document.querySelector('section[aria-label=\"Cross references\"] a').click()");
await waitFor("location.pathname.startsWith('/verse/')", 8000);
check(
  "a chip opens that verse",
  (await path()).startsWith("/verse/KJAV/") && (await path()) === chipHref,
  `${chipHref} -> ${await path()}`,
);
await ev("history.back()");
await waitFor("location.pathname === '/chapter/KJAV/romans/12'", 8000);
await waitFor("document.querySelectorAll('[data-verse-block]').length > 15", 15000);
await sleep(900);
const scrollAfter = await ev("window.scrollY");
check(
  "Back restores the reading position in the chapter",
  Math.abs(scrollAfter - scrollBefore) <= 80 && scrollBefore > 200,
  `${scrollBefore} -> ${scrollAfter}`,
);

// ================= the Explorer =================
await go(
  "/references/KJAV/romans/12/2",
  "document.body.innerText.includes('Scriptural Cross References Explorer')",
);
await waitFor(
  "document.querySelectorAll('article').length > 0 || /No cross-references/.test(document.body.innerText)",
  20000,
);
const explorer = await text();
check(
  "the Explorer shows the anchor and no sample content or invented themes",
  /Romans 12:2/.test(explorer) &&
    !/Sample content|Renewal of the Mind|Mind Renewal|Direct Link|Practical Focus|connected passages/.test(
      explorer,
    ),
);
check(
  "the groups are New Testament and Old Testament",
  /New Testament/.test(explorer) && /Old Testament/.test(explorer),
);
check(
  "it says top 25 of the total, ranked by community votes",
  /top 25 of \d+ related passages, ranked by community votes/i.test(explorer),
  explorer.slice(0, 300),
);
check(
  "the first group is open with passage cards; Read Passage links exist",
  (await ev("document.querySelectorAll('article').length")) > 0 && /Read Passage/.test(explorer),
);
check(
  "the CC BY credit with source and licence links is on the page",
  await ev(
    `(() => { const links = [...document.querySelectorAll('a')].map((a) => a.href); return links.some((h) => h.includes('openbible.info')) && links.some((h) => h.includes('creativecommons.org/licenses/by/4.0')) && /Reformatted/.test(document.body.innerText); })()`,
  ),
);
await waitFor(
  "document.querySelectorAll('article p').length > 0 && /[a-z]{4,}/.test(document.querySelector('article p').innerText)",
  15000,
);
check("passage text is shown in the selected translation", true);
check(
  "the filter sheet is by testament",
  await (async () => {
    await click("button", "Filter");
    await sleep(400);
    const ok = /Filter by testament/.test(await text());
    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    return ok;
  })(),
);
check("no sideways scrolling in the Explorer", !(await sideways()));

// ================= Settings credit =================
await go("/settings", "document.body.innerText.includes('About Verse Snap')");
await click("button", "About Verse Snap");
await sleep(500);
check(
  "Settings → About credits OpenBible.info with the CC BY 4.0 link and the modification note",
  await ev(
    `(() => { const t = document.body.innerText; const links = [...document.querySelectorAll('a')].map((a) => a.href); return /OpenBible\\.info/.test(t) && /Reformatted/.test(t) && links.some((h) => h.includes('creativecommons.org/licenses/by/4.0')); })()`,
  ),
);
check(
  "no console errors or exceptions",
  state.errors.filter(
    (e) => !/open-cross-ref|Failed to load resource|net::ERR/.test(JSON.stringify(e)),
  ).length === 0,
  JSON.stringify(state.errors).slice(0, 300),
);

summary();
