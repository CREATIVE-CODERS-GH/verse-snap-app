// Reader regression across all six editions (KJAV, BSB, WEB, ASV, BBE, FBV): verse and chapter pages
// load, words and punctuation are not run together, and nothing overflows at phone widths.
// Uses the real Bible service (HelloAO) through the running app; no database, no login.
//   node scripts/e2e/reader-spacing.mjs     (with `npm run dev -- --port 8091` running; settings in lib.mjs)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser({ timeoutMs: 900000 });
const { ev, go, viewport, check, state, waitFor } = b;

const EDITIONS = ["KJAV", "BSB", "WEB", "ASV", "BBE", "FBV"];
// Closing punctuation followed at once by a letter or an opening quote: words that were run together.
const RUN_TOGETHER = /[.,;:!?”)][A-Za-z“‘]/;
const PAGES = [
  ["verse", (e) => `/verse/${e}/genesis/3/14`, "Genesis", 120],
  ["verse", (e) => `/verse/${e}/psalms/23/1`, "Psalms", 120],
  ["chapter", (e) => `/chapter/${e}/psalms/23`, "Psalms", 400],
  ["chapter", (e) => `/chapter/${e}/matthew/5`, "Matthew", 1500],
  ["chapter", (e) => `/chapter/${e}/isaiah/53`, "Isaiah", 600],
];

const overflow = () => ev("document.documentElement.scrollWidth - innerWidth");
const body = () => ev("document.body.innerText");
const samples = [];

await viewport(390, 844);
for (const edition of EDITIONS) {
  for (const [kind, route, needle, minLength] of PAGES) {
    await go(
      route(edition),
      `document.body.innerText.includes(${JSON.stringify(needle)}) && document.body.innerText.length > ${minLength}`,
    );
    const text = await body();
    const hit = text.match(new RegExp(`.{0,25}${RUN_TOGETHER.source}.{0,25}`));
    check(
      `${edition} ${kind} ${route(edition).split("/").slice(3).join(" ")}: loads, words not run together`,
      text.includes(needle) && text.length > minLength && !hit,
      hit ? JSON.stringify(hit[0]) : "did not load",
    );
    if (kind === "verse" && route(edition).endsWith("/3/14"))
      samples.push([
        edition,
        text
          .split("\n")
          .find((l) => /serpent|snake/i.test(l))
          ?.slice(0, 110),
      ]);
  }
}

// The edition names and navigation still work at three phone widths (one chapter per edition).
for (const [width, height] of [
  [360, 780],
  [390, 844],
  [430, 932],
]) {
  await viewport(width, height);
  for (const edition of EDITIONS) {
    await go(
      `/chapter/${edition}/psalms/23`,
      "document.body.innerText.includes('Psalms') && document.body.innerText.length > 400",
    );
    check(
      `${width}px ${edition} Psalm 23: no overflow, no console errors`,
      (await overflow()) <= 0 && state.errors.length === 0,
      `${await overflow()}px ${state.errors.join("|").slice(0, 120)}`,
    );
  }
}

console.log("\nGenesis 3:14 in each edition:");
for (const [edition, line] of samples) console.log(`  ${edition}: ${line}`);
b.summary();
