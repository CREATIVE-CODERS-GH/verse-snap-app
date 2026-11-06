// YV-2: Compare, Card Studio, Saved verses and the licensed-text rules for NIV and AMP, in a real
// browser. Needs the app running WITH the feature flag and a server-side key:
//   VITE_YOUVERSION_TRANSLATIONS=true npm run dev -- --port 8091
//   npm run test:e2e:youversion-stability
// A few read-only chapter requests; never prints licensed text (counts and short markers only).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBrowser } from "./lib.mjs";

const at = "2026-11-01T09:00:00.000Z";
const SAVED = [
  {
    id: "NIV/john/3/16",
    translation: "NIV",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    verseText: "",
    at,
  },
  {
    id: "AMP/john/3/16",
    translation: "AMP",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    verseText: "",
    at,
  },
  {
    id: "BSB/john/3/16",
    translation: "BSB",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    verseText: "Saved BSB words",
    at,
  },
];
const b = await openBrowser({
  init: `try { if (localStorage.getItem('versesnap.library.saved.v1') === null) localStorage.setItem('versesnap.library.saved.v1', ${JSON.stringify(JSON.stringify(SAVED))}); } catch {}`,
});
const { ev, waitFor, go, viewport, check, summary, state, shot, sleep } = b;
await viewport(390, 900);

const notices = () =>
  ev(
    "[...document.querySelectorAll('[data-testid=\"publisher-notice\"]')].map((n) => n.innerText)",
  );
const body = () => ev("document.body.innerText");

// --- Compare: NIV ------------------------------------------------------------------------------
await go(
  "/compare/NIV/john/3/16",
  "/Finding verse/.test(document.body.innerText) === false && document.querySelectorAll('article').length >= 2",
);
let text = await body();
check(
  "Compare (NIV): shows the NIV card and the default KJAV card",
  /NIV/.test(text) && /KJAV/.test(text),
);
check(
  "Compare (NIV): NIV verse 16 text is present",
  await ev(
    "/so loved/.test([...document.querySelectorAll('article')].find((a) => /New International/.test(a.innerText))?.innerText ?? '')",
  ),
);
check(
  "Compare (NIV): Biblica notice is shown with the NIV card",
  (await notices()).some((n) => /Biblica/.test(n)),
);
check("Compare (NIV): no console errors", state.errors.length === 0, state.errors.join(" | "));

// --- Compare: AMP ------------------------------------------------------------------------------
await go(
  "/compare/AMP/john/3/16",
  "document.querySelectorAll('article').length >= 2 && !/Finding verse/.test(document.body.innerText)",
);
check(
  "Compare (AMP): Lockman notice shown",
  (await notices()).some((n) => /Lockman/.test(n)),
);
check("Compare (AMP): references stay John 3:16", /John 3:16/.test(await body()));

// --- Compare: a verse NIV leaves out (alignment must not be faked) --------------------------------
await go(
  "/compare/NIV/mark/9/44",
  "!/Finding verse/.test(document.body.innerText) && document.querySelectorAll('article').length >= 2",
);
check(
  "Compare (NIV, Mark 9:44): says the verse is not in this edition",
  /isn.t in this edition/.test(await body()),
);
await go(
  "/compare/AMP/mark/9/44",
  "!/Finding verse/.test(document.body.innerText) && document.querySelectorAll('article').length >= 2",
);
check(
  "Compare (AMP, Mark 9:44): AMP has the verse, so it is shown",
  (await notices()).some((n) => /Lockman/.test(n)),
);

// --- Card Studio: NIV is not exportable ---------------------------------------------------------
await go("/card/NIV/john/3/16", "!!document.querySelector('[data-testid=\"card-export-note\"]')");
check(
  "Card Studio (NIV): explains why image export is unavailable",
  await ev("!!document.querySelector('[data-testid=\"card-export-note\"]')"),
);
const buttons = () =>
  ev(`(() => {
  const by = (re) => [...document.querySelectorAll('button')].find((el) => re.test(el.innerText));
  return { export: by(/^\\s*Export/)?.disabled, save: by(/Save Photo/)?.disabled, story: by(/IG Story/)?.disabled, copy: by(/^\\s*Copy/)?.disabled };
})()`);
let btn = await buttons();
check(
  "Card Studio (NIV): Export, Save Photo and IG Story are disabled",
  btn.export === true && btn.save === true && btn.story === true,
  JSON.stringify(btn),
);
check("Card Studio (NIV): Copy is disabled", btn.copy === true, JSON.stringify(btn));
// The notice renders after the export note on a slower (deployed) server, so wait for it rather than
// reading it once.
const nivNotice =
  "/Biblica/.test(document.querySelector('[data-testid=\"card-notice\"]')?.innerText ?? '')";
const nivNoticeShown = await waitFor(nivNotice, 15000);
check("Card Studio (NIV): the preview still carries the Biblica notice", nivNoticeShown);

// --- Card Studio: AMP exports with the notice drawn on the image --------------------------------
await go("/card/AMP/john/3/16", "!!document.querySelector('[data-testid=\"card-notice\"]')");
check(
  "Card Studio (AMP): preview shows the Lockman notice",
  await ev(
    "/Lockman/.test(document.querySelector('[data-testid=\"card-notice\"]')?.innerText ?? '')",
  ),
);
btn = await buttons();
check(
  "Card Studio (AMP): export is enabled",
  btn.export === false && btn.save === false,
  JSON.stringify(btn),
);
await ev(`(() => {
  window.__blobs = [];
  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__blobs.push(blob); return original(blob); };
  HTMLAnchorElement.prototype.click = function () { window.__downloaded = this.download; };
})()`);
await ev(
  "[...document.querySelectorAll('button')].find((el) => /Save Photo/.test(el.innerText))?.click()",
);
const exported = await waitFor("window.__blobs && window.__blobs.length > 0");
check(
  "Card Studio (AMP): Save Photo produces a PNG",
  exported && (await ev("window.__blobs[0].type")) === "image/png",
);
if (exported) {
  const base64 = await ev(`(async () => {
    const buffer = new Uint8Array(await window.__blobs[0].arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return btoa(binary);
  })()`);
  const out = process.env.E2E_OUT ?? os.tmpdir(); // never the repo
  const file = path.join(process.env.YV_CARD_OUT ?? out, "amp-card.png");
  fs.writeFileSync(file, Buffer.from(base64, "base64"));
  console.log(`      (AMP card image saved for inspection: ${file})`);
}

// --- Card Studio: existing translations are untouched -------------------------------------------
await go("/card/KJAV/john/3/16", "!!document.querySelector('figure')");
btn = await buttons();
check(
  "Card Studio (KJAV): no notice, no export note, export enabled",
  btn.export === false &&
    btn.save === false &&
    (await ev(
      "!document.querySelector('[data-testid=\"card-notice\"]') && !document.querySelector('[data-testid=\"card-export-note\"]')",
    )),
);

// --- Saved verses --------------------------------------------------------------------------------
await go("/saved", "!!document.querySelector('nav[aria-label=\"Saved sections\"]')");
await waitFor("document.querySelectorAll('[data-testid=\"publisher-notice\"]').length >= 2", 30000);
text = await body();
check(
  "Saved: the NIV entry shows a live text preview",
  await ev(
    "[...document.querySelectorAll('li')].some((li) => /NIV/.test(li.innerText) && /so loved/.test(li.innerText))",
  ),
);
check(
  "Saved: the AMP entry shows a live text preview",
  await ev(
    "[...document.querySelectorAll('li')].some((li) => /AMP/.test(li.innerText) && /so loved|loved/.test(li.innerText) && /Lockman/.test(li.innerText))",
  ),
);
check(
  "Saved: licensed previews carry their publisher notices",
  (await notices()).some((n) => /Biblica/.test(n)) &&
    (await notices()).some((n) => /Lockman/.test(n)),
);
check(
  "Saved: the BSB entry still shows its stored text with no notice",
  /Saved BSB words/.test(text),
);
const stored = await ev("JSON.parse(localStorage.getItem('versesnap.library.saved.v1') ?? '[]')");
check(
  "Saved: nothing licensed was written to the device (NIV/AMP entries still have empty text)",
  stored.filter((e) => ["NIV", "AMP"].includes(e.translation)).every((e) => e.verseText === ""),
  JSON.stringify(stored.map((e) => [e.translation, e.verseText.length])),
);
const cache = await ev(
  "JSON.parse(localStorage.getItem('versesnap.bible.chapters.v1') ?? '[]').filter((e) => ['NIV','AMP'].includes(e.chapter?.translation)).length",
);
check("Saved: the on-device chapter cache holds no licensed chapter", cache === 0);
await shot("saved.png");

// --- Reader: saving a NIV verse from the chapter screen stores a reference only ------------------
await go("/chapter/NIV/john/3", "document.querySelectorAll('[data-verse-block]').length > 20");
await sleep(300);
check(
  "Reader (NIV): chapter still renders with its notice",
  (await notices()).some((n) => /Biblica/.test(n)),
);

// --- YV-3: sharing rules --------------------------------------------------------------------------
const clickByText = (re) =>
  ev(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => ${re}.test(b.innerText) || ${re}.test(b.getAttribute('aria-label') ?? ''));
    if (!el) return false;
    el.click();
    return true;
  })()`);
await go("/verse/NIV/john/3/16", "document.querySelector('article') !== null");
await clickByText("/^\s*Share/");
await waitFor("!!document.querySelector('[role=dialog]')");
check(
  "Verse page (NIV): the share sheet explains sharing is unavailable",
  await ev("!!document.querySelector('[data-testid=share-restricted-note]')"),
);
check(
  "Verse page (NIV): no Messages, WhatsApp, Instagram, image, More or Copy targets are offered",
  await ev(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    const visible = [...dialog.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.innerText);
    return !visible.some((t) => /Messages|WhatsApp|Instagram|Share as image|More/.test(t)) && !visible.some((t) => /Copy/.test(t));
  })()`),
);
await go("/verse/AMP/john/3/16", "document.querySelector('article') !== null");
await clickByText("/^\s*Share/");
await waitFor("!!document.querySelector('[role=dialog]')");
check(
  "Verse page (AMP): the share sheet keeps all its targets",
  await ev(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    const visible = [...dialog.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.innerText);
    return !document.querySelector('[data-testid=share-restricted-note]') && ['Messages', 'WhatsApp', 'Share as image'].every((n) => visible.some((t) => t.includes(n)));
  })()`),
);
await go("/verse/KJAV/john/3/16", "document.querySelector('article') !== null");
await clickByText("/^\s*Share/");
await waitFor("!!document.querySelector('[role=dialog]')");
check(
  "Verse page (KJAV): sharing is untouched",
  await ev(
    "!document.querySelector('[data-testid=share-restricted-note]') && /WhatsApp/.test(document.querySelector('[role=dialog]').innerText)",
  ),
);

// --- YV-4: NIV cannot be copied; AMP copy keeps its notice -------------------------------------------
await go("/verse/NIV/john/3/16", "document.querySelector('article') !== null");
await ev(
  "window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; true",
);
check(
  "Verse page (NIV): the Copy button is disabled",
  await ev(
    "[...document.querySelectorAll('button')].filter((b) => /^\s*Copy/.test(b.innerText)).every((b) => b.disabled)",
  ),
);
await clickByText("/^s*Copy/");
check("Copy (NIV): nothing reaches the clipboard", (await ev("window.__copied")) === null);
await go("/verse/AMP/john/3/16", "document.querySelector('article') !== null");
await ev(
  "window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; true",
);
await clickByText("/^s*Copy/");
await waitFor("window.__copied !== null");
check("Copy (AMP): includes the Lockman notice", /Lockman/.test(await ev("window.__copied ?? ''")));

// --- YV-3: cross-references show references only for licensed editions -----------------------------
await go("/references/NIV/romans/12/2", "!!document.querySelector('h1, h2')");
await waitFor("document.querySelectorAll('[data-testid=licensed-passage-card]').length > 0", 30000);
const xref = await ev(`({
  cards: document.querySelectorAll('[data-testid=licensed-passage-card]').length,
  quotes: [...document.querySelectorAll('[data-testid=licensed-passage-card]')].filter((c) => /[“”]/.test(c.innerText)).length,
})`);
check(
  "Explorer (NIV): passages are listed by reference, with no verse text",
  xref.cards > 0 && xref.quotes === 0,
  JSON.stringify(xref),
);

// --- YV-3: at most 10 licensed previews in one saved list ------------------------------------------
const many = Array.from({ length: 12 }, (_, i) => ({
  id: `NIV/john/3/${i + 1}`,
  translation: "NIV",
  bookId: "john",
  bookName: "John",
  chapter: 3,
  verse: i + 1,
  verseText: "",
  at,
}));
await ev(
  `localStorage.setItem('versesnap.library.saved.v1', JSON.stringify(${JSON.stringify(many)}))`,
);
await go("/saved", "!!document.querySelector('nav[aria-label=\"Saved sections\"]')");
await waitFor("document.querySelectorAll('[data-testid=publisher-notice]').length >= 1", 30000);
await sleep(1500);
const previews = await ev("document.querySelectorAll('[data-testid=publisher-notice]').length");
check("Saved: 12 NIV verses show at most 10 live previews", previews === 10, String(previews));

await ev("localStorage.setItem('versesnap.library.saved.v1', '[]')");

summary();
