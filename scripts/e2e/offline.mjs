// Offline Bible downloads (stage 1) at 320px as a guest, in a real browser with real IndexedDB:
// the download icon on WEB and ASV only in the Settings translation popup, downloading without
// selecting or closing, progress in the row, the check once stored and verified, persistence, the
// existing Reader showing downloaded text with the Bible service blocked, the "read in a downloaded
// translation" option, removing, and cancelling. Downloads the real WEB file (about 6 MB).
//   npm run test:e2e:offline      (with the app running; see lib.mjs for settings)
import { openBrowser } from "./lib.mjs";

const b = await openBrowser();
const { ev, waitFor, go, viewport, send, check, summary, sleep, state } = b;

await send("Network.enable");
await viewport(320, 700);

const text = () => ev("document.body.innerText");
const click = (selector, label) =>
  ev(
    `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => (x.getAttribute('aria-label') || x.innerText).replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true; })()`,
  );
const idb = (expr) =>
  ev(`new Promise((resolve, reject) => {
    const open = indexedDB.open('versesnap-offline');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('chapters')) return resolve({ chapters: 0, downloads: [] });
      const tx = db.transaction(['chapters', 'downloads'], 'readonly');
      const c = tx.objectStore('chapters').count();
      const d = tx.objectStore('downloads').getAll();
      tx.oncomplete = () => resolve({ chapters: c.result, downloads: d.result.map((x) => x.translation + ':' + x.chapters) });
    };
  }).then((r) => ${expr})`);
const block = (on) => send("Network.setBlockedURLs", { urls: on ? ["*bible.helloao.org*"] : [] });
const openPopup = async () => {
  await go("/settings", "document.body.innerText.includes('Bible translation')");
  await click("button", "Bible translation");
  await waitFor("!!document.querySelector('[role=dialog] fieldset')", 8000);
};
const selected = () => ev("document.querySelector('input[name=bible_translation]:checked')?.value");

// ---- clean start
await go("/", "document.body.innerText.length > 40");
await ev(
  "new Promise((r) => { const q = indexedDB.deleteDatabase('versesnap-offline'); q.onsuccess = q.onerror = q.onblocked = () => r(); })",
);
await ev("localStorage.clear()");

// ================= the popup =================
await openPopup();
const downloadButtons = await ev(
  "[...document.querySelectorAll('[role=dialog] button[aria-label^=\"Download \"]')].map((x) => x.getAttribute('aria-label'))",
);
check(
  "only WEB and ASV have a download icon",
  downloadButtons.length === 2 &&
    downloadButtons.some((l) => /World English Bible/.test(l)) &&
    downloadButtons.some((l) => /American Standard/.test(l)),
  JSON.stringify(downloadButtons),
);
check(
  "the rows for BSB, KJAV, BBE and FBV have no download control",
  await ev(
    `(() => ['BSB', 'KJAV', 'BBE', 'FBV'].every((code) => { const row = document.querySelector('[role=dialog] [data-translation-row="' + code + '"]'); return row && !row.querySelector('button'); }))()`,
  ),
);
check(
  "the download icon sits right after the abbreviation, not at the end of the row",
  await ev(
    `(() => { const row = document.querySelector('[role=dialog] [data-translation-row="WEB"]'); const code = [...row.querySelectorAll('span')].find((s) => s.children.length === 0 && s.innerText.trim() === 'WEB').getBoundingClientRect(); const btn = row.querySelector('button[aria-label^="Download "]').getBoundingClientRect(); const circle = row.querySelector('span[aria-hidden]').getBoundingClientRect(); return btn.left >= code.right - 1 && btn.left - code.right < 14 && btn.right < circle.left - 40; })()`,
  ),
);
check("the current translation (KJAV) is selected", (await selected()) === "KJAV");

await click("[role=dialog] button", "Download World English Bible");
await waitFor("!!document.querySelector('[role=dialog] [role=progressbar]')", 10000);
check(
  "tapping Download keeps the popup open and the selection unchanged",
  (await ev("!!document.querySelector('[role=dialog]')")) && (await selected()) === "KJAV",
);
check(
  "progress shows inside the WEB row",
  await ev(
    `(() => { const row = document.querySelector('[role=dialog] [data-translation-row="WEB"]'); const bar = row?.querySelector('[role=progressbar]'); return !!bar && /Downloading|Saving|Checking/.test(row.innerText) && /\\d+%/.test(row.innerText); })()`,
  ),
);
await waitFor(
  "!!document.querySelector('[role=dialog] [role=img][aria-label*=\"is downloaded for offline\"]')",
  150000,
);
check(
  "when finished the icon is replaced by a downloaded check and a small remove icon, with no extra text line",
  await ev(
    `(() => { const row = document.querySelector('[role=dialog] [data-translation-row="WEB"]'); return !!row.querySelector('[role=img]') && !!row.querySelector('button[aria-label^="Remove the download of"]') && !row.querySelector('button[aria-label^="Download "]') && !/Downloaded|works offline|MB/.test(row.innerText) && !row.querySelector('[role=progressbar]'); })()`,
  ),
  await text(),
);
check(
  "the check and bin sit right after the abbreviation on the same line",
  await ev(
    `(() => { const row = document.querySelector('[role=dialog] [data-translation-row="WEB"]'); const code = [...row.querySelectorAll('span')].find((s) => s.children.length === 0 && s.innerText.trim() === 'WEB').getBoundingClientRect(); const mark = row.querySelector('[role=img]').getBoundingClientRect(); return mark.left >= code.right - 1 && mark.left - code.right < 14 && Math.abs((mark.top + mark.height / 2) - (code.top + code.height / 2)) < 14; })()`,
  ),
);
check(
  "the popup is still open and the selection is still KJAV",
  (await ev("!!document.querySelector('[role=dialog]')")) && (await selected()) === "KJAV",
);
const stored = await idb("r");
check(
  "1,189 chapters are stored and the download is recorded as complete",
  stored && stored.chapters === 1189 && stored.downloads.join() === "WEB:1189",
  JSON.stringify(stored),
);
check(
  "ASV is still offered",
  await ev(
    "!!document.querySelector('[role=dialog] button[aria-label^=\"Download American Standard\"]')",
  ),
);

// ================= persistence =================
await openPopup();
await waitFor(
  "!!document.querySelector('[role=dialog] [role=img][aria-label*=\"is downloaded for offline\"]')",
  10000,
);
check("after a reload the WEB row still shows downloaded", true);

// ================= the Reader, with the Bible service blocked =================
const at = "2026-10-22T09:00:00.000Z";
await ev(`(() => {
  localStorage.setItem('versesnap.highlights.v1', JSON.stringify([{ id: 'WEB/john/3/16', translation: 'WEB', bookId: 'john', chapter: 3, verse: 16, color: 'amber', at: ${JSON.stringify(at)} }]));
  localStorage.setItem('versesnap.journal.v1', JSON.stringify({ notebooks: [{ id: 'general', name: 'General Reflections', isDefault: true, createdAt: ${JSON.stringify(at)}, updatedAt: ${JSON.stringify(at)} }], reflections: [{ id: '11111111-1111-4111-8111-111111111111', translation: 'WEB', bookId: 'john', chapter: 3, verse: 16, notebookId: 'general', title: '', body: 'A thought', tags: [], posture: null, isPrivate: true, createdAt: ${JSON.stringify(at)}, updatedAt: ${JSON.stringify(at)} }] }));
})()`);
await block(true);
await go("/chapter/WEB/john/3", "document.querySelectorAll('[data-verse-block]').length > 20");
check(
  "a downloaded chapter opens in the existing Reader with the Bible service blocked",
  /God so loved the world/.test(await text()) && !/Connection problem/.test(await text()),
);
check(
  "the guest highlight and the note icon still work on it",
  await ev(
    "/bg-hl-/.test(document.querySelector('[data-verse-block=\"16\"]').className) && !!document.querySelector('[data-note-icon=\"16\"]')",
  ),
);
await go("/verse/WEB/john/3/16", "document.body.innerText.includes('God so loved')");
check(
  "a downloaded verse opens, and its next verse is found offline",
  /God so loved the world/.test(await text()) &&
    (await waitFor(
      "!!document.querySelector('a[aria-label^=\"Next verse: John 3:17\"]')",
      8000,
    ).then(
      () => true,
      () => false,
    )),
);

await go("/chapter/KJAV/john/3", "document.body.innerText.includes('Connection problem')");
const msg = await text();
check(
  "a translation that isn't downloaded says so and offers the downloaded one",
  /Connection problem/.test(msg) &&
    /KJAV isn.t available offline/.test(msg) &&
    /WEB is downloaded/.test(msg) &&
    (await ev(
      "[...document.querySelectorAll('button')].some((x) => x.innerText.trim() === 'Read in WEB')",
    )),
);
await click("button", "Read in WEB");
await waitFor("location.pathname === '/chapter/WEB/john/3'", 8000);
await waitFor("document.querySelectorAll('[data-verse-block]').length > 20", 15000);
check(
  "switching opens the same chapter in WEB from the device",
  /God so loved the world/.test(await text()),
);
await block(false);

// ================= remove =================
await openPopup();
await waitFor(
  "!!document.querySelector('[role=dialog] [role=img][aria-label*=\"is downloaded for offline\"]')",
  10000,
);
await click("[role=dialog] button", "Remove the download of World English Bible");
await sleep(250);
check("tapping the bin asks Remove? once", /Remove\?/.test(await text()));
await click("[role=dialog] button", "Confirm removing the download of World English");
await waitFor(
  "!!document.querySelector('[role=dialog] button[aria-label^=\"Download World English Bible\"]')",
  20000,
);
await sleep(600);
const after = await idb("r");
check(
  "removing brings back the download icon and deletes the chapters and the record",
  after && after.chapters === 0 && after.downloads.length === 0,
  JSON.stringify(after),
);
check(
  "the popup stayed open and the selection is unchanged",
  (await ev("!!document.querySelector('[role=dialog]')")) && (await selected()) === "KJAV",
);
await block(true);
await go("/chapter/WEB/john/3", "document.body.innerText.includes('Connection problem')");
check(
  "with nothing downloaded the Reader shows the usual connection problem and no switch",
  !(await ev(
    "[...document.querySelectorAll('button')].some((x) => /^Read in /.test(x.innerText.trim()))",
  )),
);
await block(false);

// ================= cancel =================
await openPopup();
// Slow the network down so the download is still running when it is cancelled.
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 150,
  downloadThroughput: 250 * 1024,
  uploadThroughput: 250 * 1024,
});
await click("[role=dialog] button", "Download American Standard");
await waitFor(
  "!!document.querySelector('[role=dialog] button[aria-label^=\"Cancel the download of American\"]')",
  10000,
);
await click("[role=dialog] button", "Cancel the download of American");
await waitFor(
  "!!document.querySelector('[role=dialog] button[aria-label^=\"Download American Standard\"]')",
  20000,
);
await sleep(800);
await send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
const cancelled = await idb("r");
check(
  "cancelling returns to the download icon and leaves nothing stored",
  cancelled && cancelled.chapters === 0 && cancelled.downloads.length === 0,
  JSON.stringify(cancelled),
);
check(
  "no sideways scrolling and no page errors",
  !(await ev("document.documentElement.scrollWidth > innerWidth")) &&
    state.errors.filter(
      (e) =>
        !/helloao|Failed to load resource|net::ERR|offline|NetworkError/i.test(JSON.stringify(e)),
    ).length === 0,
  JSON.stringify(state.errors).slice(0, 300),
);

summary();
