// Reflection Journal as a guest (this device): create, reopen, edit and delete a reflection;
// create, rename and delete notebooks; browse reflections in Saved; translation isolation; the
// saved highlight on the reference card; a failed save keeping the text; the leave warning; and
// mobile layout. Uses the live public Bible API for verse text; never signs in.
//   npm run test:e2e:journal      (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, shot, tap, check, state, sleep } = b;

const KEY = "versesnap.journal.v1";
const EDITOR = "/reflect/KJAV/john/3/16";
const ready =
  "!!document.querySelector('textarea[aria-label=Reflection]') && /God so loved/.test(document.body.innerText)";
const stored = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? '{}')`);
const text = () => ev("document.body.innerText");
const statusText = () =>
  ev("document.querySelector('[data-testid=draft-status]')?.innerText ?? ''");
const toastSeen = (pattern) => waitFor(`${pattern}.test(document.body.innerText)`, 6000);
const type = async (selector, value) => {
  await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(150);
};
const clickButton = (label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`,
  );
const save = async () => {
  await ev(
    "document.querySelector('button[aria-label=\"Save Note\"], button[aria-label^=\"Save\"]')?.click() ?? [...document.querySelectorAll('button')].find((x) => /Save Note/.test(x.innerText))?.click()",
  );
  await sleep(600);
};
const openNotebooks = async () => {
  await ev(
    "document.querySelector('button[aria-labelledby=\"notebook-label notebook-name\"]').click()",
  );
  return waitFor("!!document.querySelector('[role=dialog] input[name=notebook]')", 5000);
};
const closeSheet = async () => {
  await ev("document.querySelector('[role=dialog] button[aria-label=Close]')?.click()");
  await sleep(400);
};
const openMenu = async () => {
  await tap("button[aria-label='More options']");
  return waitFor("!!document.querySelector('[role=menu]')", 5000);
};
const menuItem = (label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll('[role=menuitem], [role=menuitemradio]')].find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`,
  );

await viewport(390, 844);
await go("/", "document.body.innerText.length > 40");
await ev(
  `localStorage.removeItem(${JSON.stringify(KEY)}); localStorage.setItem('versesnap.highlights.v1', JSON.stringify([{ id: 'KJAV/john/3/16', translation: 'KJAV', bookId: 'john', chapter: 3, verse: 16, color: 'sky', at: '2026-01-01T00:00:00.000Z' }])); true`,
);

// ---------- create ----------
await go(EDITOR, ready);
check(
  "a new note says it isn't saved yet",
  /New reflection · not saved yet/.test(await statusText()),
  await statusText(),
);
check(
  "the reference card shows the verse's saved highlight",
  /Highlight: Clear Sky/.test(await text()),
);
await type(
  "textarea[aria-label=Reflection]",
  "God gave his Son. I want to live from that love today.",
);
await ev(
  "[...document.querySelectorAll('button[aria-pressed]')].find((x) => x.innerText.includes('#Faith'))?.click()",
);
await sleep(1400);
check("typing shows unsaved changes", /not saved yet/.test(await statusText()), await statusText());
await save();
check("Save Note saves on this device", await toastSeen("/Reflection saved/"));
let journal = await stored();
check(
  "the reflection is stored with its verse, translation, notebook and tag",
  journal.reflections?.length === 1 &&
    journal.reflections[0].translation === "KJAV" &&
    journal.reflections[0].bookId === "john" &&
    journal.reflections[0].chapter === 3 &&
    journal.reflections[0].verse === 16 &&
    journal.reflections[0].notebookId === "general" &&
    journal.reflections[0].tags.includes("#Faith"),
  JSON.stringify(journal.reflections),
);
check(
  "the status says it's saved",
  /^Saved · just now/.test(await statusText()),
  await statusText(),
);

// ---------- reopen and edit ----------
await go(EDITOR, ready);
await sleep(600);
check(
  "reopening the verse loads the saved reflection",
  /live from that love/.test(
    await ev("document.querySelector('textarea[aria-label=Reflection]').value"),
  ) &&
    (await ev(
      "[...document.querySelectorAll('button[aria-pressed=true]')].some((x) => x.innerText.includes('#Faith'))",
    )),
);
await type("textarea[aria-label=Reflection]", "God gave his Son. Edited on the second visit.");
await sleep(1400);
check(
  "editing a saved note shows unsaved changes",
  /Unsaved changes/.test(await statusText()),
  await statusText(),
);
await save();
check(
  "…and saving updates it (still one reflection)",
  (await stored()).reflections.length === 1 &&
    /second visit/.test((await stored()).reflections[0].body),
);

// ---------- an older copy can't overwrite a newer one (another tab) ----------
await ev(
  `(() => { const j = JSON.parse(localStorage.getItem('${KEY}')); j.reflections[0].body = 'Changed in another tab'; j.reflections[0].updatedAt = new Date(Date.now() + 1000).toISOString(); localStorage.setItem('${KEY}', JSON.stringify(j)); })()`,
);
await type("textarea[aria-label=Reflection]", "My newer words in this tab.");
await save();
check(
  "a save that meets a newer copy keeps the text here and asks before replacing",
  /changed on another device/i.test(await text()) &&
    (await stored()).reflections[0].body === "Changed in another tab" &&
    (await ev("document.querySelector('textarea[aria-label=Reflection]').value")) ===
      "My newer words in this tab.",
);
await save();
check(
  "saving again replaces it, as asked",
  (await stored()).reflections[0].body === "My newer words in this tab.",
);

// ---------- notebooks ----------
check(
  "the notebook sheet opens with General Reflections",
  (await openNotebooks()) && /General Reflections/.test(await text()),
);
await clickButton("New notebook");
await type("#notebook-name-input", "Prayer Journal");
await clickButton("Create");
await sleep(500);
check(
  "creating a notebook selects it",
  (await ev(
    "document.querySelector('[role=dialog] input[name=notebook]:checked')?.closest('label')?.innerText.trim()",
  )) === "Prayer Journal",
);
await clickButton("New notebook");
await type("#notebook-name-input", "prayer journal");
await clickButton("Create");
await sleep(400);
check(
  "a duplicate name is refused with a message",
  /already have a notebook called/.test(await text()),
);
await clickButton("Cancel");
await clickButton("Rename");
await type("#notebook-name-input", "Prayers");
await clickButton("Save");
await sleep(400);
check(
  "renaming the notebook works",
  /Prayers/.test(await ev("document.querySelector('[role=dialog]').innerText")),
);
await shot("journal-notebook-sheet.png");
check(
  "no horizontal overflow with the notebook sheet open",
  (await ev("document.documentElement.scrollWidth - innerWidth")) <= 0,
);
await closeSheet();
await save();
journal = await stored();
const prayers = journal.notebooks.find((item) => item.name === "Prayers");
check(
  "the reflection is saved in the chosen notebook",
  prayers && journal.reflections[0].notebookId === prayers.id,
);

// ---------- browse in Saved ----------
await go("/saved?tab=notes", "!!document.querySelector('ul[aria-label=Reflections]')");
check(
  "the Notes tab is selected and shows its count",
  await ev(
    "document.querySelector('nav[aria-label=\"Saved sections\"] a[aria-current=page]')?.getAttribute('aria-label') === 'Notes, 1'",
  ),
);
check(
  "the search bar sits under the toggle with the Notes placeholder",
  await ev(
    "document.querySelector('#saved-search')?.placeholder === 'Search thoughts, tags, or scriptures...'",
  ),
);
const row = await ev(
  "document.querySelector('ul[aria-label=Reflections] > li')?.innerText.replace(/\\s+/g, ' ')",
);
check(
  "Saved lists the reflection with its notebook and translation",
  /John 3:16/.test(row) && /KJAV/.test(row) && /Prayers/.test(row) && /Open Note/.test(row),
  row,
);
await shot("journal-saved-reflections.png");
await ev("document.querySelector('ul[aria-label=Reflections] a').click()");
await waitFor("location.pathname === '/reflect/KJAV/john/3/16'", 8000);
check("tapping it opens the reflection", (await ev("location.pathname")) === EDITOR);

// ---------- translation isolation ----------
await go("/reflect/WEB/john/3/16", ready);
await sleep(500);
check(
  "the same verse in another translation has its own (empty) note",
  (await ev("document.querySelector('textarea[aria-label=Reflection]').value")) === "",
);

// ---------- delete a notebook: its note moves to General ----------
await go(EDITOR, ready);
await sleep(500);
await openNotebooks();
state.dialogs = [];
await clickButton("Delete");
await sleep(600);
journal = await stored();
check(
  "deleting a notebook asks first, and moves its reflection to General",
  /will move to General Reflections/.test(state.dialogs.join(" ")) &&
    !journal.notebooks.some((item) => item.name === "Prayers") &&
    journal.reflections[0].notebookId === "general",
  state.dialogs.join(" | "),
);
await closeSheet();
check(
  "…and the editor shows General Reflections",
  /General Reflections/.test(
    await ev("document.querySelector('section[aria-label=\"Notebook and privacy\"]').innerText"),
  ),
);

// ---------- failed save keeps the text ----------
await ev(
  `(() => { const real = Storage.prototype.setItem; window.__realSetItem = real; Storage.prototype.setItem = function (k, v) { if (k === '${KEY}') throw new Error('QuotaExceededError'); return real.call(this, k, v); }; })()`,
);
await type("textarea[aria-label=Reflection]", "Words that must not be lost.");
await save();
check(
  "if saving fails, the text stays and the status says so",
  /Couldn.t save/.test(await text()) &&
    (await ev("document.querySelector('textarea[aria-label=Reflection]').value")) ===
      "Words that must not be lost.",
  await statusText(),
);
await ev("Storage.prototype.setItem = window.__realSetItem; true");
await save();
check(
  "…and saving again works",
  (await stored()).reflections[0].body === "Words that must not be lost.",
);

// ---------- leaving with unsaved changes ----------
await type("textarea[aria-label=Reflection]", "Unsaved words.");
state.dialogs = [];
state.acceptDialogs = false;
await ev("document.querySelector('header button[aria-label]')?.click()");
await sleep(500);
check(
  "leaving with unsaved changes asks first (and staying keeps them)",
  /Leave without saving/.test(state.dialogs.join(" ")) &&
    (await ev("location.pathname")) === EDITOR,
);
state.acceptDialogs = true;

// ---------- delete the reflection ----------
await go(EDITOR, ready);
await sleep(500);
await openMenu();
state.dialogs = [];
await menuItem("Delete reflection");
await sleep(600);
check(
  "Delete reflection asks first, then removes it",
  /Delete this reflection/.test(state.dialogs.join(" ")) &&
    (await stored()).reflections.length === 0,
);
check(
  "the editor is empty again",
  (await ev("document.querySelector('textarea[aria-label=Reflection]').value")) === "",
);

// ---------- mobile layouts ----------
for (const [width, height] of [
  [360, 780],
  [430, 932],
]) {
  await viewport(width, height);
  await go(EDITOR, ready);
  check(
    `${width}px: the editor has no horizontal overflow`,
    (await ev("document.documentElement.scrollWidth - innerWidth")) <= 0,
  );
}

check("no console errors or exceptions", state.errors.length === 0, state.errors.join(" | "));
b.summary();
