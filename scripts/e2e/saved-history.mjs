// Saved and History as a guest (this device), including chapter reading in History.
// Uses the live public Bible API for verse text; never signs in or writes to the database.
//   npm run test:e2e:library      (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, shot, clickText, check, state, sleep } = b;

const SAVED = "versesnap.library.saved.v1";
const HISTORY = "versesnap.library.history.v1";
const stored = (key) => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}) ?? '[]')`);
const historyLinks = () =>
  ev(
    '[...document.querySelectorAll(\'main a[href^="/chapter/"], main a[href^="/verse/"]\')]' +
      ".map((a) => ({ href: a.getAttribute('href'), text: a.innerText.replace(/\\s+/g, ' ').trim() }))",
  );
const chapterLoaded = "document.querySelectorAll('[data-verse-block]').length > 3";
// The reader records a chapter after 4 seconds on the page.
const DWELL_MS = 5000;

await viewport(390, 844);
await go("/", "document.body.innerText.length > 40");
await ev(
  "localStorage.removeItem('versesnap.library.saved.v1'); localStorage.removeItem('versesnap.library.history.v1')",
);

// ---------- Saved ----------
await go("/verse/KJAV/john/3/16", "/God so loved/.test(document.body.innerText)");
check(
  "verse page: opening a verse records it in History",
  (await stored(HISTORY)).some((entry) => entry.id === "KJAV/john/3/16" && entry.kind === "verse"),
);
await ev(
  "[...document.querySelectorAll('article button')].find((x) => x.innerText.trim() === 'Save').click()",
);
await waitFor(
  "[...document.querySelectorAll('article button')].some((x) => x.innerText.trim() === 'Saved')",
  8000,
);
const savedList = await stored(SAVED);
check(
  "verse page: Save keeps the verse on this device",
  savedList.length === 1 && savedList[0].id === "KJAV/john/3/16" && savedList[0].verse === 16,
  JSON.stringify(savedList),
);

await go("/saved", "document.body.innerText.includes('John 3:16')");
check(
  "Saved lists the saved verse",
  /John 3:16/.test(await ev("document.querySelector('main').innerText")),
);
check(
  "Saved: the row opens the verse in its translation",
  await ev("!!document.querySelector('main a[href=\"/verse/KJAV/john/3/16\"]')"),
);
await shot("saved-guest.png");

// ---------- Chapter reading in History ----------
await go("/chapter/KJAV/romans/12", chapterLoaded);
await sleep(DWELL_MS);
await go("/chapter/KJAV/psalms/23", chapterLoaded);
await sleep(1000); // left before the 4-second mark: not recorded
await go("/history", "document.body.innerText.includes('Romans 12')");
let links = await historyLinks();
check(
  "History shows the chapter that was read, linking to the chapter",
  links.some(
    (link) =>
      link.href === "/chapter/KJAV/romans/12" &&
      /Romans 12\b/.test(link.text) &&
      /Chapter/.test(link.text),
  ),
  JSON.stringify(links),
);
check(
  "History keeps the verse entry separate from chapter entries",
  links.some((link) => link.href === "/verse/KJAV/john/3/16" && /John 3:16/.test(link.text)),
  JSON.stringify(links),
);
check(
  "a chapter left within 4 seconds isn't recorded",
  !links.some((link) => link.href.includes("psalms/23")),
  JSON.stringify(links),
);
const chapterEntry = (await stored(HISTORY)).find((entry) => entry.kind === "chapter");
check(
  "chapter entry stores no verse position",
  chapterEntry && chapterEntry.verse === null && chapterEntry.id === "chapter:KJAV/romans/12",
  JSON.stringify(chapterEntry),
);
await shot("history-guest.png");

// Reading it again moves it to the top without a duplicate; another translation is its own entry.
await go("/chapter/KJAV/romans/12", chapterLoaded);
await sleep(DWELL_MS);
await go("/chapter/WEB/romans/12", chapterLoaded);
await sleep(DWELL_MS);
const ids = (await stored(HISTORY)).map((entry) => entry.id);
check(
  "re-reading a chapter doesn't duplicate it; each translation has its own entry",
  ids.filter((id) => id === "chapter:KJAV/romans/12").length === 1 &&
    ids[0] === "chapter:WEB/romans/12" &&
    ids[1] === "chapter:KJAV/romans/12",
  JSON.stringify(ids),
);

await go("/history", "document.body.innerText.includes('Romans 12')");
await ev("document.querySelector('main a[href=\"/chapter/KJAV/romans/12\"]').click()");
await waitFor("location.pathname === '/chapter/KJAV/romans/12'", 10000);
await waitFor(chapterLoaded, 20000);
check(
  "tapping the chapter entry reopens that book, chapter and translation",
  (await ev("location.pathname")) === "/chapter/KJAV/romans/12" &&
    /Chapter 12/.test(await ev("document.body.innerText")),
  await ev("location.pathname"),
);

// ---------- Remove and clear ----------
await go("/saved", "document.body.innerText.includes('John 3:16')");
await b.tap("button[aria-label='Sort and organize']");
await waitFor("!!document.querySelector('[role=menu]')", 5000);
await ev(
  "[...document.querySelectorAll('[role=menuitem]')].find((x) => x.innerText.trim() === 'Edit list').click()",
);
await waitFor("!!document.querySelector('button[aria-label=\"Remove John 3:16\"]')", 5000);
await ev("document.querySelector('button[aria-label=\"Remove John 3:16\"]').click()");
await waitFor("!document.querySelector('main a[href=\"/verse/KJAV/john/3/16\"]')", 8000);
check("Saved: removing the verse clears it from this device", (await stored(SAVED)).length === 0);

await go("/history", "document.body.innerText.includes('Romans 12')");
await clickText(/^Clear$/, "main");
await waitFor("!!document.querySelector('[role=alertdialog]')", 5000);
await clickText(/^Clear history$/, "[role=alertdialog]");
await waitFor(
  "JSON.parse(localStorage.getItem('versesnap.library.history.v1') ?? '[]').length === 0",
  8000,
);
check("History: Clear removes verse and chapter entries", (await stored(HISTORY)).length === 0);

check("no console errors or exceptions", state.errors.length === 0, state.errors.join(" | "));
b.summary();
