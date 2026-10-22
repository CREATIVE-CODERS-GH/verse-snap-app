// Basic mobile smoke test: the main screens render at phone widths with no horizontal overflow
// and no console errors, and the bottom tabs are present. Guest only; no database writes.
//   npm run test:e2e:smoke        (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, go, viewport, shot, check, state } = b;

const SCREENS = [
  ["/", "Home", "Verse Snap"],
  ["/books", "Books", "Testament"],
  ["/chapter/KJAV/romans/12", "Chapter", "Chapter 12"],
  ["/verse/KJAV/john/3/16", "Verse", "God so loved"],
  ["/search?q=John%203%3A16", "Reference search", "John 3:16"],
  ["/saved", "Saved", "Saved"],
  ["/history", "History", "History"],
  ["/settings", "Settings", "Settings"],
  ["/reflect/KJAV/john/3/16", "Reflection", "Save Note"],
];
const TABS = "Home,Read,Saved,History,Settings";

const overflow = () => ev("document.documentElement.scrollWidth - innerWidth");
const tabs = () =>
  ev(
    "[...document.querySelectorAll('nav.fixed:not([aria-label]) li')].map((li) => li.innerText.trim()).join(',')",
  );

for (const [width, height] of [
  [360, 780],
  [390, 844],
  [430, 932],
]) {
  await viewport(width, height);
  for (const [route, label, needle] of SCREENS) {
    await go(route, `document.body.innerText.includes(${JSON.stringify(needle)})`);
    const text = await ev("document.body.innerText");
    const extra = await overflow();
    check(
      `${width}px ${label}: renders without overflow or console errors`,
      text.includes(needle) && extra <= 0 && state.errors.length === 0,
      `overflow ${extra}px; ${state.errors.join(" | ").slice(0, 160)}`,
    );
    if (width === 390) await shot(`smoke-${label.toLowerCase().replace(/[^a-z]+/g, "-")}.png`);
  }
  await go("/");
  check(`${width}px: bottom tabs are ${TABS}`, (await tabs()) === TABS, await tabs());
}

b.summary();
