// Batch 1D at 320px as a guest: choosing several verses to highlight (long press, taps, Ctrl-click,
// colours, Clear, Done, Escape, scrolling is not a press), and the saved-reflection icon with its
// dialog (translation-specific, 44px tap area, no raw markers, reading position and focus kept,
// Edit Reflection, icon gone after the reflection is deleted). Never signs in.
//   npm run test:e2e:reader-batch1d      (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, send, check, summary, sleep, state } = b;

const CHAPTER = "/chapter/KJAV/john/3";
const ready = "document.querySelectorAll('[data-verse-block]').length > 20";
const HL_KEY = "versesnap.highlights.v1";
const J_KEY = "versesnap.journal.v1";

await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await viewport(320, 700);

const center = (selector) =>
  ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + Math.min(r.width / 2, 120), y: r.y + Math.min(r.height / 2, 14) };
  })()`);
const touch = async (selector, { hold = 0, move = 0, offset = { x: 0, y: 0 } } = {}) => {
  const p = await center(selector);
  if (!p) return false;
  const point = { x: p.x + offset.x, y: p.y + offset.y };
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  if (move) {
    await send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y + move }],
    });
  }
  if (hold) await sleep(hold);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(350);
  return true;
};
const verse = (n) => `[data-verse-block="${n}"]`;
const longPress = (n) => touch(verse(n), { hold: 650 });
const tapVerse = (n) => touch(verse(n));
const barText = () =>
  ev("document.querySelector('section[aria-label=\"Selected verses\"]')?.innerText ?? ''");
const chosen = () =>
  ev(
    "[...document.querySelectorAll('[data-multi-chosen]')].map((x) => Number(x.dataset.verseBlock))",
  );
const stored = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(HL_KEY)}) ?? '[]')`);
const clickLabel = (label) =>
  ev(
    `(() => { const el = document.querySelector('[aria-label="${label}"]'); if (!el) return false; el.click(); return true; })()`,
  );
const sideways = () => ev("document.documentElement.scrollWidth > innerWidth");

// ================= 1. choosing several verses =================
await go("/", "document.body.innerText.length > 40");
await ev(
  `localStorage.removeItem(${JSON.stringify(HL_KEY)}); localStorage.removeItem(${JSON.stringify(J_KEY)})`,
);
await go(CHAPTER, ready);

await touch(verse(10), { hold: 650, move: 40 });
check("a finger that moves (scrolling) does not start choosing", (await barText()) === "");

await longPress(3);
check(
  "a long press starts choosing with that verse",
  /1 verse selected/.test(await barText()),
  await barText(),
);
await tapVerse(9);
await tapVerse(5);
check(
  "taps add verses that are not next to each other",
  JSON.stringify(await chosen()) === "[3,5,9]" && /3 verses selected/.test(await barText()),
  JSON.stringify(await chosen()),
);
await tapVerse(4);
check("a neighbouring verse joins the choice", JSON.stringify(await chosen()) === "[3,4,5,9]");
await tapVerse(4);
check("tapping a chosen verse removes it", JSON.stringify(await chosen()) === "[3,5,9]");
check(
  "the bar shows the colours, Clear and Done",
  await ev(`(() => {
  const bar = document.querySelector('section[aria-label="Selected verses"]');
  return !!bar && !!bar.querySelector('[aria-label="Clear highlight"]') && bar.querySelectorAll('[role=radio]').length === 6 && /Done/.test(bar.innerText);
})()`),
);
check("no sideways scrolling at 320px while choosing", !(await sideways()));

const firstColour = await ev(
  'document.querySelector(\'section[aria-label="Selected verses"] [role=radio][aria-label$="highlight"]:not([aria-label^="Clear"])\').getAttribute(\'aria-label\')',
);
await clickLabel(firstColour);
await sleep(600);
const saved = await stored();
check(
  "the colour is saved for every chosen verse",
  JSON.stringify(saved.map((x) => x.verse).sort((a, c) => a - c)) === "[3,5,9]" &&
    new Set(saved.map((x) => x.color)).size === 1,
  JSON.stringify(saved),
);
check(
  "the chosen verses show the colour",
  await ev(
    `[3,5,9].every((n) => /bg-hl-/.test(document.querySelector('[data-verse-block="' + n + '"]').className))`,
  ),
);

const secondColour = await ev(
  "[...document.querySelectorAll('section[aria-label=\"Selected verses\"] [role=radio]')].map((x) => x.getAttribute('aria-label')).filter((x) => x !== 'Clear highlight' && x !== " +
    JSON.stringify(firstColour) +
    ")[0]",
);
await clickLabel(secondColour);
await sleep(600);
check(
  "a colour can be changed for all of them",
  new Set((await stored()).map((x) => x.color)).size === 1 && (await stored()).length === 3,
);

await clickLabel("Clear highlight");
await sleep(600);
check(
  "Clear removes the highlights from all chosen verses",
  (await stored()).length === 0,
  JSON.stringify(await stored()),
);

await clickLabel(firstColour);
await sleep(500);
await ev(
  "[...document.querySelectorAll('section[aria-label=\"Selected verses\"] button')].find((x) => x.innerText.trim() === 'Done').click()",
);
await sleep(400);
check(
  "Done leaves choosing: no bar, nothing chosen, the chapter navigation is back",
  (await barText()) === "" &&
    (await chosen()).length === 0 &&
    (await ev("!!document.querySelector('nav[aria-label=\"Chapter navigation\"]')")),
);
await go(CHAPTER, ready);
check(
  "the highlights are still there after reloading",
  await ev(
    `[3,5,9].every((n) => /bg-hl-/.test(document.querySelector('[data-verse-block="' + n + '"]').className))`,
  ),
);

await longPress(6);
await send("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "Escape",
  code: "Escape",
  windowsVirtualKeyCode: 27,
});
await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "Escape",
  code: "Escape",
  windowsVirtualKeyCode: 27,
});
await sleep(300);
check("Escape leaves choosing", (await barText()) === "" && (await chosen()).length === 0);

// A Ctrl-click (desktop) starts choosing too.
const p = await center(verse(12));
for (const type of ["mousePressed", "mouseReleased"])
  await send("Input.dispatchMouseEvent", {
    type,
    ...p,
    button: "left",
    clickCount: 1,
    modifiers: 2,
  });
await sleep(350);
check(
  "Ctrl-click starts choosing",
  /1 verse selected/.test(await barText()) && JSON.stringify(await chosen()) === "[12]",
);
await send("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "Escape",
  code: "Escape",
  windowsVirtualKeyCode: 27,
});
await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "Escape",
  code: "Escape",
  windowsVirtualKeyCode: 27,
});
await sleep(300);

// The single-verse behaviour is unchanged: tap marks, second tap opens the options.
await tapVerse(7);
await tapVerse(7);
check(
  "single verse: a second tap still opens the options with the highlight picker",
  await ev("!!document.querySelector('section[aria-label=\"Highlight tone\"]')"),
);
await send("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "Escape",
  code: "Escape",
  windowsVirtualKeyCode: 27,
});
await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "Escape",
  code: "Escape",
  windowsVirtualKeyCode: 27,
});
await sleep(400);

// ================= 2. reflection note indicators =================
const at = "2026-10-22T09:00:00.000Z";
const seed = {
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
      body: "A **bold** and _soft_ thought",
      tags: ["grace"],
      posture: null,
      isPrivate: true,
      createdAt: at,
      updatedAt: at,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      translation: "WEB",
      bookId: "john",
      chapter: 3,
      verse: 2,
      notebookId: "general",
      title: "Other edition",
      body: "Not for KJAV",
      tags: [],
      posture: null,
      isPrivate: true,
      createdAt: at,
      updatedAt: at,
    },
  ],
};
await go("/", "document.body.innerText.length > 40");
await ev(`localStorage.setItem(${JSON.stringify(J_KEY)}, ${JSON.stringify(JSON.stringify(seed))})`);
await go(CHAPTER, ready);
const icons = await ev(
  "[...document.querySelectorAll('[data-note-icon]')].map((x) => Number(x.dataset.noteIcon))",
);
check(
  "an icon shows only for the verse with a saved reflection in this translation",
  JSON.stringify(icons) === "[16]",
  JSON.stringify(icons),
);

const tapArea = await ev(`(() => {
  const el = document.querySelector('[data-note-icon="16"]');
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  return [[-21, -21], [21, -21], [-21, 21], [21, 21], [0, 0]].every(([dx, dy]) => {
    const hit = document.elementFromPoint(cx + dx, cy + dy);
    return hit === el || el.contains(hit);
  });
})()`);
check("the icon's tap area is at least 44px", tapArea);

const before = await ev("window.scrollY");
await touch('[data-note-icon="16"]');
const scrollBefore = await ev("window.scrollY");
await waitFor("!!document.querySelector('[role=dialog]')", 4000);
const dialog = await ev("document.querySelector('[role=dialog]')?.innerText ?? ''");
check(
  "the dialog shows the reference, title, text without markers, notebook and tag",
  /John 3:16 \(KJAV\)/.test(dialog) &&
    /Seed title/.test(dialog) &&
    /A bold and soft thought/.test(dialog) &&
    !/\*\*|_soft_/.test(dialog) &&
    /General Reflections/.test(dialog) &&
    /grace/.test(dialog),
  dialog,
);
check("it has Close and Edit Reflection", /Close/.test(dialog) && /Edit Reflection/.test(dialog));
await ev(
  "[...document.querySelectorAll('[role=dialog] button')].find((x) => x.innerText.trim() === 'Close').click()",
);
await sleep(500);
const after = await ev("window.scrollY");
check(
  "closing keeps the reading position",
  Math.abs(after - scrollBefore) <= 1 && before !== undefined,
  `${scrollBefore} -> ${after}`,
);
check(
  "closing returns focus to the icon",
  await ev("document.activeElement?.getAttribute('data-note-icon') === '16'"),
);
check(
  "the dialog is gone and we are still on the chapter",
  !(await ev("!!document.querySelector('[role=dialog]')")) &&
    (await ev("location.pathname")) === CHAPTER,
);

await touch('[data-note-icon="16"]');
await waitFor("!!document.querySelector('[role=dialog]')", 4000);
await ev(
  "[...document.querySelectorAll('[role=dialog] button')].find((x) => x.innerText.trim() === 'Edit Reflection').click()",
);
await waitFor("location.pathname.startsWith('/reflect/')", 6000);
check(
  "Edit Reflection opens the editor for that verse",
  (await ev("location.pathname")) === "/reflect/KJAV/john/3/16",
);

// Delete it in the editor, come back without reloading: the icon is gone.
await waitFor("!!document.querySelector('textarea[aria-label=Reflection]')", 8000);
await ev(
  "document.querySelector(\"button[aria-label='More options']\").dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))",
);
await waitFor("!!document.querySelector('[role=menu]')", 5000);
state.acceptDialogs = true;
await ev(
  "[...document.querySelectorAll('[role=menuitem]')].find((x) => x.innerText.trim() === 'Delete reflection')?.click()",
);
await sleep(1200);
const gone = await ev(
  `!JSON.parse(localStorage.getItem(${JSON.stringify(J_KEY)})).reflections.some((x) => x.id === "11111111-1111-4111-8111-111111111111")`,
);
check("the reflection was deleted", gone);
await ev("history.back()");
await waitFor("location.pathname === '/chapter/KJAV/john/3'", 8000);
await waitFor(ready, 8000);
await sleep(500);
check(
  "the icon is gone after the reflection is deleted",
  (await ev("document.querySelectorAll('[data-note-icon]').length")) === 0,
);
check("no sideways scrolling at 320px", !(await sideways()));
check("no page errors", state.errors.length === 0, JSON.stringify(state.errors).slice(0, 300));

summary();
