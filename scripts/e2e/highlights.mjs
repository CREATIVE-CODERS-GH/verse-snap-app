// Verse highlights as a guest (this device) in the chapter reader: set, persist across reloads,
// change, remove, translation isolation, and the Reflection link carrying the saved colour.
// Uses the live public Bible API for verse text; never signs in or writes to the database.
//   npm run test:e2e:highlights   (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, shot, check, state, sleep } = b;

const KEY = "versesnap.highlights.v1";
const CHAPTER = "/chapter/KJAV/john/3";
const loaded = "document.querySelectorAll('[data-verse-block]').length > 10";
const stored = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? '[]')`);
const tintOf = (verse) =>
  ev(
    `(document.querySelector('[data-verse-block="${verse}"]')?.className.match(/bg-hl-([a-z]+)\\/70/) ?? [])[1] ?? null`,
  );

/** Opens the annotation sheet for a verse the way a reader does: two taps. */
async function openSheet(verse) {
  for (let tap = 0; tap < 2; tap += 1) {
    await ev(`document.querySelector('[data-verse-block="${verse}"]').click()`);
    await sleep(350);
  }
  return waitFor(
    "!!document.querySelector('[role=radiogroup][aria-label=\"Highlight colour\"]')",
    5000,
  );
}
const pick = async (label) => {
  await ev(`document.querySelector('[role=radio][aria-label=${JSON.stringify(label)}]').click()`);
  await sleep(500);
};
const reload = () => go(CHAPTER, loaded);

await viewport(390, 844);
await go("/", "document.body.innerText.length > 40");
await ev(`localStorage.removeItem(${JSON.stringify(KEY)}); true`);

// ---------- set and persist ----------
await reload();
check("annotation sheet opens with the highlight colours", await openSheet(16));
await pick("Sage highlight");
let saved = await stored();
check(
  "choosing Sage saves the highlight on this device right away",
  saved.length === 1 && saved[0].id === "KJAV/john/3/16" && saved[0].color === "sage",
  JSON.stringify(saved),
);
await reload();
check(
  "after a reload the verse is still highlighted Sage",
  (await tintOf(16)) === "sage",
  String(await tintOf(16)),
);
await ev(
  "document.querySelector('[data-verse-block=\"16\"]').scrollIntoView({ block: 'center' }); true",
);
await sleep(400);
await shot("highlight-sage-after-reload.png");

// ---------- change ----------
await openSheet(16);
check(
  "reopening the sheet shows the saved colour selected",
  await ev(
    "document.querySelector('[role=radio][aria-label=\"Sage highlight\"]')?.getAttribute('aria-checked') === 'true'",
  ),
);
await pick("Rose highlight");
await reload();
saved = await stored();
check(
  "changing to Rose replaces it (still one highlight for the verse)",
  (await tintOf(16)) === "rose" && saved.length === 1 && saved[0].color === "rose",
  JSON.stringify(saved),
);

// ---------- a second verse, and the Reflection link ----------
await openSheet(17);
await pick("Lilac highlight");
await ev("document.querySelector('button[aria-label=\"Show more options\"]')?.click()");
await waitFor(
  "[...document.querySelectorAll('button')].some((x) => /Add Reflection/.test(x.innerText))",
  5000,
);
await ev(
  "[...document.querySelectorAll('button')].find((x) => /Add Reflection/.test(x.innerText))?.click()",
);
await waitFor("location.pathname.startsWith('/reflect/')", 8000);
check(
  "Add Reflection carries the verse's saved colour",
  (await ev("location.pathname + location.search")) === "/reflect/KJAV/john/3/17?tone=lilac",
  await ev("location.pathname + location.search"),
);

// ---------- translation isolation ----------
await go("/chapter/WEB/john/3", loaded);
check(
  "the same chapter in another translation has no highlights",
  (await tintOf(16)) === null && (await tintOf(17)) === null,
);
await openSheet(16);
await pick("Sky highlight");
await go(CHAPTER, loaded);
check("highlighting in WEB doesn't change the KJAV highlight", (await tintOf(16)) === "rose");
await go("/chapter/WEB/john/3", loaded);
check("…and WEB keeps its own", (await tintOf(16)) === "sky");

// ---------- remove ----------
await go(CHAPTER, loaded);
await openSheet(16);
await pick("Clear highlight");
await reload();
saved = await stored();
check(
  "Clear removes the highlight; others are kept",
  (await tintOf(16)) === null &&
    (await tintOf(17)) === "lilac" &&
    saved
      .map((entry) => entry.id)
      .sort()
      .join(",") === "KJAV/john/3/17,WEB/john/3/16",
  JSON.stringify(saved.map((entry) => entry.id)),
);

// ---------- another chapter ----------
await go("/chapter/KJAV/john/4", loaded);
check(
  "highlights stay with their chapter",
  (await tintOf(16)) === null && (await tintOf(17)) === null,
);

check("no console errors or exceptions", state.errors.length === 0, state.errors.join(" | "));
b.summary();
