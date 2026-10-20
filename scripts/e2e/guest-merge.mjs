// Guest-to-account merge, end to end in the browser, against a MOCK Supabase.
//
// Every request to the project's Supabase URL is answered by this script (DevTools Fetch
// interception) and anything unexpected is blocked, so no real account or data is touched. The
// signed-in session is a fake one placed in localStorage; no password or key is used or printed.
//   npm run test:e2e:merge        (with the app running; see lib.mjs for settings)
import { openBrowser, readPublicEnv } from "./lib.mjs";

const supabaseUrl = readPublicEnv("VITE_SUPABASE_URL");
if (!supabaseUrl) {
  console.error("VITE_SUPABASE_URL isn't set, so the app runs without accounts; nothing to test.");
  process.exit(2);
}
const origin = new URL(supabaseUrl).origin;
const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

// CORS is switched off for this throwaway profile so preflight requests never leave the browser.
const b = await openBrowser({ args: ["--disable-web-security"] });
const { send, on, ev, waitFor, go, viewport, clickText, toasts, check, state, sleep } = b;

// ---------- the mock server ----------
const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const server = {
  authUser: USER_A, // who /auth/v1/user says is signed in
  failSavedWrites: 0, // how many upcoming saved_verses writes fail with a 500
  tables: { saved_verses: [], history: [] },
  writes: [], // every write request: { table, method, prefer, rows }
  blocked: [],
};

const SAVED_KEY = ["user_id", "translation", "book_id", "chapter", "verse"];
const sameKey = (a, b2) => SAVED_KEY.every((key) => a[key] === b2[key]);

function filterRows(rows, params) {
  return rows.filter((row) => {
    for (const [column, raw] of params) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(column))
        continue;
      const [op, ...rest] = raw.split(".");
      const value = rest.join(".");
      const cell = String(row[column]);
      if (op === "eq" && cell !== value) return false;
      if (
        op === "in" &&
        !value
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.replace(/"/g, ""))
          .includes(cell)
      )
        return false;
    }
    return true;
  });
}

function rest(method, table, url, headers, body) {
  const rows = server.tables[table];
  if (!rows) return { status: 404, json: { message: `no table ${table}` } };
  const params = [...url.searchParams.entries()];
  if (method === "GET") return { status: 200, json: filterRows(rows, params) };

  const prefer = headers.Prefer ?? headers.prefer ?? "";
  const incoming = body ? [].concat(JSON.parse(body)) : [];
  server.writes.push({
    table,
    method,
    prefer,
    onConflict: url.searchParams.get("on_conflict"),
    rows: incoming,
  });
  if (table === "saved_verses" && method === "POST" && server.failSavedWrites > 0) {
    server.failSavedWrites -= 1;
    return { status: 500, json: { message: "simulated outage", code: "XX000" } };
  }
  if (method === "POST") {
    for (const row of incoming) {
      // Both tables have a unique key on these columns (history's treats a null verse as equal).
      const verse = row.verse ?? null;
      if (table === "history") {
        const kind = row.kind ?? "verse";
        if ((kind === "verse") === (verse === null))
          return {
            status: 400,
            json: { message: "violates history_kind_verse_check", code: "23514" },
          };
      }
      const existing = rows.find((item) => sameKey(item, { ...row, verse }));
      if (existing) {
        if (prefer.includes("ignore-duplicates")) continue;
        if (prefer.includes("merge-duplicates")) {
          Object.assign(existing, row);
          continue;
        }
        return { status: 409, json: { message: "duplicate key", code: "23505" } };
      }
      rows.push({
        id: `row-${rows.length + 1}-${Math.random().toString(36).slice(2)}`,
        kind: table === "history" ? "verse" : undefined,
        ...row,
        verse,
      });
    }
    return { status: 201 };
  }
  if (method === "DELETE") {
    const doomed = new Set(filterRows(rows, params));
    server.tables[table] = rows.filter((row) => !doomed.has(row));
    return { status: 204 };
  }
  return { status: 200, json: [] };
}

function respond(url, method, headers, body) {
  const path = url.pathname;
  if (path === "/auth/v1/user") {
    return server.authUser
      ? { status: 200, json: fakeUser(server.authUser) }
      : { status: 401, json: { message: "invalid JWT" } };
  }
  if (path === "/auth/v1/logout") return { status: 204 };
  if (path === "/auth/v1/token") return { status: 200, json: fakeSession(USER_A) };
  const match = path.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (match) return rest(method, match[1], url, headers, body);
  return null;
}

await send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/*`, requestStage: "Request" }] });
on("Fetch.requestPaused", async ({ requestId, request }) => {
  const url = new URL(request.url);
  const result =
    request.method === "OPTIONS"
      ? { status: 204 }
      : respond(url, request.method, request.headers, request.postData);
  if (!result) {
    server.blocked.push(`${request.method} ${url.pathname}`);
    await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    return;
  }
  const text = result.json === undefined ? "" : JSON.stringify(result.json);
  await send("Fetch.fulfillRequest", {
    requestId,
    responseCode: result.status,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "*" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
    ],
    body: Buffer.from(text).toString("base64"),
  }).catch(() => {});
});

// ---------- fake session and guest data ----------
function fakeUser(id) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${id.slice(-1)}@example.test`,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}
function fakeSession(id) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, aud: "authenticated", role: "authenticated", exp })}.e2e`;
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: "e2e-refresh",
    user: fakeUser(id),
  };
}

const entry = (book, bookName, chapter, verse, at) => ({
  id: `KJAV/${book}/${chapter}/${verse}`,
  translation: "KJAV",
  bookId: book,
  bookName,
  chapter,
  verse,
  verseText: `${bookName} ${chapter}:${verse} text`,
  at,
});
const GUEST_SAVED = [
  entry("john", "John", 3, 16, "2026-02-01T10:00:00.000Z"),
  entry("romans", "Romans", 8, 28, "2026-02-02T10:00:00.000Z"),
  entry("psalms", "Psalms", 23, 1, "2026-02-03T10:00:00.000Z"),
];
const GUEST_HISTORY = [
  { ...entry("romans", "Romans", 12, 2, "2026-02-04T10:00:00.000Z"), kind: "verse" },
  { ...entry("john", "John", 1, 1, "2026-02-05T10:00:00.000Z"), kind: "verse" },
  {
    id: "chapter:KJAV/romans/12",
    kind: "chapter",
    translation: "KJAV",
    bookId: "romans",
    bookName: "Romans",
    chapter: 12,
    verse: null,
    verseText: "",
    at: "2026-02-06T10:00:00.000Z",
  },
];

const seedGuest = () =>
  ev(`localStorage.setItem('versesnap.library.saved.v1', ${JSON.stringify(JSON.stringify(GUEST_SAVED))});
      localStorage.setItem('versesnap.library.history.v1', ${JSON.stringify(JSON.stringify(GUEST_HISTORY))}); true`);
const signIn = (id) =>
  ev(
    `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(fakeSession(id)))}); true`,
  );
const guest = () =>
  ev(`({ saved: JSON.parse(localStorage.getItem('versesnap.library.saved.v1') ?? '[]'),
         history: JSON.parse(localStorage.getItem('versesnap.library.history.v1') ?? '[]') })`);
const dialogText = () =>
  ev("document.querySelector('[role=alertdialog]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''");
const promptOpen = "!!document.querySelector('[role=alertdialog]')";
const waitToast = (pattern) =>
  waitFor(
    `[...document.querySelectorAll('[data-sonner-toast]')].some((t) => ${pattern}.test(t.innerText))`,
    10000,
  );

await viewport(390, 844);
await go("/settings", "document.body.innerText.includes('Settings')");
await ev("localStorage.clear(); sessionStorage.clear(); true");

// ---------- 1. Signed out: guest data stays local and no prompt ----------
await seedGuest();
await go("/saved", "document.body.innerText.includes('John 3:16')");
check(
  "signed out: the guest's saved verses show and no merge prompt appears",
  !(await ev(promptOpen)),
);

// ---------- 2. Sign in: the prompt asks first, and nothing is sent before consent ----------
await signIn(USER_A);
await go("/saved");
const opened = await waitFor(promptOpen, 10000);
const text = await dialogText();
check(
  "signed in with guest data: asks before adding anything",
  opened && /3 saved verses, 2 verses from your history and 1 chapter you read/.test(text),
  text,
);
check(
  "no data is sent before the person chooses",
  server.writes.length === 0,
  JSON.stringify(server.writes),
);
check(
  "while signed in, Saved shows only the account (guest items stay hidden)",
  !(await ev("document.querySelector('main').innerText")).includes("Romans 8:28"),
);

// ---------- 3. Partial failure keeps everything unconfirmed on the device ----------
server.failSavedWrites = 1;
await clickText(/^Add to my account$/, "[role=alertdialog]");
await waitToast("/couldn.t be added yet/");
let local = await guest();
check(
  "server failure: nothing is removed from the device and the prompt stays open to retry",
  local.saved.length === 3 && local.history.length === 3 && (await ev(promptOpen)),
  JSON.stringify({ saved: local.saved.length, history: local.history.length }),
);
check(
  "server failure: history isn't attempted after the saved batch failed",
  !server.writes.some((w) => w.table === "history"),
);

// ---------- 4. Retry succeeds: right account, ignore-duplicates, then cleared locally ----------
await clickText(/^Add to my account$/, "[role=alertdialog]");
await waitToast("/Added to your account/");
await waitFor(`!${promptOpen}`, 5000);
local = await guest();
const savedWrites = server.writes.filter((w) => w.table === "saved_verses");
const historyWrites = server.writes.filter((w) => w.table === "history");
const sentRows = [...savedWrites.flatMap((w) => w.rows), ...historyWrites.flatMap((w) => w.rows)];
check(
  "every row sent carries the signed-in user's id",
  sentRows.length > 0 && sentRows.every((row) => row.user_id === USER_A),
);
check(
  "saved verses are insert-or-ignore (existing account rows are never overwritten)",
  savedWrites.every((w) => w.prefer.includes("resolution=ignore-duplicates")),
  JSON.stringify(savedWrites.map((w) => w.prefer)),
);
check(
  "the account now has the 3 saved verses with their original dates",
  server.tables.saved_verses.length === 3 &&
    server.tables.saved_verses.some(
      (row) => row.verse === 28 && row.created_at === "2026-02-02T10:00:00.000Z",
    ),
);
const mergedChapter = server.tables.history.find((row) => row.kind === "chapter");
check(
  "verse history and the chapter visit were added; the chapter has no verse number",
  server.tables.history.length === 3 &&
    server.tables.history
      .filter((row) => row.kind === "verse")
      .every((row) => typeof row.verse === "number") &&
    mergedChapter?.verse === null &&
    mergedChapter?.chapter === 12 &&
    mergedChapter?.viewed_at === "2026-02-06T10:00:00.000Z",
  JSON.stringify(server.tables.history.map((row) => [row.kind, row.verse])),
);
check(
  "history merge is insert-or-ignore on the entry key",
  historyWrites.length > 0 &&
    historyWrites.every(
      (w) =>
        w.prefer.includes("resolution=ignore-duplicates") &&
        w.onConflict === "user_id,translation,book_id,chapter,verse",
    ),
  JSON.stringify(historyWrites.map((w) => [w.prefer, w.onConflict])),
);
check(
  "after success every merged item leaves the device",
  local.saved.length === 0 && local.history.length === 0,
  JSON.stringify(local),
);
await go("/saved", "document.body.innerText.includes('Romans 8:28')");
check(
  "Saved now lists the account's verses",
  /Romans 8:28/.test(await ev("document.querySelector('main').innerText")),
);

// ---------- 5. Running again adds nothing and asks nothing ----------
const writesBefore = server.writes.length;
await go("/saved");
await sleep(1500);
check(
  "after merging, the prompt doesn't return and nothing more is sent",
  !(await ev(promptOpen)) && server.writes.length === writesBefore,
);

// ---------- 5b. Signed-in History: chapters and verses go to the account as single upserts ----------
const chapterLoaded = "document.querySelectorAll('[data-verse-block]').length > 3";
const historyWritesNow = () => server.writes.filter((w) => w.table === "history");
let mark = historyWritesNow().length;
await go("/chapter/KJAV/psalms/23", chapterLoaded);
await sleep(5000); // dwell past the 4-second mark
let fresh = historyWritesNow().slice(mark);
check(
  "signed in: reading a chapter saves it to the account as one upsert with no verse",
  fresh.length === 1 &&
    fresh[0].method === "POST" &&
    fresh[0].prefer.includes("resolution=merge-duplicates") &&
    fresh[0].onConflict === "user_id,translation,book_id,chapter,verse" &&
    fresh[0].rows[0]?.kind === "chapter" &&
    fresh[0].rows[0]?.verse === null &&
    fresh[0].rows[0]?.user_id === USER_A,
  JSON.stringify(fresh),
);
await go("/chapter/KJAV/psalms/23", chapterLoaded);
await sleep(5000);
check(
  "signed in: reading it again keeps a single account entry",
  server.tables.history.filter((row) => row.kind === "chapter" && row.book_id === "psalms")
    .length === 1,
);
mark = historyWritesNow().length;
await go("/verse/KJAV/john/3/16", "/God so loved/.test(document.body.innerText)");
await sleep(1500);
fresh = historyWritesNow().slice(mark);
check(
  "signed in: opening a verse is one atomic upsert (no delete-then-insert)",
  fresh.length === 1 &&
    fresh[0].method === "POST" &&
    fresh[0].prefer.includes("resolution=merge-duplicates") &&
    fresh[0].rows[0]?.kind === "verse" &&
    fresh[0].rows[0]?.verse === 16,
  JSON.stringify(fresh.map((w) => [w.method, w.prefer])),
);
await go("/history", "document.body.innerText.includes('Psalms 23')");
const signedInLinks = await ev(
  "[...document.querySelectorAll('main a[href^=\"/chapter/\"], main a[href^=\"/verse/\"]')].map((a) => a.getAttribute('href'))",
);
check(
  "signed in: History lists account chapter and verse entries with the right links",
  signedInLinks.includes("/chapter/KJAV/psalms/23") &&
    signedInLinks.includes("/chapter/KJAV/romans/12") &&
    signedInLinks.includes("/verse/KJAV/john/3/16"),
  JSON.stringify(signedInLinks),
);
await ev("document.querySelector('main a[href=\"/chapter/KJAV/psalms/23\"]').click()");
await waitFor("location.pathname === '/chapter/KJAV/psalms/23'", 10000);
check(
  "signed in: the chapter entry reopens the chapter",
  (await ev("location.pathname")) === "/chapter/KJAV/psalms/23",
);

// ---------- 6. Account mismatch: the server says someone else is signed in ----------
await seedGuest();
await ev("sessionStorage.clear(); true");
server.authUser = USER_B;
await go("/saved");
await waitFor(promptOpen, 10000);
const mismatchWrites = server.writes.length;
await clickText(/^Add to my account$/, "[role=alertdialog]");
await waitToast("/Couldn.t confirm your account/");
local = await guest();
check(
  "account mismatch: aborts with nothing sent and nothing removed",
  server.writes.length === mismatchWrites && local.saved.length === 3 && local.history.length === 3,
);
server.authUser = USER_A;

// ---------- 7. "Not now" keeps the data and stops asking for this session ----------
await clickText(/^Not now$/, "[role=alertdialog]");
await waitFor(`!${promptOpen}`, 5000);
await go("/saved");
await sleep(1500);
local = await guest();
check(
  "Not now: data stays on the device and the prompt doesn't reappear this session",
  !(await ev(promptOpen)) && local.saved.length === 3,
);

// ---------- 8. "This isn't mine": removes the offered items from the device only ----------
await ev("sessionStorage.clear(); true");
await go("/saved");
await waitFor(promptOpen, 10000);
const removeWrites = server.writes.length;
await clickText(/This isn.t mine/, "[role=alertdialog]");
await waitFor(
  "/Remove from this device\\?/.test(document.querySelector('[role=alertdialog]')?.innerText ?? '')",
  5000,
);
await clickText(/^Remove from this device$/, "[role=alertdialog]");
await waitFor(`!${promptOpen}`, 5000);
local = await guest();
check(
  "This isn't mine: the offered guest items are deleted locally, nothing sent",
  local.saved.length === 0 &&
    local.history.length === 0 &&
    server.writes.length === removeWrites &&
    server.tables.saved_verses.length === 3,
  JSON.stringify(local),
);

// ---------- 9. Sign-out isolation ----------
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
await go("/saved", "document.body.innerText.includes('Saved')");
await sleep(800);
const afterSignOut = await ev("document.querySelector('main').innerText");
const deviceStorage = await ev(
  "Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)).join('\\n')",
);
check(
  "after sign-out, the account's verses aren't shown",
  !/John 3:16|Romans 8:28|Psalms 23:1/.test(afterSignOut),
  afterSignOut.slice(0, 160),
);
check(
  "after sign-out, no session and no account data remain on the device",
  !deviceStorage.includes(storageKey) && !deviceStorage.includes(USER_A),
);

check(
  "no request reached the real Supabase project",
  server.blocked.length === 0,
  server.blocked.join(", "),
);
check("no console errors or exceptions", state.errors.length === 0, state.errors.join(" | "));
b.summary();
