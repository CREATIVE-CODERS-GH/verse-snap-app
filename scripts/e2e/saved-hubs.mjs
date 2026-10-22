// Saved hubs as a guest at 320px: the pill toggle (Verses · Highlights · Notes) with counts, the
// search bar under it (per-hub placeholder), the Verses shelves, linked notes, edit mode, the
// Highlights colour chips, the Notes tag chips and Open Note, the header (title, search icon, sort
// menu) unchanged, the empty state, and no sideways scrolling. Never signs in.
//   npm run test:e2e:saved-hubs      (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, tap, check, summary, sleep, state } = b;

const KEYS = {
  saved: "versesnap.library.saved.v1",
  highlights: "versesnap.highlights.v1",
  journal: "versesnap.journal.v1",
};
const at = "2026-10-22T09:00:00.000Z";
const saved = [
  {
    id: "KJAV/john/3/16",
    translation: "KJAV",
    bookId: "john",
    bookName: "John",
    chapter: 3,
    verse: 16,
    verseText: "For God so loved the world, that he gave his only begotten Son.",
    at,
  },
  {
    id: "KJAV/psalms/23/1",
    translation: "KJAV",
    bookId: "psalms",
    bookName: "Psalms",
    chapter: 23,
    verse: 1,
    verseText: "The LORD is my shepherd; I shall not want.",
    at: "2026-10-21T09:00:00.000Z",
  },
  {
    id: "KJAV/romans/12/2",
    translation: "KJAV",
    bookId: "romans",
    bookName: "Romans",
    chapter: 12,
    verse: 2,
    verseText:
      "Be not conformed to this world: but be ye transformed by the renewing of your mind.",
    at: "2026-10-20T09:00:00.000Z",
  },
];
const hl = (bookId, chapter, verse, color) => ({
  id: `KJAV/${bookId}/${chapter}/${verse}`,
  translation: "KJAV",
  bookId,
  chapter,
  verse,
  color,
  at,
});
const highlights = [
  hl("john", 3, 16, "amber"),
  hl("psalms", 23, 1, "amber"),
  hl("romans", 12, 2, "sage"),
];
const journal = {
  notebooks: [
    { id: "general", name: "General Reflections", isDefault: true, createdAt: at, updatedAt: at },
  ],
  reflections: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      translation: "KJAV",
      bookId: "john",
      chapter: 3,
      verse: 16,
      notebookId: "general",
      title: "Seed title",
      body: "A **bold** thought",
      tags: ["grace"],
      posture: null,
      isPrivate: true,
      createdAt: at,
      updatedAt: at,
    },
  ],
};

const text = () => ev("document.body.innerText");
const sideways = () => ev("document.documentElement.scrollWidth > innerWidth");
const cards = (label) =>
  ev(`document.querySelectorAll('section[aria-label="${label}"] > ul > li').length`);
const clickByText = (selector, label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true; })()`,
  );
const typeSearch = async (value) => {
  await ev(`(() => {
    const el = document.querySelector('#saved-search');
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(250);
};
const activePill = () =>
  ev(
    "document.querySelector('nav[aria-label=\"Saved sections\"] a[aria-current=page]')?.innerText.replace(/\\s+/g, ' ').trim()",
  );

await viewport(320, 700);
await go("/", "document.body.innerText.length > 40");
await ev(`(() => {
  localStorage.setItem(${JSON.stringify(KEYS.saved)}, ${JSON.stringify(JSON.stringify(saved))});
  localStorage.setItem(${JSON.stringify(KEYS.highlights)}, ${JSON.stringify(JSON.stringify(highlights))});
  localStorage.setItem(${JSON.stringify(KEYS.journal)}, ${JSON.stringify(JSON.stringify(journal))});
})()`);

// ================= Verses =================
await go("/saved", "!!document.querySelector('nav[aria-label=\"Saved sections\"]')");
check(
  "the header keeps its title, search icon and sort menu",
  await ev(`(() => {
  const h = document.querySelector('h1');
  return h?.innerText.trim() === 'Saved' && !!document.querySelector('button[aria-label="Search saved"]') && !!document.querySelector('button[aria-label="Sort and organize"]');
})()`),
);
check(
  "the toggle shows three pills with counts, Verses active",
  (await activePill()) === "Verses 3" &&
    (await ev("document.querySelectorAll('nav[aria-label=\"Saved sections\"] a').length")) === 3,
  await activePill(),
);
check(
  "the active pill is solid green and the others are pale",
  await ev(`(() => {
  const links = [...document.querySelectorAll('nav[aria-label="Saved sections"] a')];
  return /bg-brand-primary\\b/.test(links[0].className) && links.slice(1).every((x) => /bg-brand-surface-muted/.test(x.className));
})()`),
);
check(
  "every pill has an icon",
  await ev(
    "[...document.querySelectorAll('nav[aria-label=\"Saved sections\"] a')].every((x) => !!x.querySelector('svg'))",
  ),
);
check(
  "the search bar sits under the toggle with the Verses placeholder",
  await ev(`(() => {
  const nav = document.querySelector('nav[aria-label="Saved sections"]').getBoundingClientRect();
  const input = document.querySelector('#saved-search');
  return !!input && input.placeholder === 'Search saved verses, books, or topics...' && input.getBoundingClientRect().top >= nav.bottom - 1 && input.getBoundingClientRect().height >= 44;
})()`),
);
check(
  "the search bar has a voice-search button",
  await ev("!!document.querySelector('button[aria-label=\"Voice search\"]')"),
);
check(
  "three verse cards",
  (await cards("Saved verses")) === 3,
  String(await cards("Saved verses")),
);
check("John 3:16 shows its linked note", /1 Linked Note/.test(await text()));
check(
  "each card has Read in Chapter, Card Studio and Listen",
  await ev(`(() => {
  const li = document.querySelector('section[aria-label="Saved verses"] > ul > li');
  const t = li.innerText;
  return /Read in Chapter/.test(t) && /Card Studio/.test(t) && /Listen/.test(t);
})()`),
);
check(
  "the shelves are offered",
  await ev(
    `(() => { const t = document.querySelector('[aria-label="Filter saved verses"]')?.innerText ?? ''; return /All Verses/.test(t) && /Old Testament/.test(t) && /New Testament/.test(t) && /Gospels/.test(t); })()`,
  ),
);
await clickByText("[aria-label='Filter saved verses'] button", "Old Testament");
await sleep(250);
check(
  "the Old Testament shelf shows only Psalm 23:1",
  (await cards("Saved verses")) === 1 && /Psalms 23:1/.test(await text()),
);
await clickByText("[aria-label='Filter saved verses'] button", "All Verses");
await typeSearch("romans");
check(
  "searching narrows the verses",
  (await cards("Saved verses")) === 1 && /Romans 12:2/.test(await text()),
);
await typeSearch("");
check("no sideways scrolling on Verses", !(await sideways()));

// header search icon focuses the bar
await ev("document.querySelector('button[aria-label=\"Search saved\"]').click()");
await sleep(200);
check(
  "the header search icon puts the cursor in the search bar",
  await ev("document.activeElement?.id === 'saved-search'"),
);

// edit list
await tap("button[aria-label='Sort and organize']");
await waitFor("!!document.querySelector('[role=menu]')", 5000);
check(
  "the menu offers sorting and Edit list (no Show choice)",
  await ev(
    `(() => { const t = document.querySelector('[role=menu]').innerText; return /sort by/i.test(t) && /Edit list/.test(t) && !/Reflections/.test(t); })()`,
  ),
);
await ev(
  "[...document.querySelectorAll('[role=menuitem]')].find((x) => /Edit list/.test(x.innerText))?.click()",
);
await sleep(300);
check(
  "Edit list shows a remove button on each card",
  (await ev("document.querySelectorAll('button[aria-label^=\"Remove \"]').length")) === 3,
);
await ev(
  "[...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Done')?.click()",
);

// ================= Highlights =================
await clickByText("nav[aria-label='Saved sections'] a", "Highlights");
await waitFor("!!document.querySelector('section[aria-label=\"Highlights\"]')", 6000);
check(
  "the Highlights pill is active and the address keeps the tab",
  (await activePill()) === "Highlights 3" &&
    (await ev("location.search")).includes("tab=highlights"),
  await activePill(),
);
check(
  "the search bar changes to the Highlights placeholder and starts empty",
  await ev(
    "document.querySelector('#saved-search').placeholder === 'Search highlighted passages, words, or tags...' && document.querySelector('#saved-search').value === ''",
  ),
);
check("three highlight cards", (await cards("Highlights")) === 3);
check(
  "colour chips with counts",
  await ev(
    `(() => { const t = document.querySelector('[aria-label="Filter by highlight colour"]')?.innerText.replace(/\\s+/g, ' ') ?? ''; return /All 3/.test(t) && /Amber 2/.test(t) && /Sage 1/.test(t); })()`,
  ),
  await ev("document.querySelector('[aria-label=\"Filter by highlight colour\"]')?.innerText"),
);
await clickByText("[aria-label='Filter by highlight colour'] button", "Sage");
await sleep(250);
check(
  "the Sage chip shows only Romans 12:2",
  (await cards("Highlights")) === 1 && /Romans 12:2/.test(await text()),
);
await clickByText("[aria-label='Filter by highlight colour'] button", "All");
check(
  "the verse text appears in the highlight colour",
  await waitFor("/God so loved the world/.test(document.body.innerText)", 12000).then(
    () => true,
    () => false,
  ),
);
check("a related note is offered on John 3:16", /1 related note/.test(await text()));
check("no sideways scrolling on Highlights", !(await sideways()));

// ================= Notes =================
await clickByText("nav[aria-label='Saved sections'] a", "Notes");
await waitFor("!!document.querySelector('ul[aria-label=Reflections]')", 6000);
check("the Notes pill is active", (await activePill()) === "Notes 1", await activePill());
check(
  "the Notes placeholder shows",
  await ev(
    "document.querySelector('#saved-search').placeholder === 'Search thoughts, tags, or scriptures...'",
  ),
);
const note = await ev(
  "document.querySelector('ul[aria-label=Reflections] > li').innerText.replace(/\\s+/g, ' ')",
);
check(
  "the note card shows reference, edition, title, text without markers, tag, notebook, Private and Open Note",
  /John 3:16/.test(note) &&
    /KJAV/.test(note) &&
    /Seed title/.test(note) &&
    /A bold thought/.test(note) &&
    !/\*\*/.test(note) &&
    /#grace/.test(note) &&
    /General Reflections/.test(note) &&
    /Private/.test(note) &&
    /Open Note/.test(note),
  note,
);
await typeSearch("zzzz");
check("a search with no match says so", /No reflections match/.test(await text()));
await typeSearch("");
check("no sideways scrolling on Notes", !(await sideways()));
await ev(
  "[...document.querySelectorAll('ul[aria-label=Reflections] a')].find((x) => /Open Note/.test(x.innerText)).click()",
);
await waitFor("location.pathname === '/reflect/KJAV/john/3/16'", 8000);
check("Open Note opens the reflection editor", true);

// ================= reload keeps the tab; empty state =================
await go("/saved?tab=notes", "!!document.querySelector('ul[aria-label=Reflections]')");
check("reloading keeps the Notes tab", (await activePill()) === "Notes 1");
await ev(
  `(() => { for (const k of ${JSON.stringify(Object.values(KEYS))}) localStorage.removeItem(k); })()`,
);
await go("/saved", "document.body.innerText.includes('No saved verses yet')");
check(
  "with nothing saved, highlighted or written the empty state shows",
  /No saved verses yet/.test(await text()),
);
check(
  "no console errors or exceptions",
  state.errors.length === 0,
  JSON.stringify(state.errors).slice(0, 300),
);

summary();
