// With Discover switched off (the default: VITE_YOUVERSION_DISCOVER unset), the Search screen is exactly
// Verse Snap's own: no mode switch, the original field, and ?mode=discover falls back to it. Needs the app
// running WITHOUT the Discover flag:  npm run dev -- --port 8091   then   npm run test:e2e:discover-off
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, go, viewport, check, summary, send } = b;
await viewport(390, 844);
const placeholder = () => ev("document.querySelector('input[name=q]')?.placeholder");

await go("/search", "!!document.querySelector('input[name=q]')");
check(
  "Discover off: no mode switch on Search",
  (await ev("document.querySelector('[data-testid=search-mode-switch]')")) === null,
);
check(
  "Discover off: the original search field",
  (await placeholder()) === "Search verses, references...",
);
check(
  "Discover off: Verse Snap's camera prompt and suggestions are still there",
  await ev("/Try searching for/.test(document.body.innerText)"),
);

await go("/search?mode=discover&t=NIV&q=love", "!!document.querySelector('input[name=q]')");
check(
  "Discover off: ?mode=discover falls back to Verse Snap search",
  (await placeholder()) === "Search verses, references..." &&
    (await ev("document.querySelector('[data-testid=discover-body]')")) === null,
);
await send("Browser.close").catch(() => {});
summary();
