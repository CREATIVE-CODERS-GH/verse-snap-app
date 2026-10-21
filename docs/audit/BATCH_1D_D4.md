# Batch 1D — Stage D4 record (final quality assurance and deployment readiness)

*2026-10-21. Local testing, code refinement and read-only assessment. Nothing applied to Supabase, no Bible text in the repo or any live database, AI Smart Search off, no commit/push/deploy, `main` untouched. The migrations are still unapplied.*

## 1. Files

| New | Purpose |
|---|---|
| `scripts/eval/search-eval-set.json` | 90 evaluation queries, their expectations and recorded baselines |
| `src/lib/bible/free-search.eval.test.ts` | Runs the set on the real editions; `EVAL_WRITE=1` writes `docs/audit/search-eval-results.json` |
| `src/lib/bible/free-search.perf.test.ts` | Load and latency measurements; `BIBLE_PERF=1` writes `docs/audit/search-perf-results.json` |
| `src/test/pg-search-harness.ts` | Test-only: disposable database loaded with the approved editions, pooled store adapter |
| `src/lib/bible/free-search-sql-safety.test.ts` | Static review of the SQL (additive only, grants, time limits) and of the environment check |
| `scripts/check-free-search-env.mjs` | Read-only environment check; never prints a secret |
| `scripts/e2e/reader-spacing.mjs` | Six-edition Reader regression (48 checks) |
| `docs/audit/BATCH_1D_D4_DEPLOYMENT_CHECKLIST.md` | The Preview deployment checklist |

| Modified | Change |
|---|---|
| `supabase/migrations/20261023000000_bible_search_index.sql` (unapplied) | `p_repair` option; a single word per query is fine; fallback ranking by distinct words matched; edit-distance cap 2; at most 3 repairs per query (unknown words only); database-side `statement_timeout` |
| `…000100_free_search_rate_limit.sql` (unapplied) | database-side `statement_timeout = '1s'` |
| `supabase/rollbacks/…`, `verification/08_*`, new `08a_*` | follow the signature change; log-privacy checks |
| `src/lib/bible/search-router.ts`, `search-interaction.ts`, `search-view.ts`, `ai/types.ts` | **a one-word query is now a keyword search** (see 2) |
| `src/lib/bible/free-search*.ts`, `src/routes/search.tsx`, `src/components/search-results.tsx` | "Search instead for <original>", rate-limit/keyword/Back/reference checks |
| tests, `scripts/e2e/free-search.mjs` (99 checks), `scripts/db/*` | follow the above |

Batch 1C files, `package.json`, `voice.tsx`, `search-states.tsx` and the Reflect screen are untouched.

## 2. Search relevance evaluation

**Method (defined before the first run, stored in the set file).** 90 queries in 12 categories, each with expectations written from knowledge of the texts *before* it was run. A query passes when every stated expectation holds (verse in the first N, minimum or maximum total, only certain editions, a given correction, a route). `hit@10` = share of the 42 queries with an expected verse whose expected verse(s) are in the first 10. `MRR@25` = mean of 1/rank of the first expected verse in the first 25 (0 if absent). These say whether specific, known verses are found; they are **not a general relevance score**, and the set is small, author-chosen and not drawn from real users. Per-query records (route, total, correction, top results with tier and edition, rank, failures) are in `docs/audit/search-eval-results.json`.

**Result: 85 of 90 pass; hit@10 = 0.905 (38 of 42); MRR@25 = 0.728.** By category: exact phrases 17/17, multiple keywords 6/6, biblical names 7/7, modern wording 7/7, no matches 5/5, many matches 4/4, references 7/7, edition filter 2/2, single keywords 6/8, archaic wording 8/9, different translation wording 4/5, misspellings 12/13.

**What the first run found** (first run: 40 of 90 passed; hit@10 0.714):
1. **A real defect: the router refused every single-word query** ("grace", "Melchizedek", "Jehovah", even misspellings) with "Add a few more words". That minimum was written to control AI cost. Fixed: a single meaningful word is now a *keyword search* (free search only, never Smart Search); text with nothing to search ("the", "a") is still refused.
2. Weak fallback ranking ("water wine wedding" listed verses that repeat only "wine" first). Fixed: verses with more of the query's words rank first.
3. Over-correction of modern words ("zeppelin submarine" became "zeppelin subscribe"). Fixed: edit distance capped at 2.
4. **One wrong expectation of mine**, recorded as `revised` in the set: BSB John 3:16 reads "one and only Son", not "only begotten Son" (d02).

**The 5 queries that still fail, all documented as limitations in the set:**
- p13 "Do not be anxious about anything" is the NIV's wording; BSB reads "Be anxious for nothing". Different-translation wording is found only when an indexed edition uses it.
- k04 "manna" and k08 "hallelujah": a single keyword's matches are ordered by length-normalised frequency, not prominence; the famous verse (Exodus 16:31, Revelation 19:1) is among 48 and 36 matches but beyond the first 25 (it is rank 16 for "Melchizedek").
- a10 "Comforter": the English stemmer treats comfort/comforted/comforter as one word, so the exact archaic form is not preferred (267 matches across all editions; John 14:26 ASV is not in the first 10).
- t11 "tounge" becomes "lounge" (one edit) instead of "tongue" (two). Weighing frequency against distance was tried and was worse ("young", "offer"), so it was reverted.

**Edition coverage.** Older vocabulary is found only where the edition has it: "thou shalt not kill", "Comforter", "peradventure" and "Jehovah" return ASV only; "you shall not murder" returns WEB and BSB, not ASV. A query worded like an edition we do not index (KJV, NIV) relies on ASV/BSB/WEB wording. KJAV remains pending.

## 3. Typo correction

- **Option added** ("Showing results for shepherd. Search instead for sheperd"): the SQL takes `p_repair`; the server takes `repair: false`; the screen keeps the person's original text, searches it exactly as typed, says "Showing results for sheperd" and offers the corrected spelling back. The two choices are cached separately. Styling reuses existing text and link treatments.
- **Legitimate names and archaic terms are never replaced** when they occur in WEB, BSB or ASV (only words absent from all three are candidates). A name used only in another translation (for example a KJV-only spelling) can be repaired wrongly; the original-wording option is the fallback.
- **Tests**: SQL (repair off finds nothing for "sheperd"; on, three results; NULL means on), server module on real data, client, and the browser (corrected → original → corrected, repair flag observed).
- **Accuracy on the real vocabulary**: 12 of 13 misspellings in the evaluation, 18 of 20 in the earlier set. Modern words the Bible never uses are sometimes rewritten (3 of 6 tried: computer→compete, internet→interest, coffee→coffer), always with the notice and the fallback. Repairs are capped at 3 unknown words per query.

## 4. Cancellation and timeouts

Tested with a fake REST endpoint behind the real dev server, a real browser, and the **official PostgREST v16.5 build (SHA-256 checked against the published value) against a disposable PostgreSQL 17.10**. All local; nothing touched Supabase.

| Layer | Result |
|---|---|
| **Browser request cancellation** | Verified. The client forwards the abort signal to `fetch`; a superseded search shows `AbortError` and no result or error. |
| **Server function cancellation** | Verified **in the Vite/Nitro dev runtime**: aborting the browser request closed the server's outbound request after 371 ms (the abort came at 400 ms). The 2 s limit (here set to 5 s) closed it at 4,967 ms and the page showed "took too long". **Not verified on Vercel's runtime.** |
| **Supabase API request** | Our server's outbound request is aborted (above). What the Supabase gateway does with a closed connection is **not verifiable locally**. |
| **PostgreSQL statement** | **A caller hanging up does not cancel the running statement**: with PostgREST, a 6 s statement ran 5.7 s *after* the caller left. A **database-side limit does**: a role-level `statement_timeout` cancels at 1.1 s with 57014, and so does a **function-level `SET statement_timeout`** (1.02 s with an 8 s role limit also set). The latter works because **PostgREST applies the function's settings per request**; it does not work from a direct SQL session (tested), and PostgREST must have reloaded its schema cache after the setting was created or changed. The real `search_bible` was cancelled this way (500 / 57014 after 116 ms with a 1 ms limit). |

**What this means.** The browser and server abort do not stop database work; the **database-side limit is what bounds it**, so both functions now carry `set statement_timeout` (search 2 s, rate limit 1 s). This is a hard limit **through PostgREST on this build and version**. It is an outstanding deployment gate until confirmed on the Supabase project (see the checklist). The server's own 2 s limit only stops waiting; it does not by itself free the database. Measured worst-case statements are far below the limits (section 6).

## 5. Security and privacy assessment

| Area | Finding |
|---|---|
| Search terms in page URLs | **Remaining limitation, unchanged.** The Search screen's own URL carries the query (`/search?q=…`, used for Back and reload). It reaches browser history, any copied or shared link, and **Vercel's request log when the page is loaded or reloaded directly** (not for in-app searches). The search itself is a POST to `/_serverFn/<constant id>` with the query in the body (confirmed in a real browser). Decision needed (checklist, blockers). |
| Hosting access logs | Vercel logs paths and query strings of page requests: `/search?q=…` loads are logged with the text. `_serverFn` POSTs have no text in the URL. Bodies are not logged by default. |
| Application logs | A fixed shape: outcome, counts, duration, an error *code*; tested across seven outcomes. Unexpected failures log the error class and code only. No query, no address, no token. |
| Supabase query and error logs | Per Supabase's documentation the defaults are `log_min_duration_statement = -1` and `log_min_error_statement = error`: **statement text is logged on error; bound parameters (the query) are not, unless `log_parameter_max_length_on_error` is raised or `log_statement` is `all`/`mod`.** Verified only against documentation: `08a` and `08` check all three on the project. PostgREST sends the call as a request body, so the text is a parameter, not part of the statement text. |
| Rate-limit identity | Guests: HMAC-SHA256 (keyed by `RATE_LIMIT_SALT`) of the trusted client address, truncated to 128 bits; IPv6 reduced to /64; no raw address stored. Counters (no text) live in `free_search_usage` for up to three days: **pseudonymous data**. Rotating the salt resets all counts. The same salt is used by the AI limiter. |
| Server-only secrets | The service-role key exists only in `*.server.ts` and is loaded lazily; static tests, `check:bundle` (0 problems) and the environment check (which refuses secrets in `VITE_` variables, the old Lovable project, and Production) enforce it. |
| Function privileges and RLS | `anon` and `authenticated` get 401/403 (42501) through PostgREST on both functions and permission denied on every table; RLS alone hides rows if a grant were added by mistake. Only `service_role` is granted anything (static test). |
| Error redaction | The store reduces every database error to a kind and a code; messages are never read (static test on the source). |
| Request validation | Strict schema (unknown keys, editions outside WEB/BSB/ASV, offsets, limits, types), NFC, control characters, 2–200 characters; nothing reaches the database when it fails. |
| Abuse and concurrency | Exactly the allowance succeeds under 12 simultaneous requests; refused attempts count nowhere; an unreadable counter refuses. **Remaining:** (1) many source addresses defeat the per-person limit, and the shared ceiling (300/min) then refuses *everyone* — a denial of service by design; keep it low for Preview and add platform-level protection before launch. (2) The token is verified before the rate limit runs, so garbage bearer tokens cost an auth check per request (same design as the AI path). (3) Typo repair is the costliest query part: capped at 3 words, worst case measured 154 ms median, 258 ms p95. |

## 6. Performance (database only versus service path; neither includes network or hosting)

Real WEB, BSB and ASV (93,270 verses), PostgreSQL 17.10 embedded with default settings, one 12-thread Windows machine, 16 pooled connections. Raw numbers: `docs/audit/search-perf-results.json`.

**Database only, one at a time (ms):**

| Shape | p50 | p95 | max |
|---|---|---|---|
| Phrase | 13 | 17 | 20 |
| Several words | 15 | 52 | 68 |
| Single keyword | 7 | 10 | 15 |
| Very common word ("God": 11,900 matches, exact count) | 29 | 97 | 135 |
| Typo | 12 | 20 | 21 |
| Archaic | 22 | 30 | 32 |
| No match | 34 | 40 | 40 |

**Pagination:** "God" at offsets 0 to 1,000: p50 83–92 ms, p95 ≤ 174 ms (flat; the exact total is recounted per page). A 16-page walk of "grace": p50 9 ms.

**Concurrency, mixed shapes, 400 requests per level:**

| | DB only p50 / p95 / p99 / max (ms) | req/s | Service path p50 / p95 / p99 / max (ms) | req/s |
|---|---|---|---|---|
| 1 | 12 / 49 / 74 / 104 | 66 | 16 / 64 / 90 / 168 | 48 |
| 4 | 15 / 67 / 107 / 138 | 203 | 19 / 76 / 133 / 158 | 156 |
| 8 | 17 / 97 / 174 / 200 | 309 | 20 / 89 / 138 / 151 | 297 |
| 16 | 18 / 119 / 628 / 1,028 | 359 | 31 / 126 / 256 / 338 | 351 |

The service path adds validation, identity, the rate-limit write, mapping and (in this adapter) a five-statement transaction; zero failures at every level. The rate-limit write alone: 2 ms (p50) at 1 in flight, 8 ms at 16 in flight (one shared row is updated by every request; no problem at this scale). Abusive shapes: 200-character real words 73 ms, 24 unknown words 154 ms, deepest page 84 ms. **Resource use:** PostgreSQL used about 20 ms of CPU per request on average (8 CPU-seconds per 400 requests at concurrency 16); node stayed under 100 MB. (Windows working-set memory counts shared buffers per process and overstates; not reported.) **Framework baseline:** the server-function round trip from the browser to the Vite dev server with search disabled was 9 ms (p50) and 19 ms (p95); a production build and the Vercel→Supabase hop were not measured.

## 7. Mobile and Reader regression

- **Search screen, 360/390/430 px: 99/99.** Keyword and phrase results, edition labels and links, verse navigation, corrected and original wording, empty, error, rate-limit message with retry, "preparing", paging with a real next-page request and next-page retry, retrieval limit, cancellation, **Back** (results return from memory with no new request), reference search (John 3:16 opens the verse), and the real server function. No overflow, no console errors.
- **Reader, all six editions (KJAV, BSB, WEB, ASV, BBE, FBV): 48/48.** Five pages per edition (verse and chapter) load with no words or punctuation run together; Psalm 23 has no overflow at three widths for every edition.
- **Whole-text check of all six editions (186,000 verses): only whitespace changed, never a character; no space was introduced before punctuation** (repaired verses: WEB 7,695, BSB 9,421, ASV 5,059, KJAV 627, BBE 21, FBV 26). The KJAV/BBE/FBV files were downloaded only to check Reader text; they are not imported.
- Existing mobile smoke test 30/30.

## 8. Test totals

Type-check and lint clean on this stage's files, Prettier clean (apart from the existing `reference-golden.json`). **931 tests in 45 files: 925 pass with the database folders set (the 6 performance tests run only with `BIBLE_PERF=1`; they passed separately), 817 pass and 114 are skipped without them.** Database suites: schema 118/118, import 83/83. Production build and `check:bundle` clean. Eval 90/90 against recorded baselines.

## 9. Outstanding blockers and gates

See the checklist for the exact order. In short: **(B1)** `supabase db push` would also apply the pending journal migration (Batch 1C, unapproved), so the search files must be applied in isolation or 1C approved first; **(B2)** the Supabase CLI is not installed here, so the dry run and dump are unrehearsed; **(B3)** the database-side time limit and everything about the Supabase gateway and the Vercel runtime are unverified on the real services; **(B4)** decide on the query in the page URL; **(B5)** a backup entitlement and a restore rehearsal are unverified (no `pg_dump` locally); **(B6)** the shared rate-limit ceiling is a denial-of-service lever.

## 10. Recommendation

**GO for a controlled Preview deployment** on the independent project `shoztcflucpnfenohgcr`, **only after** B1, B2, B3 (read-only parts), B5 and the pre-flight are cleared in the order of the checklist, with `FREE_SEARCH_ENABLED=true` set **only in the Preview environment**, a low shared ceiling, and the kill switch verified before anyone else uses it. **NO-GO for Production** until B3 is confirmed on the real services, B4 is decided, and platform-level abuse protection is in place. The search quality is sound for a controlled trial (85/90, all failures understood), the code and SQL are additive and tested, and nothing in this stage changes data.
