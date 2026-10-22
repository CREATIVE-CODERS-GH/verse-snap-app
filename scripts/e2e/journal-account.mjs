// Signed-in Reflection Journal end to end in the browser, against a MOCK Supabase
// (mock-supabase.mjs): merging the device's journal with consent (an account note is never
// overwritten), loading and editing account notes, a change from another device, a failed save,
// notebooks (create, delete with the move to General), a new note, deleting a note, browsing in
// Saved, and the account signing out while a note is open. No real account or data is touched.
//
// Needs ACCOUNT_JOURNAL_ENABLED = true (src/lib/journal-schema.ts), i.e. after the journal
// migration is applied; with it off the script stops and says so.
//   npm run test:e2e:journal-account   (with the app running; see lib.mjs for settings)
import fs from "node:fs";
import { openBrowser } from "./lib.mjs";
import { fakeSession, mockSupabase, supabaseTarget } from "./mock-supabase.mjs";

if (!/ACCOUNT_JOURNAL_ENABLED = true/.test(fs.readFileSync("src/lib/journal-schema.ts", "utf8"))) {
  console.log(
    "SKIP  the account journal is switched off (src/lib/journal-schema.ts); nothing to test yet.",
  );
  process.exit(0);
}

const { origin, storageKey } = supabaseTarget();
const A = "00000000-0000-4000-8000-00000000000a";
const b = await openBrowser({ args: ["--disable-web-security"] });
const { ev, waitFor, go, viewport, tap, clickText, check, state, sleep } = b;
const server = await mockSupabase(b, { origin, user: A });

const KEY = "versesnap.journal.v1";
const R16 = "11111111-1111-4111-8111-111111111111";
const R17 = "22222222-2222-4222-8222-222222222222";
const NB_SERMON = "33333333-3333-4333-8333-333333333333";
const STAMP = "2026-01-01T00:00:00.123456+00:00";
const ready =
  "!!document.querySelector('textarea[aria-label=Reflection]') && /God so loved|world/.test(document.body.innerText)";
const area = () => ev("document.querySelector('textarea[aria-label=Reflection]').value");
const text = () => ev("document.body.innerText");
const accountNote = (verse) =>
  server.tables.reflections.find((row) => row.verse === verse && row.translation === "KJAV");
const writes = (table, method) =>
  server.writes.filter((w) => w.table === table && (!method || w.method === method));
const type = async (selector, value) => {
  await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(150);
};
const save = async () => {
  await ev(
    "[...document.querySelectorAll('button')].find((x) => /Save Note/.test(x.innerText))?.click()",
  );
  await sleep(900);
};
const button = (label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`,
  );
const menuItem = (label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll('[role=menuitem], [role=menuitemradio]')].find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`,
  );
const guestReflection = (id, verse, notebookId) => ({
  id,
  notebookId,
  translation: "KJAV",
  bookId: "john",
  chapter: 3,
  verse,
  title: "",
  body: `Device note on John 3:${verse}`,
  tags: [],
  posture: null,
  isPrivate: true,
  createdAt: "2026-02-01T10:00:00.000Z",
  updatedAt: "2026-02-01T10:00:00.000Z",
});

await viewport(390, 844);
await go("/settings", "document.body.innerText.includes('Settings')");
await ev("localStorage.clear(); sessionStorage.clear(); true");

// The account already has General and a note on John 3:16; the device has two notes and a notebook.
server.tables.notebooks.push({
  id: "acct-general",
  user_id: A,
  name: "General Reflections",
  is_default: true,
  created_at: STAMP,
  updated_at: STAMP,
});
server.tables.reflections.push({
  id: "acct-r16",
  user_id: A,
  notebook_id: "acct-general",
  translation: "KJAV",
  book_id: "john",
  chapter: 3,
  verse: 16,
  title: "",
  body: "Account note on John 3:16",
  tags: [],
  posture: null,
  is_private: true,
  created_at: STAMP,
  updated_at: STAMP,
});
const guestJournal = {
  notebooks: [
    {
      id: "general",
      name: "General Reflections",
      isDefault: true,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    { id: NB_SERMON, name: "Sermon Notes", isDefault: false, createdAt: STAMP, updatedAt: STAMP },
  ],
  reflections: [guestReflection(R16, 16, NB_SERMON), guestReflection(R17, 17, "general")],
};
await ev(
  `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(guestJournal))}); true`,
);

// ---------- merge with consent ----------
await ev(
  `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(fakeSession(A)))}); true`,
);
await go("/saved");
await waitFor("!!document.querySelector('[role=alertdialog]')", 10000);
const prompt = await ev(
  "document.querySelector('[role=alertdialog]').innerText.replace(/\\s+/g, ' ')",
);
check("sign-in asks before adding the device's reflections", /2 reflections/.test(prompt), prompt);
check("nothing is sent before the person chooses", writes("reflections").length === 0);
await clickText(/^Add to my account$/, "[role=alertdialog]");
await waitFor("!document.querySelector('[role=alertdialog]')", 10000);
await sleep(300);
check(
  "the toast explains the note that stayed on the device",
  /1 reflection stayed on this device/.test(await text()),
);
check(
  "the account's own note on John 3:16 is untouched",
  accountNote(16)?.id === "acct-r16" && accountNote(16)?.body === "Account note on John 3:16",
);
check(
  "the new note was added to this account's General notebook, with its original dates",
  accountNote(17)?.id === R17 &&
    accountNote(17)?.user_id === A &&
    accountNote(17)?.notebook_id === "acct-general" &&
    accountNote(17)?.created_at === "2026-02-01T10:00:00.000Z",
);
check(
  "merge writes are insert-or-ignore on the one-per-verse key",
  writes("reflections", "POST").every(
    (w) =>
      w.prefer.includes("resolution=ignore-duplicates") &&
      w.onConflict === "user_id,translation,book_id,chapter,verse",
  ),
);
let device = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
check(
  "only the added note left the device; the conflicting one stays",
  device.reflections.map((r) => r.id).join() === R16,
);
await go("/saved");
await sleep(1500);
check(
  "the kept note isn't offered to this account again",
  !(await ev("!!document.querySelector('[role=alertdialog]')")),
);

// ---------- the account note in the editor ----------
await go("/reflect/KJAV/john/3/16", ready);
await waitFor("document.querySelector('textarea[aria-label=Reflection]').value.length > 0", 8000);
check(
  "the editor opens the account's note (not the device copy)",
  (await area()) === "Account note on John 3:16",
);
check(
  "the notebook card says it's synced with the account",
  /Synced with your account/.test(await text()),
);
await type("textarea[aria-label=Reflection]", "Edited on this device.");
await save();
const patch = writes("reflections", "PATCH").at(-1);
check(
  "saving an edit updates only that version of the note (id and stored time)",
  patch &&
    /id=eq\.acct-r16/.test(patch.query) &&
    /updated_at=eq\./.test(patch.query) &&
    accountNote(16).body === "Edited on this device.",
  patch?.query,
);
check(
  "account notes are never stored on the device",
  !(await ev(`localStorage.getItem(${JSON.stringify(KEY)})`)).includes("Edited on this device"),
);
await go("/reflect/KJAV/john/3/16", ready);
await waitFor("document.querySelector('textarea[aria-label=Reflection]').value.length > 0", 8000);
check(
  "after a reload the edit comes from the account",
  (await area()) === "Edited on this device.",
);

// ---------- a change from another device ----------
Object.assign(accountNote(16), {
  body: "From another device",
  updated_at: "2026-05-05T00:00:00.999999+00:00",
});
await type("textarea[aria-label=Reflection]", "My words here.");
await save();
check(
  "a save that meets a newer copy changes nothing and keeps the text here",
  /changed on another device/i.test(await text()) &&
    accountNote(16).body === "From another device" &&
    (await area()) === "My words here.",
);
await save();
check("saving again replaces it, as asked", accountNote(16).body === "My words here.");

// ---------- a failed save ----------
server.failNextWrite.reflections = 1;
await type("textarea[aria-label=Reflection]", "Words that must survive an outage.");
await save();
check(
  "a failed save keeps the text and says so",
  /Couldn.t save/.test(await text()) && (await area()) === "Words that must survive an outage.",
);
await save();
check("…and saving again works", accountNote(16).body === "Words that must survive an outage.");

// ---------- notebooks ----------
await ev(
  "document.querySelector('button[aria-labelledby=\"notebook-label notebook-name\"]').click()",
);
await waitFor("!!document.querySelector('[role=dialog] input[name=notebook]')", 5000);
await button("New notebook");
await type("#notebook-name-input", "Prayer");
await button("Create");
await sleep(700);
const prayer = server.tables.notebooks.find((row) => row.name === "Prayer");
check("a new notebook is created in the account", prayer?.user_id === A && !prayer.is_default);
await ev("document.querySelector('[role=dialog] button[aria-label=Close]')?.click()");
await sleep(300);
await save();
check("the note moves into it", accountNote(16).notebook_id === prayer.id);
await ev(
  "document.querySelector('button[aria-labelledby=\"notebook-label notebook-name\"]').click()",
);
await waitFor("!!document.querySelector('[role=dialog] input[name=notebook]')", 5000);
state.dialogs = [];
await button("Delete");
await sleep(900);
check(
  "deleting the notebook asks first, and the account moves its note to General",
  /move to General Reflections/.test(state.dialogs.join(" ")) &&
    !server.tables.notebooks.some((row) => row.name === "Prayer") &&
    accountNote(16).notebook_id === "acct-general",
  state.dialogs.join(" | "),
);
await ev("document.querySelector('[role=dialog] button[aria-label=Close]')?.click()");
await sleep(300);
await type("textarea[aria-label=Reflection]", "Saved after the notebook was deleted.");
await save();
check(
  "editing after that saves normally (no false conflict)",
  accountNote(16).body === "Saved after the notebook was deleted.",
);

// ---------- a new note, then delete it ----------
await go("/reflect/KJAV/john/3/18", ready);
await sleep(600);
await type("textarea[aria-label=Reflection]", "A brand new note.");
await save();
check(
  "a new note is created for this account",
  accountNote(18)?.user_id === A && accountNote(18)?.body === "A brand new note.",
);
await tap("button[aria-label='More options']");
await waitFor("!!document.querySelector('[role=menu]')", 5000);
await menuItem("Delete reflection");
await sleep(800);
const del = writes("reflections", "DELETE").at(-1);
check(
  "Delete reflection removes it from the account (this user's row only)",
  !accountNote(18) && /user_id=eq\./.test(del?.query ?? ""),
  del?.query,
);

// ---------- browse in Saved ----------
await go("/saved", "document.body.innerText.includes('Saved')");
await tap("button[aria-label='Sort and organize']");
await waitFor("!!document.querySelector('[role=menu]')", 5000);
await menuItem("Reflections");
await waitFor("!!document.querySelector('ul[aria-label=Reflections]')", 8000);
const rows = await ev(
  "[...document.querySelectorAll('ul[aria-label=Reflections] a')].map((a) => a.innerText.replace(/\\s+/g, ' '))",
);
check(
  "Saved lists the account's reflections",
  rows.length === 2 &&
    rows.some((r) => /John 3:16/.test(r)) &&
    rows.some((r) => /John 3:17/.test(r)),
  JSON.stringify(rows),
);

// ---------- the account signs out (in another tab) while a note is open ----------
await go("/reflect/KJAV/john/3/16", ready);
await waitFor("document.querySelector('textarea[aria-label=Reflection]').value.length > 0", 8000);
await type("textarea[aria-label=Reflection]", "Private unsaved words.");
await ev(`(() => {
  localStorage.removeItem(${JSON.stringify(storageKey)});
  new BroadcastChannel(${JSON.stringify(storageKey)}).postMessage({ event: 'SIGNED_OUT', session: null });
})()`);
await sleep(1500);
check(
  "when the account signs out, its open note is closed (text not left on screen or saved as a guest)",
  (await area()) !== "Private unsaved words." &&
    !(await ev(`localStorage.getItem(${JSON.stringify(KEY)}) ?? ''`)).includes(
      "Private unsaved words",
    ),
  await area(),
);
await go("/reflect/KJAV/john/3/16", ready);
await sleep(800);
check(
  "signed out, the editor shows the device's own copy, not the account note",
  (await area()) === "Device note on John 3:16",
);

check(
  "no request reached the real Supabase project",
  server.blocked.length === 0,
  server.blocked.join(", "),
);
check("no console errors or exceptions", state.errors.length === 0, state.errors.join(" | "));
b.summary();
