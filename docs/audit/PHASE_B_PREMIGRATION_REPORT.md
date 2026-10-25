# Phase B — report before migration 7

*2026-10-19. Planning only; no migration written or applied, no dataset downloaded or imported (only small metadata files and a handful of Romans chapters were read), no Supabase data change, no OpenAI call, no commit/push/deploy. Lovable untouched. Decisions approved: server-only database access; HelloAO `ENGWEBP` as the WEB source with a pinned SHA-256; index WEB **and** KJAV for the trial.*

## 1. KJAV: exact edition and indexing permissions

**Edition.** Our code `KJAV` maps to HelloAO id **`eng_kjv`** (`src/lib/bible/translations.ts`): *King James Version*, HelloAO metadata points to eBible.org **`eng-kjv2006`** ("King James (Authorized) Version", abbreviation KJV, eBible id `ENGKJV`). Description on eBible: "the King James Version or Authorized Version of the Holy Bible, **using the standardized text of 1769, protocanon only, with Strong's numbers added**." 66 books, 1,189 chapters, **31,102 verses**, HelloAO file hash `a847712eeaae26124d3f9db80a1a9274742981261961b49715f43809774eb43c`. It is **not** `eng_kja` (KJV + Apocrypha) and not a different KJV revision.

**Permissions (read from eBible's pages today).** Licence field: **"Public Domain"**. Copyright page: "You may copy the King James Version of the Holy Bible freely." Source credit: "courtesy of the Crosswire Bible Society and eBible.org". Last updated 2026-09-26.

**The one caveat — UK Crown letters patent.** eBible states that printing this translation *in the United Kingdom* or importing printed copies into the UK needs permission from the Crown's patentees (Cambridge University Press, Oxford University Press, Collins); the decree "has no effect outside of the UK, where this work is firmly in the Public Domain." Our use is digital storage and display, not printing; but if Verse Snap targets UK users from a UK-resident operator, the patent holders' position on digital reproduction is a question I cannot settle. Recommendation: (1) keep a credits line citing eBible/Crosswire and the patent note; (2) treat KJV indexing as low risk for a non-UK operator, flag it for your own judgement if you operate from or heavily target the UK; (3) the index stores verse text only for search; the reader already displays KJV the same way today. Not legal advice.

**Indexing specifics for both editions.** Indexing (lowercasing/stemming into a search vector) creates no new reproduction beyond storing the plain verse text, which both licences permit. Strong's numbers and footnote markers are excluded from the stored plain text. Rules carried over from WEB: do not alter wording, and never call modified text "World English Bible". HelloAO's own terms add no restrictions and allow storing/caching without expiry. **Gate:** the import's dry run records each edition's licence URL, notice text, SHA-256, size, ETag and date in `bible_sources` before any rows load.

## 2. Revised storage estimate (WEB + KJAV)

| Item | Estimate |
|---|---|
| Plain text, both editions | ≈ 8.5–9 MB |
| `bible_verses` heap (62,205 rows with stored tsvector) | ≈ 24–32 MB |
| GIN on `tsv` (one index, both editions) | ≈ 7–11 MB |
| `bible_words` + trigram GIN (union vocabulary, KJV adds archaic forms) | ≈ 3–5 MB |
| Map table, sources table | < 0.1 MB |
| **Total** | **≈ 35–50 MB**; plan for **≈ 60 MB** including bloat and temporary import overhead |

That is roughly 7–12% of a 500 MB database (please confirm the plan's limit). Adding BSB and ASV later would bring it to about 70–100 MB, consistent with the earlier four-edition estimate. These are estimates; the spike reports `pg_total_relation_size` for each object.

## 3. Romans verse mapping (detailed)

**Verified facts (read directly from HelloAO chapters today).** Of 66 books only Romans has different verse totals: WEB 434, KJAV 433.

| Reference | WEB (`ENGWEBP`) | KJAV (`eng_kjv`) |
|---|---|---|
| Rom 14:23 | "…whatever is not of faith is sin." | same verse, ends the chapter |
| Rom 14:24 | "Now to him who is able to establish you…" | — (chapter ends at 23) |
| Rom 14:25 | "but now is revealed, and by the Scriptures of the prophets…" | — |
| Rom 14:26 | "to the only wise God, through Jesus Christ… Amen." | — |
| Rom 16:24 | "The grace of our Lord Jesus Christ be with you all! Amen." | same verse |
| Rom 16:25 | **empty text** (verse number exists, no words) | "Now to him that is of power to stablish you…" |
| Rom 16:26–27 | do not exist | "But now is made manifest…", "To God only wise…" |

So the closing doxology sits at WEB 14:24–26 and KJAV 16:25–27, and WEB keeps an **empty** 16:25. The counts reconcile: +3 (WEB 14:24–26) −2 (WEB lacks 16:26–27) = +1.

**Strategy.**
1. **Canonical key** = (USFM book, chapter, verse) as each edition numbers it. The index stores each edition under its *own* numbering, so a hit never needs rewriting at query time inside one edition.
2. **Display key** = KJAV numbering. `bible_verse_map(edition_code, book, chapter, verse → display_chapter, display_verse)` holds **only exceptions**. Seed rows for WEB: Rom 14:24→16:25, 14:25→16:26, 14:26→16:27. Any key with no map row maps to itself.
3. **Result assembly:** each hit (from any edition) is translated to its display key, results are de-duplicated by display key (a verse found in both WEB and KJAV becomes one card, ranked higher for matching in both), then the server fetches the KJAV text for that key and the link opens `/verse/KJAV/romans/{chapter}/{verse}`. A WEB hit on Rom 14:25 therefore opens KJAV Rom 16:26, never a missing verse.
4. **Empty verses:** the importer skips empty-text verses (WEB Rom 16:25) and records them in the manifest; nothing is indexed for them. The dry run lists *every* empty verse in both editions, which are expected to match known textual omissions (e.g. WEB Matt 17:21-style gaps), and fails if the counts disagree with `books.json`.
5. **Import gate:** a chapter-by-chapter comparison of the verse numbers present in WEB vs KJAV for all 1,189 chapters. Any difference not covered by a `bible_verse_map` row (or a recorded empty verse) stops the import. Identical *totals* can hide offsetting differences, so the per-chapter check is mandatory, not optional.
6. **Reverse case (a KJAV-only verse with no WEB equivalent)** needs no mapping: it is searched only in KJAV and displayed as itself.
7. **Fallback:** if a display key still has no KJAV verse at fetch time (provider glitch), the server drops that card and logs a count; it never links to a missing page.
8. **Tests:** unit tests for the three Romans rows, an empty-verse test, a "no unmapped difference" test over the fixture, and a golden check that opening each mapped result resolves to real KJAV text.

## 4. Server search endpoint: validation, rate limits, result limits

A TanStack server function `searchBibleFree` (shell in `*.functions.ts`, logic in a `*.server.ts` module loaded by dynamic import, same pattern as `searchScripture`). No browser code touches the tables (RLS on, no policies, privileges revoked from `anon`/`authenticated`, only `service_role` and `search_bible` EXECUTE).

| Concern | Rule |
|---|---|
| Input validation | Zod schema, strict: `query` string, trimmed, whitespace-collapsed, **2–200 characters** (same limit as AI search), control characters stripped; optional `editions` from an allow-list (`WEB`,`KJAV`) defaulting to all indexed; optional `limit` clamped to 1–10 (default 8). Unknown keys rejected. The router's rules (refine/nonsense) run first, so garbage never reaches the database. |
| Injection | The query is bound as a parameter into `websearch_to_tsquery`/`phraseto_tsquery`, never concatenated; `websearch_to_tsquery` does not throw on stray operators. The function runs `SECURITY INVOKER` with `search_path = ''`. |
| Result limits | Database returns ≤ 25 candidate keys; server returns ≤ 10 cards after de-duplication; each text clipped to 4,000 characters (same as the saved-result validator). |
| Time limits | `statement_timeout` 2 s on the call; a 5 s overall server budget; timeout → `failed: true` with a friendly message, no AI fallback. |
| Rate limit | Same identity as AI search (verified user, else keyed hash of the trusted client IP — never `cf-connecting-ip`). Separate bucket with its own durable counters (stored as counts only, no query text): suggested **30/min and 600/day per subject**; no global monthly cap (it is free), but a global per-minute ceiling (e.g. 300) protects the database. Over limit → `429`-style response, friendly message. **Fail-closed** if the counter is unreadable. Counted *before* the search runs. |
| Privacy | Query text is never logged or stored. Logs carry route, edition list, result count, duration, outcome. |
| Kill switch / readiness | `FREE_SEARCH_ENABLED` (default false) **and** an `active` row in `bible_sources`; otherwise the response is `freeStatus: "preparing"` and the UI shows "Free Bible search is being prepared." |
| AI separation | The function never calls the AI provider or the AI quota. "No results" returns `canTryAi: true` only; AI runs solely from the explicit "Try Smart Search" button. |
| Response | Existing `ScriptureSearchResponse` (`source: "free"`, `route`, `canTryAi`, `aiStatus` untouched) so saved verses, history and the results list keep working. |

## 5. Migration and import sequence, with rollback

**Order** (each step needs your go-ahead):
1. **Snapshot:** `supabase db dump` of the dev project (schema + data) to a local, git-ignored file. Confirm the plan's storage headroom.
2. **Migration 7** (`…_bible_search_index.sql`): `pg_trgm` extension; `bible_sources`, `bible_verses` (stored tsvector + GIN + btree), `bible_words`, `bible_verse_map`; RLS on; revoke from `public, anon, authenticated`; grants to `service_role`; `search_bible` function and an owner-only `refresh_bible_words()`. Additive only. Applied with the CLI as before, then **verification script 05** (structure, privileges: anon/authenticated cannot select; RLS enabled; function search_path set).
3. **Dry run (no database writes):** `scripts/prepare-bible-import.mjs` downloads `ENGWEBP` and `eng_kjv` `complete.json` (the approved first dataset downloads), checks size/ETag/SHA-256 against the pinned values, verse totals (WEB 31,103 incl. 1 empty; KJAV 31,102), per-book counts vs `books.json`, spot-check verses, empty-verse list, and the per-chapter WEB↔KJAV diff. Emits chunk SQL files plus a manifest of their hashes. **You review the report before anything loads.**
4. **Load to staging:** chunks applied with `supabase db query --linked -f …` (no service key in any script); rows tagged `status='staging'`.
5. **Verification script 06:** row counts per edition, no empty/null text, hash match, known verses identical, map rows present, `ANALYZE`, size report, 40-query plus Romans test timings.
6. **Promote:** `UPDATE bible_sources SET status='active'`; run `refresh_bible_words()`.
7. **Server function + flag** (B3), local `FREE_SEARCH_ENABLED=true` only after evaluation.

**Rollback (cheapest first):** (a) `FREE_SEARCH_ENABLED=false` or `status='retired'` — UI returns to "being prepared", references unaffected; (b) `DELETE FROM bible_verses WHERE edition_code = …` (and its `bible_sources` row) to remove one edition; (c) a documented `down` script that drops `search_bible`, `refresh_bible_words`, `bible_verse_map`, `bible_words`, `bible_verses`, `bible_sources` (and the extension only if nothing else uses it); (d) restore from the step-1 dump as a last resort. Nothing else depends on these objects, and `translations`/auth/user tables are never touched.

## 6. Open items before I write migration 7
1. Your judgement on the KJV UK-patent caveat (§1).
2. Confirm the free-search rate limits (30/min, 600/day per subject; global 300/min) or give other numbers.
3. Go-ahead for step 2 (write and apply migration 7 to the dev project) and then the dry run in step 3.
