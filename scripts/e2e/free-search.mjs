// Free-search screen at phone widths, driven by a dev-only mock provider (no backend, no database,
// no AI). The mock is installed on globalThis.__verseSnapFreeSearch, which the app reads only in
// development (src/lib/bible/free-search.ts). One check at the end turns the mock off and goes
// through the real server function, which answers "preparing" while FREE_SEARCH_ENABLED is unset.
//   node scripts/e2e/free-search.mjs     (with `npm run dev -- --port 8091` running; settings in lib.mjs)
import { openBrowser } from "./lib.mjs";

// The query text picks the mock's behaviour, so each state is one URL.
const MOCK = `
(() => {
  try { if (localStorage.getItem('vsMock') === 'off') return; } catch {}
  window.__aborted = 0;
  window.__calls = [];
  const mk = (i, translation) => ({
    translation, bookId: 'psalms', bookName: 'Psalms', chapter: (i % 150) + 1, verse: (i % 30) + 1,
    reference: 'Psalms ' + ((i % 150) + 1) + ':' + ((i % 30) + 1),
    text: 'Mock verse number ' + i + ' with a fairly long line of text so that wrapping is exercised on narrow phone screens.',
  });
  const page = (n, total, offset, extra = {}) => {
    const results = Array.from({ length: Math.max(0, Math.min(25, n - offset)) }, (_, i) => mk(offset + i, (offset + i) % 2 ? 'WEB' : 'BSB'));
    const end = offset + results.length;
    return { status: 'ready', total, offset, results, hasMore: end < n, limitReached: false, searchedEditions: ['WEB', 'BSB', 'ASV'], ...extra };
  };
  globalThis.__verseSnapFreeSearch = {
    async search({ query, offset = 0, signal, repair }) {
      const q = query.toLowerCase();
      window.__calls.push([q, offset]);
      window.__repairs = (window.__repairs || []).concat([repair]);
      if (q.includes('too many searches') && !window.__limitHeal) throw Object.assign(new Error('limit'), { name: 'FreeSearchError', kind: 'limit' });
      if (q.includes('slow one')) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 4000);
          signal?.addEventListener('abort', () => { clearTimeout(t); window.__aborted += 1; reject(new DOMException('Aborted', 'AbortError')); });
        });
        return page(3, 3, 0);
      }
      if (q.includes('still preparing')) return { status: 'preparing', total: 0, offset: 0, results: [], hasMore: false, limitReached: false, searchedEditions: [] };
      if (q.includes('trigger network failure') && !window.__fsHeal) throw new TypeError('Failed to fetch');
      if (q.includes('nothing found')) return page(0, 0, 0);
      if (q.includes('page two fails') && offset === 25 && !window.__pageHeal) throw new Error('page failed');
      if (q.includes('plenty of verses') || q.includes('page two fails')) return page(60, 60, offset);
      if (q.includes('huge result')) {
        const p = page(75, 5000, offset);
        return offset >= 50 ? { ...p, hasMore: false, limitReached: true } : { ...p, hasMore: true };
      }
      if (q.includes('three editions')) {
        // The same 10 verses, each found in BSB, WEB and ASV: 30 rows from the server.
        const results = [];
        for (let i = 0; i < 10; i += 1) for (const translation of ['BSB', 'WEB', 'ASV']) {
          results.push({ ...mk(i, translation), text: translation + ' wording of verse ' + i });
        }
        return { status: 'ready', total: 30, offset: 0, results, hasMore: false, limitReached: false, searchedEditions: ['WEB', 'BSB', 'ASV'] };
      }
      if (q.includes('sheperd')) return repair === false ? page(0, 0, 0) : page(2, 2, offset, { correctedQuery: 'shepherd now' });
      return page(2, 2, offset);
    },
  };
})();
`;

const b = await openBrowser({ init: MOCK });
const { ev, go, viewport, shot, check, state, clickText, waitFor, sleep } = b;

const overflow = () => ev("document.documentElement.scrollWidth - innerWidth");
const text = () => ev("document.body.innerText");
const rows = () => ev("document.querySelectorAll('section[aria-live] ul > li').length");
const open = (q, ready) =>
  go(
    `/search?q=${encodeURIComponent(q)}`,
    ready ??
      "document.body.innerText.includes('Psalms') || document.body.innerText.includes('No verses') || document.body.innerText.includes('Connection') || document.body.innerText.includes('prepared')",
  );
const showMore = async () => {
  await clickText(/Show more verses/);
  await sleep(500);
};

for (const [width, height] of [
  [360, 780],
  [390, 844],
  [430, 932],
]) {
  await viewport(width, height);
  const tag = `${width}px`;

  // Results: each row names its edition, links to that edition, the unindexed note is shown.
  await open("mock some verses");
  let t = await text();
  check(
    `${tag} results: two rows, each with its edition`,
    (await rows()) === 2 && /BSB/.test(t) && /WEB/.test(t),
  );
  check(`${tag} results: total is stated`, /2 verses/.test(t), t.slice(-160));
  check(
    `${tag} results: unindexed editions are named, not treated as empty`,
    /Full-text search isn't available yet for KJAV, BBE and FBV\./.test(t),
    t.slice(-200),
  );
  const hrefs = await ev(
    "[...document.querySelectorAll('section[aria-live] ul a')].map((a) => a.getAttribute('href'))",
  );
  check(
    `${tag} results: links open the matching edition`,
    hrefs[0].startsWith("/verse/BSB/psalms/") && hrefs[1].startsWith("/verse/WEB/psalms/"),
    hrefs.join(","),
  );
  check(
    `${tag} results: no horizontal overflow or console errors`,
    (await overflow()) <= 0 && state.errors.length === 0,
    state.errors.join(" | "),
  );
  if (width === 390) await shot("free-search-results.png");

  await ev("document.querySelectorAll('section[aria-live] ul a')[1].click()");
  await waitFor("location.pathname.startsWith('/verse/')");
  check(
    `${tag} navigation: tapping a WEB result opens /verse/WEB/…`,
    (await ev("location.pathname")).startsWith("/verse/WEB/psalms/"),
    await ev("location.pathname"),
  );

  // Server-backed pagination: 10 shown, the next page fetched when what is loaded runs out.
  await open("plenty of verses here");
  t = await text();
  check(
    `${tag} paging: first 10 of 60, with 'Showing 10 verses'`,
    (await rows()) === 10 && /Showing 10 verses/.test(t),
    `${await rows()} ${t.slice(-120)}`,
  );
  await showMore();
  check(
    `${tag} paging: Show more reveals 20 from what is loaded (no new request)`,
    (await rows()) === 20 && (await ev("window.__calls.length")) === 1,
    `${await rows()} calls ${await ev("window.__calls.length")}`,
  );
  await showMore();
  await waitFor("document.querySelectorAll('section[aria-live] ul > li').length === 30");
  check(
    `${tag} paging: passing 25 fetches the next page from the server (offset 25)`,
    (await rows()) === 30 &&
      JSON.stringify(await ev("window.__calls.at(-1)")) ===
        JSON.stringify(["plenty of verses here", 25]),
    JSON.stringify(await ev("window.__calls")),
  );
  check(
    `${tag} paging: summary follows ('Showing 30 verses')`,
    /Showing 30 verses/.test(await text()),
  );
  for (let i = 0; i < 4; i += 1) await showMore();
  await waitFor("document.querySelectorAll('section[aria-live] ul > li').length === 60");
  t = await text();
  check(
    `${tag} paging: all 60 shown, '60 verses', no more button`,
    (await rows()) === 60 && /\b60 verses\b/.test(t) && !/Show more verses/.test(t),
    t.slice(-160),
  );
  check(`${tag} paging: no overflow`, (await overflow()) <= 0);
  if (width === 390) await shot("free-search-paged.png");

  // A later page fails: rows already loaded stay, a retry continues.
  await open("page two fails");
  await showMore();
  await showMore();
  await waitFor('document.body.innerText.includes("couldn\'t load more")');
  t = await text();
  check(
    `${tag} next-page failure: loaded verses stay, message and Try again shown`,
    (await rows()) === 25 && /couldn.t load more verses/.test(t) && /Try again/.test(t),
    t.slice(-200),
  );
  await ev("window.__pageHeal = true");
  await clickText(/Try again/);
  await waitFor("document.querySelectorAll('section[aria-live] ul > li').length === 30");
  check(`${tag} next-page failure: Try again loads the page`, (await rows()) === 30);
  await ev("window.__pageHeal = false");

  // Typo repair wording.
  await open("sheperd now");
  t = await text();
  check(
    `${tag} corrected query: 'Showing results for shepherd now'`,
    /Showing results for\s+shepherd now/.test(t),
    t.slice(0, 200),
  );

  // "Search instead for the original wording", and back to the corrected spelling.
  check(
    `${tag} corrected query: offers 'Search instead for sheperd now'`,
    /Search instead for\s+sheperd now/.test(t),
    t.slice(0, 240),
  );
  await clickText(/^sheperd now$/);
  await waitFor("document.body.innerText.includes('No verses found')");
  t = await text();
  check(
    `${tag} original wording: searched as typed (repair off), says so, offers the corrected spelling`,
    /Showing results for\s+sheperd now/.test(t) &&
      /Use the corrected spelling instead:\s+shepherd now/.test(t) &&
      (await ev("window.__repairs.at(-1)")) === false,
    t.slice(0, 300) + " repairs=" + JSON.stringify(await ev("window.__repairs")),
  );
  check(`${tag} original wording: no overflow`, (await overflow()) <= 0);
  if (width === 390) await shot("free-search-original-wording.png");
  await clickText(/^shepherd now$/);
  await waitFor("document.querySelectorAll('section[aria-live] ul > li').length === 2");
  check(
    `${tag} corrected spelling again: results back, repair on`,
    (await rows()) === 2 && /Search instead for\s+sheperd now/.test(await text()),
  );

  // Retrieval limit.
  await open("huge result set");
  for (let i = 0; i < 9; i += 1) await showMore();
  await waitFor("document.body.innerText.includes('Refine your search')");
  t = await text();
  check(
    `${tag} retrieval limit: says it and suggests refining`,
    /Showing 75 verses\. There are more matches than can be shown\. Refine your search to narrow the results\./.test(
      t,
    ),
    t.slice(-200),
  );
  check(`${tag} retrieval limit: no overflow`, (await overflow()) <= 0);

  // The same verse in several editions is one result, with the other editions listed beside it.
  await open("three editions of every verse");
  t = await text();
  check(
    `${tag} editions: 30 matches across 3 editions show as 10 verses, one row each`,
    (await rows()) === 10 && /\b10 verses\b/.test(t) && !/Show more verses/.test(t),
    `${await rows()} len=${t.length} ${JSON.stringify(t.slice(-200))}`,
  );
  check(
    `${tag} editions: each row shows the best edition and lists the others`,
    (await ev(
      "[...document.querySelectorAll('section[aria-live] ul > li')].every((li) => /BSB wording of verse/.test(li.innerText) && /also WEB, ASV/.test(li.innerText) && !/WEB wording/.test(li.innerText))",
    )) === true,
  );
  check(
    `${tag} editions: each row opens the verse in the edition shown`,
    (await ev(
      "[...document.querySelectorAll('section[aria-live] ul > li a')].every((a) => a.getAttribute('href').startsWith('/verse/BSB/'))",
    )) === true,
  );
  check(`${tag} editions: no overflow`, (await overflow()) <= 0);

  // Rate-limit message with retry.
  await open("too many searches now", "document.body.innerText.includes('searched a lot')");
  t = await text();
  check(
    `${tag} rate limit: says to wait, offers Try again, no Smart Search`,
    /searched a lot in a short time/.test(t) && /Try again/.test(t) && !/Smart Search/.test(t),
    t.slice(0, 260),
  );
  await ev("window.__limitHeal = true");
  await clickText(/Try again/);
  await waitFor("document.querySelectorAll('section[aria-live] ul > li').length === 2");
  check(`${tag} rate limit: Try again works once the limit has passed`, (await rows()) === 2);
  await ev("window.__limitHeal = false");

  // A single keyword is searched (not blocked as "too short").
  await open("shepherd");
  t = await text();
  check(
    `${tag} keyword: one word is searched, not refused`,
    (await rows()) === 2 && !/Add a few more words/.test(t),
    t.slice(0, 200),
  );

  // Back navigation: results come back from memory, with no new request.
  await open("mock some verses");
  const callsBefore = await ev("window.__calls.length");
  await ev("document.querySelectorAll('section[aria-live] ul a')[0].click()");
  await waitFor("location.pathname.startsWith('/verse/')");
  await ev("history.back()");
  await waitFor("location.pathname === '/search'");
  await waitFor("document.querySelectorAll('section[aria-live] ul > li').length === 2");
  check(
    `${tag} back: the results are still there and nothing was searched again`,
    (await rows()) === 2 && (await ev("window.__calls.length")) === callsBefore,
    `rows ${await rows()} calls ${await ev("window.__calls.length")} vs ${callsBefore}`,
  );

  // Reference search goes straight to the verse.
  await go("/search", "document.querySelector('input[name=q]') !== null");
  await ev(`(() => {
    const input = document.querySelector('input[name=q]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'John 3:16');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.requestSubmit();
  })()`);
  await waitFor("location.pathname.startsWith('/verse/')");
  check(
    `${tag} reference: John 3:16 opens the verse, no search`,
    /\/verse\/[A-Za-z]+\/john\/3\/16/.test(await ev("location.pathname")),
    await ev("location.pathname"),
  );

  // Empty, error with retry, preparing.
  await open("nothing found anywhere");
  t = await text();
  check(
    `${tag} empty: names the editions searched, offers Try again, notes the unindexed`,
    /No verses found/.test(t) &&
      /WEB, BSB and ASV/.test(t) &&
      /Try again/.test(t) &&
      /isn't available yet for KJAV/.test(t),
    t.slice(0, 300),
  );
  check(`${tag} empty: no overflow`, (await overflow()) <= 0);
  if (width === 390) await shot("free-search-empty.png");

  await ev("window.__fsHeal = false");
  await open("trigger network failure now");
  t = await text();
  check(
    `${tag} error: connection message with Try again, no Smart Search`,
    /Connection problem/.test(t) && /Try again/.test(t) && !/Smart Search/.test(t),
    t.slice(0, 300),
  );
  if (width === 390) await shot("free-search-error.png");
  await ev("window.__fsHeal = true");
  await clickText(/Try again/);
  await waitFor("document.body.innerText.includes('Psalms')");
  check(
    `${tag} error: Try again retries free search and shows results`,
    (await rows()) === 2,
    String(await rows()),
  );

  await open("still preparing index");
  t = await text();
  check(
    `${tag} preparing: approved message, Try again, no Smart Search button`,
    /Free Bible search is being prepared/.test(t) &&
      /Try again/.test(t) &&
      !/Try Smart Search/.test(t),
    t.slice(0, 300),
  );
  check(
    `${tag} preparing: no overflow or console errors`,
    (await overflow()) <= 0 && state.errors.length === 0,
    state.errors.join(" | "),
  );
  await ev("window.__fsHeal = false");
}

// Cancellation: starting another search aborts the one still waiting.
await viewport(390, 844);
await go(
  "/search?q=" + encodeURIComponent("slow one please"),
  "document.body.innerText.includes('Finding your verse') || true",
);
await sleep(600);
await ev(`(() => {
  const input = document.querySelector('input[name=q]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'mock some verses');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.form.requestSubmit();
})()`);
await waitFor("document.body.innerText.includes('Psalms')");
check(
  "cancellation: the superseded search was aborted",
  (await ev("window.__aborted")) >= 1,
  String(await ev("window.__aborted")),
);
check(
  "cancellation: only the newer search's results are shown",
  (await rows()) === 2,
  String(await rows()),
);

// The real server function (mock off): disabled, it answers "preparing".
await go("/");
await ev("localStorage.setItem('vsMock', 'off')");
await go(
  "/search?q=" + encodeURIComponent("the lord is my shepherd"),
  "document.body.innerText.includes('prepared') || document.body.innerText.includes('Connection') || document.body.innerText.includes('No verses')",
);
const real = await text();
check(
  "real server function: 'being prepared' while FREE_SEARCH_ENABLED is unset",
  /Free Bible search is being prepared/.test(real) && state.errors.length === 0,
  real.slice(0, 200) + state.errors.join("|"),
);
await ev("localStorage.removeItem('vsMock')");

b.summary();
