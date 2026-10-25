// Signed-in verse highlights end to end in the browser, against a MOCK Supabase (mock-supabase.mjs):
// merging the device's highlights with consent, reading account highlights per chapter and
// translation, changing and removing them, a change from another device, a failed save, and
// sign-out. No real account or data is touched.
//
// Needs ACCOUNT_HIGHLIGHTS_ENABLED = true (src/lib/highlights-schema.ts), i.e. after the highlights
// migration is applied; with it off the script stops and says so.
//   npm run test:e2e:highlights-account   (with the app running; see lib.mjs for settings)
import fs from "node:fs";
import { openBrowser } from "./lib.mjs";
import { fakeSession, mockSupabase, supabaseTarget } from "./mock-supabase.mjs";

if (
  !/ACCOUNT_HIGHLIGHTS_ENABLED = true/.test(fs.readFileSync("src/lib/highlights-schema.ts", "utf8"))
) {
  console.log(
    "SKIP  account highlights are switched off (src/lib/highlights-schema.ts); nothing to test yet.",
  );
  process.exit(0);
}

const { origin, storageKey } = supabaseTarget();
const USER_A = "00000000-0000-4000-8000-00000000000a";
const b = await openBrowser({ args: ["--disable-web-security"] });
const { ev, waitFor, go, viewport, clickText, check, state, sleep } = b;
const server = await mockSupabase(b, { origin, user: USER_A });

const KEY = "versesnap.highlights.v1";
const CHAPTER = "/chapter/KJAV/john/3";
const loaded = "document.querySelectorAll('[data-verse-block]').length > 10";
// The verse's tint, also while it is selected (then it sits on an inner element).
const tintOf = (verse) =>
  ev(
    `(document.querySelector('[data-verse-block="${verse}"]')?.outerHTML.match(/bg-hl-([a-z]+)\\/70/) ?? [])[1] ?? null`,
  );
const deviceHighlights = () =>
  ev(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? '[]')`);
const promptOpen = "!!document.querySelector('[role=alertdialog]')";
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
  await sleep(800);
};
const account = (verse, color, translation = "KJAV") => ({
  id: `acct-${translation}-${verse}`,
  user_id: USER_A,
  translation,
  book_id: "john",
  chapter: 3,
  verse,
  color,
  created_at: "2025-12-01T00:00:00.000Z",
  updated_at: "2025-12-01T00:00:00.000Z",
});
const guest = (verse, color) => ({
  id: `KJAV/john/3/${verse}`,
  translation: "KJAV",
  bookId: "john",
  chapter: 3,
  verse,
  color,
  at: "2026-02-01T10:00:00.000Z",
});
const highlightWrites = () => server.writes.filter((w) => w.table === "highlights");

await viewport(390, 844);
await go("/settings", "document.body.innerText.includes('Settings')");
await ev("localStorage.clear(); sessionStorage.clear(); true");

// The account already has two highlights; the device (as a guest) has two, one on the same verse.
server.tables.highlights.push(account(16, "rose"), account(17, "lilac"));
await ev(
  `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify([guest(16, "sage"), guest(18, "amber")]))}); true`,
);

// ---------- merge with consent ----------
await ev(
  `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(fakeSession(USER_A)))}); true`,
);
await go("/saved");
await waitFor(promptOpen, 10000);
const prompt = await ev(
  "document.querySelector('[role=alertdialog]').innerText.replace(/\\s+/g, ' ')",
);
check("sign-in asks before adding the device's highlights", /2 highlights/.test(prompt), prompt);
check("nothing is sent before the person chooses", highlightWrites().length === 0);
await clickText(/^Add to my account$/, "[role=alertdialog]");
await waitFor(`!${promptOpen}`, 10000);
const merged = server.tables.highlights.map((row) => `${row.verse}:${row.color}`).sort();
check(
  "merge keeps the account's colour on the shared verse and adds the new one (no duplicates)",
  JSON.stringify(merged) === JSON.stringify(["16:rose", "17:lilac", "18:amber"]),
  JSON.stringify(merged),
);
check(
  "merge writes are insert-or-ignore for this user on the one-per-verse key",
  highlightWrites().every(
    (w) =>
      w.prefer.includes("resolution=ignore-duplicates") &&
      w.onConflict === "user_id,translation,book_id,chapter,verse" &&
      w.rows.every((row) => row.user_id === USER_A),
  ),
);
check("merged highlights leave the device", (await deviceHighlights()).length === 0);

// ---------- reading, changing, removing ----------
await go(CHAPTER, loaded);
await sleep(800);
check(
  "the chapter shows the account's highlights",
  (await tintOf(16)) === "rose" && (await tintOf(17)) === "lilac" && (await tintOf(18)) === "amber",
);
let mark = highlightWrites().length;
await openSheet(16);
await pick("Sky highlight");
let fresh = highlightWrites().slice(mark);
check(
  "changing a colour is one upsert to the account",
  fresh.length === 1 &&
    fresh[0].prefer.includes("resolution=merge-duplicates") &&
    fresh[0].rows[0].color === "sky" &&
    fresh[0].rows[0].user_id === USER_A,
  JSON.stringify(fresh),
);
check("account highlights are never stored on the device", (await deviceHighlights()).length === 0);
await go(CHAPTER, loaded);
await sleep(800);
check("after a reload the new colour comes from the account", (await tintOf(16)) === "sky");

mark = highlightWrites().length;
await openSheet(17);
await pick("Clear highlight");
fresh = highlightWrites().slice(mark);
check(
  "Clear deletes that verse's highlight from the account",
  fresh.length === 1 &&
    fresh[0].method === "DELETE" &&
    /verse=eq\.17/.test(fresh[0].query) &&
    /translation=eq\.KJAV/.test(fresh[0].query),
  JSON.stringify(fresh.map((w) => [w.method, w.query])),
);
await go(CHAPTER, loaded);
await sleep(800);
check("after a reload the cleared verse has no highlight", (await tintOf(17)) === null);

// ---------- translation isolation ----------
server.tables.highlights.push(account(16, "amber", "WEB"));
await go("/chapter/WEB/john/3", loaded);
await sleep(800);
check(
  "another translation shows only its own highlights",
  (await tintOf(16)) === "amber" && (await tintOf(18)) === null,
);

// ---------- a change made on another device ----------
server.tables.highlights.find((row) => row.translation === "KJAV" && row.verse === 18).color =
  "sage";
await go(CHAPTER, loaded);
await sleep(800);
check(
  "a highlight changed on another device appears when the chapter is opened",
  (await tintOf(18)) === "sage",
);

// ---------- failed save ----------
server.failNextWrite.highlights = 1;
await openSheet(16);
await pick("Rose highlight");
await sleep(600);
const toasts = await ev("document.body.innerText");
check(
  "a failed save says so and puts the previous colour back",
  /Couldn.t save the highlight/.test(toasts) && (await tintOf(16)) === "sky",
  String(await tintOf(16)),
);

// ---------- sign out ----------
await go("/settings", "document.body.innerText.includes('Settings')");
await clickText(/@example\.test/, "main");
await waitFor(
  "[...document.querySelectorAll('button')].some((x) => x.innerText.trim() === 'Sign out')",
  5000,
);
await clickText(/^Sign out$/);
await sleep(400);
if (
  await ev(
    "[...document.querySelectorAll('[role=alertdialog] button, [role=dialog] button')].some((x) => x.innerText.trim() === 'Sign out')",
  )
)
  await clickText(/^Sign out$/, "[role=alertdialog], [role=dialog]");
await waitFor(`!localStorage.getItem(${JSON.stringify(storageKey)})`, 8000);
await go(CHAPTER, loaded);
await sleep(800);
check(
  "after sign-out the account's highlights aren't shown and none are on the device",
  (await tintOf(16)) === null &&
    (await tintOf(18)) === null &&
    (await deviceHighlights()).length === 0,
);

check(
  "no request reached the real Supabase project",
  server.blocked.length === 0,
  server.blocked.join(", "),
);
check("no console errors or exceptions", state.errors.length === 0, state.errors.join(" | "));
b.summary();
