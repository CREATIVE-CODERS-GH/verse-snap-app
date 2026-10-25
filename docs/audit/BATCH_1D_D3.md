# Batch 1D — Stage D3 record (free keyword search wired to the Search screen; local only)

> **Amended in D4** (see [BATCH_1D_D4.md](BATCH_1D_D4.md)): a one-word query is now a keyword search (the router had refused it); the database-side time limit now exists (a function-level `statement_timeout`, which works through PostgREST but not from a direct SQL session); a caller hanging up does not cancel a running statement; the repair is capped at 3 words and has an original-wording option.

*2026-10-21. Local development and testing. Nothing applied to Supabase, no Bible text in the repo or any live database, AI Smart Search still off, no commit/push/deploy. Migrations remain unapplied.*

## 1. Files

| New | Purpose |
|---|---|
| `src/lib/bible/free-search-protocol.ts` | Browser-safe contract: request schema (strict, edition allow-list WEB/BSB/ASV), query normalisation, paging constants, result types |
| `src/lib/bible/free-search.functions.ts` | The server-function shell: a POST, loads the service by dynamic import |
| `src/lib/bible/free-search.server.ts` | The only code that reaches the index: config, kill switch, identity, rate limit, search, mapping; `FreeSearchStore` (mockable) and the Supabase store |
| `src/lib/bible/verse-text.ts` | Punctuation-aware verse text assembly (Reader fix) |
| tests | `free-search.server.test.ts` (53), `free-search-client.test.ts` (16), `free-search-safety.test.ts` (8), `free-search.integration.test.ts` (16, real PostgreSQL), `verse-text.test.ts` (26 incl. whole-Bible check) |
| `supabase/verification/08a_bible_search_preflight.sql` | Read-only pre-flight for the dev project |

| Modified | Change |
|---|---|
| `src/lib/bible/free-search.ts`, `free-search-mock.ts`, `search-view.ts` | Server-backed provider, infinite-query options, summary text; mock follows the new shape |
| `src/routes/search.tsx`, `src/components/search-results.tsx` | Search screen uses the server provider; "Showing N of total", corrected-query note, next-page loading/error |
| `src/lib/bible/helloao-provider.ts` | Uses `assembleVerseText` (Reader fix); nothing else changed |
| `scripts/bible-import/lib.mjs` | Import uses the same assembly rule as the Reader |
| `supabase/verification/08_bible_search_checks.sql` | Adds log-privacy checks |
| `scripts/db/lib.mjs`, `bible-search-migration-test.mjs` | `stop()`; pre-flight check |
| `scripts/e2e/free-search.mjs` | 72 phone-width checks incl. paging, retry, cancellation, real server function |
| `.env.example` | Documents `FREE_SEARCH_ENABLED=false` and the optional limits (template only; `.env.local` untouched) |
| `src/lib/bible/parse-reference.test.ts` | One timeout raised (it parses a large golden file and now crosses 5 s when more test files run in parallel) |

Batch 1C files, `package.json`, `search-states.tsx` and the Reflect screen are untouched.

## 2. Server-side architecture

`browser → POST /_serverFn → runFreeSearch → FreeSearchStore → search_bible()` (the store is a Supabase service-role client in production, a `pg` adapter in the integration test, a fake in unit tests).

Order of work; each step can stop the request and nothing after it runs:

1. **Kill switch** `FREE_SEARCH_ENABLED` (off unless exactly `true`): answers "preparing"; no database, no quota.
2. **Shape** (strict zod): unknown keys, editions outside WEB/BSB/ASV, offset outside 0–1,000, limit outside 1–25 are refused before anything else.
3. **Query rules**: Unicode NFC, control characters and runs of space collapsed, 2–200 characters.
4. **Identity**: verified token → `user:<uuid>`, else a keyed HMAC of the trusted client address (`ip:<hex>`); no salt configured means refusal (it could not meter the caller).
5. **Readiness**: active editions read from `bible_sources` (cached 60 s). None active → "preparing", and no quota is spent.
6. **Rate limit before the search**: `consume_free_search_quota` (30/min, 600/day per guest; 60/1,500 signed in; 300/min shared). One atomic call; refused attempts count nowhere; **fail closed** if the counter cannot be read; every page costs one unit.
7. **Search** with one hard time limit (default 2 s, 0.5–5 s) that also fires when the caller disconnects.
8. **Mapping** to canonical edition codes, Reader book slugs and references; rows it cannot map are dropped.

All database calls use bound parameters through `rpc(...)`. Errors are values (`FreeSearchServerResult`), never thrown text. KJAV stays out by three independent gates: the schema allow-list, the code allow-list and the database licence gate.

## 3. Search screen behaviour

No redesign; existing components and tokens. Free search is what Enter/Search start.

- **Results**: each row shows its edition and opens `/verse/{edition}/{book}/{chapter}/{verse}` in that edition.
- **Paging**: 25 per request, 10 revealed at a time; passing what is loaded fetches the next page from the server's offset. "Showing 10 of 395 verses", "395 verses" when all are shown. At the 1,025-row retrieval limit: "Showing 1,025 of 11,900 verses. Refine your search to narrow the results."
- **Corrected query**: "Showing results for **shepherd**" above the list (also above "No verses found").
- **States**: loading, empty (names the editions searched), connection / too many searches / timed out / failed, each with **Try again**; a failed later page keeps the verses already loaded and offers its own retry; "being prepared" while the switch is off.
- **Unindexed editions**: "Full-text search isn't available yet for KJAV, BBE and FBV." comes from the server's list of editions actually searched, so a no-match never implies BBE/FBV/KJAV were searched.
- **Cancellation**: the abort signal reaches the server function and the database call; a newer search cancels the older one (tested at unit, browser and integration level).
- **Search history**: none. Results live in memory only; nothing in browser storage.

## 4. Reader text bug

Cause (measured on the 93,270 real verses): the source splits a verse into pieces (poetry lines, quoted speech, line breaks) and rarely puts whitespace between them; the Reader joined them with nothing. Every join without whitespace in the data is one of: poem line to poem line, line break, quoted words of Jesus, or acrostic heading. No piece is split mid-word.

Fix (`verse-text.ts`, used only inside `helloao-provider.ts`): pieces are separated by one space **unless** whitespace is already there, the next piece starts with closing punctuation, a dash or a combining mark, or the previous piece ends with an opening quote/bracket or a dash/hyphen. `lineBreak` and footnote markers stand for a space, as footnotes already did.

Evidence: 26 tests (adjacent words, punctuation, quotation marks, Hebrew letters and vowel marks, verses already correct, BSB Genesis 1:5, provider integration); **whole-Bible check on all 93,291 verses of WEB/BSB/ASV: only whitespace changed (never a character), 0 verses gained a space before punctuation, 7,695 WEB / 9,421 BSB / 5,059 ASV verses repaired**; confirmed in the running app (BSB Genesis 1:5: `“night.” And there was evening`; WEB Genesis 3:14: `serpent, “Because you have done this, you are cursed…`). The search index uses the identical rule, so search results and the Reader show the same text.

## 5. Security and privacy findings

- **POST confirmed in a real browser**: `POST /_serverFn/<id>` with the query in the body; none in that URL.
- **Not sufficient alone, so also**: the query is a bound parameter and goes nowhere else: not stored, cached, logged, or put in an error (static test of the source, runtime test across 7 outcomes, and an integration test that searches a marker phrase then scans every table and every SQL text). Logs are a fixed shape (outcome, counts, duration, an error *code*). Unexpected failures log the error class and code only. The store reduces any database error to a kind and code.
- **Finding (pre-existing, not changed): the Search screen's own URL carries the query** (`/search?q=…`, used for Back and reload). It therefore reaches browser history, and Vercel's access log when that page is loaded or reloaded directly. The in-app search itself is not affected. Decision needed (section 8).
- **Statement logging (checked against Supabase's documentation, not the live project)**: defaults are `log_min_duration_statement = -1` and `log_min_error_statement = error`; statement text is logged on error, bound parameters are logged only if `log_parameter_max_length_on_error` is raised or `log_statement` is `all`/`mod`. Checks for all three are now in `08a` (before) and `08` (after).
- **Rate limit before expensive work**: verified by order-of-calls tests and against the real database (a refused request never reaches the search; 12 simultaneous requests with an allowance of 5 get exactly 5; the shared ceiling stops everyone).
- **Timeouts**: the server enforces its own limit and returns a plain "timeout" answer. **Correction to D2**: a function-level `SET statement_timeout` neither cancels nor extends the running call in PostgreSQL 17.10 (tested). Supabase's docs say it works through the REST API; I could not verify that, so the server-side limit is the one relied on. Supabase's default role timeouts are `service_role`: none (falls back to `authenticator`'s 8 s), documented.
- **SQL access control**: `anon` and `authenticated` get permission denied on the search function, the quota function and every new table, with Supabase's default function grants simulated; the service key exists only in `*.server.ts` and is loaded lazily.

## 6. Database integration (disposable PostgreSQL 17, UTF-8, real WEB/BSB/ASV)

The real server module against the real SQL functions, 16 tests, all pass: "preparing" before promotion with no quota spent; the John 3:16 phrase in all three editions with canonical codes and Reader slugs; older vocabulary only in ASV; an edition filter honoured; ranking and exact totals (equal to an independent count); typo repair with the corrected wording; walking every page by the server's offsets (395 distinct verses, stable total); the 1,025-row limit ("God": 11,900 matches); unindexed editions never reported as searched; every sampled result exists in the Reader's own chapter data; rate limits (per person, shared ceiling, concurrency, fail-closed); access control for `anon`/`authenticated`; a 1 ms database timeout becomes a plain timeout and the next search works; privacy scan of every table; the function writes nothing. Also re-run: schema suite 114/114, import suite 83/83.

## 7. Mobile and build results

- Browser test at 360, 390 and 430 px: **72/72** (results, edition labels, links, paging 10→20→30 with a real next-page request, next-page failure and retry, corrected wording, retrieval limit, empty, error with retry, preparing, cancellation, the real server function answering "preparing"). No horizontal overflow, no console errors. Existing mobile smoke test 30/30.
- **808 tests pass in 42 files with the database integration included; 791 pass and 17 are skipped without the local database folders.** Type-check, lint and Prettier are clean (the only warning is the existing `reference-golden.json`). `VERCEL=1 npm run build` and `check:bundle` clean (0 problems in browser and server bundles).

## 8. Remaining issues and decisions before D4

1. **Query in the Search page URL** (section 5): keep (Back and reload work, pre-existing) or move the text out of the URL (needs a small, approved change to the screen).
2. **Abort-to-database**: aborting the HTTP call to PostgREST should cancel the query; unverified on Supabase. Backstop: our 2 s limit and the role's 8 s default.
3. **Function-level timeout**: if you want a database-enforced limit, test the Supabase doc's claim on the dev project before relying on it.
4. **Typo repair UX**: shows "Showing results for X" but offers no "search instead for the original"; needs a parameter on `search_bible`.
5. **Rate-limit numbers** unchanged from the approved defaults; confirm for launch.
6. **Psalm superscriptions and BSB headings** remain unsearchable; **KJAV** pending.
7. The Smart Search button stays hidden while `VITE_SMART_SEARCH_OFFERED` is unset.

## 9. Proposed Supabase deployment steps (none performed; each needs your approval)

1. Take a `supabase db dump` of the dev project (`shoztcflucpnfenohgcr`). Confirm the project is not the old Lovable one.
2. Run `08a_bible_search_preflight.sql` (read-only). Fix anything false: fuzzystrmatch available and not in another schema, roles present, log settings, size headroom. Check on the project: `select * from pg_available_extensions where name='fuzzystrmatch'`, the Postgres major version (15+), `service_role`'s privileges on the `extensions` schema, and that `supabase/migrations` history matches (the journal migration `20261022…` is still pending separately).
3. `supabase db push --dry-run`, review exactly two files (`20261023000000`, `20261023000100`), then apply them.
4. Run `08_bible_search_checks.sql` (must end with OVERALL true).
5. Import, one edition at a time, from the manifest-verified SQL: verify checksums (`verifyOutputFiles`), run `_00_check`, the chunks (stop at the first error), `_90_verify`, then `_99_promote` only when verified. Pre-promotion the editions stay invisible to search.
6. Re-run `08`, then set `FREE_SEARCH_ENABLED=true` for the Preview environment only (needs `SUPABASE_SERVICE_ROLE_KEY` and `RATE_LIMIT_SALT` already set); test a phrase, a typo, paging, a refused request, and one timeout on a Preview deployment before anything else.
7. Roll back instantly with `FREE_SEARCH_ENABLED=false` (or `status='retired'`); full rollback scripts are in `supabase/rollbacks`.
