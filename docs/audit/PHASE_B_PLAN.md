# Phase B — one-edition free-search trial: implementation plan

*2026-10-19. Planning only. Nothing implemented or applied: no migration, no import, no Bible download (only the small `available_translations.json`, two `books.json` files and 16 Romans chapters were read for verification), no UI/app-code change, no OpenAI call, no commit/push/deploy. Old Lovable project untouched.*

## 0. Approved interaction (for the implementation phase)
- Enter or the Search button → **free** search only. AI runs only after an explicit click on a separate **"Try Smart Search"** button. A free search with no results never triggers AI.
- `AI_SEARCH_ENABLED=false` stays during development.
- While the index is not installed, descriptive queries show **"Free Bible search is being prepared."** (not "Scripture search is not configured"). References keep working through HelloAO.
- Search is independent of the reader's translation; results display **KJAV** by default; translation switching inside the Bible Reading Session is unchanged.

## 1. Licensing and source integrity (task 1)

**Exact edition.** Our `WEB` is HelloAO id **`ENGWEBP`** = eBible.org "World English Bible", abbreviation **WEBP** (American English, 66-book Protestant canon, "2020 stable text edition"). It is *not* `eng_web` (WEB Classic), `eng_webu` (Updated, adds deuterocanon), `eng_webpb` (British) or `eng_webc` (Catholic). The code already uses `ENGWEBP` (`src/lib/bible/translations.ts`).

**Verified live today (2026-10-19) on ebible.org:**
- Details page for `engwebp`: licence field reads **"public domain"**; "a Public Domain translation of the Holy Bible into modern English … identical to the World English Bible Updated" minus the deuterocanon.
- `ebible.org/engwebp/copyright.htm`: *"The World English Bible is in the Public Domain. That means that it is not copyrighted."* You may *"copy, publish, proclaim, distribute, redistribute, sell, give away, quote … post on the Internet, print, reproduce … and use … as much as you want."* Dedicated to the public domain.
- **One condition:** "World English Bible" is a **trademark of eBible.org**. If the text is *changed*, it must not be called the World English Bible.

**Answer to "may we store and index it?"** Yes. Redistribution, storage in our database and building a search index are all within the stated permission. Conditions we will keep: (a) store and display the text unmodified in wording; (b) label it "World English Bible" only while it is unmodified; (c) never present re-ordered/stemmed/edited text under that name; (d) show a credits line "World English Bible, public domain, eBible.org". Stripping footnote markers, headings and poetry line breaks to produce plain verse text changes presentation, not wording; I judge that acceptable, and the stored column will be named/labelled "plain verse text" (the reader still shows HelloAO's formatted text for WEB). I am not a lawyer; this is an engineering reading of the publisher's own notice. The gate in `HYBRID_SEARCH_PHASE_A.md` still applies: record the notice and checksum before import.

**HelloAO as the delivery source.** AO Lab's docs state: no key, no usage limits, "Cache, store and download without expiry … AO Lab adds no restrictions; each text keeps its own notice"; code is MIT (GitHub `HelloAOLab/bible-api`). So bulk-fetching one `complete.json` for storage is permitted.

**Source integrity — recommendation.** Import from HelloAO `…/ENGWEBP/complete.json` (6,293,463 bytes; ETag `84c5657dc0247417cbff829c659f0cd1`; last modified 12 Oct 2026), because it is the *same data the reader shows for WEB*, so index and reader cannot disagree. Controls: pin the file's SHA-256 (HelloAO lists `72b3e6d83b3cd1c0a0e02a8b2254244d7568ca6c3235f52f93c71764590b8042` for `ENGWEBP`; the import script must reproduce or explain any difference before loading); expect 66 books / 1,189 chapters / **31,103 verses**; compare per-book verse totals with `books.json`; spot-check Gen 1:1, Ps 23:1, John 3:16, Rom 14:24–26, Rev 22:21; record URL, bytes, hash, ETag, import date in `bible_sources`. Upstream eBible regenerates files frequently (page says updated 2026-10-18), so the pin matters; re-imports are deliberate, never automatic.

## 2. Schema review — proposed migration 7 (task 2; not written yet)

Additive only; no existing table is altered. Naming mirrors migration 6.

```
bible_sources   (edition_code text PK, helloao_id text, name text, language text,
                 license_name text, license_url text, source_url text, source_sha256 text,
                 source_bytes int, verse_count int, status text check in
                 ('staging','active','retired'), imported_at timestamptz, notes text)

bible_verses    (edition_code text → bible_sources, book text (USFM id, e.g. 'JHN'),
                 book_order smallint, chapter smallint, verse smallint, text text,
                 tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text)) STORED,
                 PRIMARY KEY (edition_code, book, chapter, verse))
   indexes: GIN (tsv); btree (book_order, chapter, verse)

bible_words     (word text PK, doc_freq int)    -- from ts_stat over a 'simple' vector;
   GIN trigram index (pg_trgm) → typo correction + out-of-vocabulary signal for the router
   refreshed by an owner-only function after each import

bible_verse_map (edition_code, book, chapter, verse → display_book, display_chapter,
                 display_verse_from, display_verse_to)   -- exceptions only, see §4
```

**Multi-edition by design:** every row carries `edition_code`; one GIN index serves all editions (queries filter by edition or search across all and group by the verse key). Adding KJAV/BSB/ASV later is data only, no schema change.

**Search function** `search_bible(q text, editions text[], max_rows int)`: `LANGUAGE sql`, `STABLE`, `SECURITY INVOKER`, `SET search_path = ''`. Tiers in one call: (1) exact phrase via `phraseto_tsquery`, (2) all words via `websearch_to_tsquery`, (3) any-word / trigram-corrected terms. Rank `ts_rank_cd` plus tier weight; return `(book, chapter, verse, edition_code, rank, tier, headline)`; clamp `max_rows` ≤ 25 and the query to 200 chars; `SET LOCAL statement_timeout = '2s'` at the call. `websearch_to_tsquery` never throws on user syntax, and parameters are bound, so no SQL injection path.

**RLS and privileges (decision point).** Three options:
1. Public `select` policy so browsers query PostgREST directly — simple, but anyone can bulk-read/scrape the table and spend our Supabase egress; no rate control.
2. **Recommended:** RLS **enabled with no policies**, `REVOKE ALL … FROM public, anon, authenticated`, `GRANT … TO service_role`, and `EXECUTE` on `search_bible` to `service_role` only. Search runs only through our server function, which can rate-limit, cap and log counts. This is the same pattern as migration 6 and the `translations` lock-down in migration 5.
3. Public read of `bible_sources` only (credits screen) — optional; the app can read it via the server instead.

**Free-search rate limit:** reuse the HMAC-of-IP / user identity from the AI path with a separate, larger bucket (suggest 30/min, 600/day per subject; no global monthly cap needed). Implement as a second function `consume_free_search_quota` or a `bucket` parameter on the existing table in migration 8 — to be decided at implementation; migration 7 does not need it.

**Flag:** server env `FREE_SEARCH_ENABLED` plus a `bible_sources.status='active'` check. If either is false the UI shows "Free Bible search is being prepared."

## 3. Import process and rollback

**Process (repeatable, secret-free, reviewable):**
1. Script `scripts/prepare-bible-import.mjs` (local, read-only network): downloads `ENGWEBP/complete.json`, verifies size/hash/ETag/verse counts/spot checks, extracts plain verse text with the *same* text rules as `helloao-provider.readableText`, and writes `.sql` chunk files (≈ 3,000 verses each, ~10 files) plus a manifest with each file's SHA-256. Output stays outside git (generated artefacts), the manifest is committed.
2. Load: `supabase db query --linked -f chunk_N.sql` (same CLI route that applied migrations 1–6, so no service-role key is placed in a script). Rows go in with `bible_sources.status='staging'`.
3. Verification SQL (`supabase/verification/05_bible_index.sql`): 31,103 rows, 66 books, no null/empty text, per-book counts equal the manifest, known verse strings equal, `ANALYZE`, index sizes, 20 sample queries within time budget.
4. Promote: single `UPDATE bible_sources SET status='active'`. Refresh `bible_words`.
5. Flip `FREE_SEARCH_ENABLED=true` locally only after the evaluation passes.

**Rollback:** migration 7 is additive, so (a) fastest — set `FREE_SEARCH_ENABLED=false` or `status='retired'` (UI returns to "being prepared", references unaffected); (b) data — `DELETE FROM bible_verses WHERE edition_code='WEB'`; (c) full — a documented `DROP FUNCTION search_bible, DROP TABLE bible_verse_map, bible_words, bible_verses, bible_sources` script kept beside the migration (not auto-run). Nothing else depends on these objects. Take a `supabase db dump` snapshot before the import.

## 4. Mapping free results to KJAV display and opening the reader (task 4)

The index stores the **canonical verse key** (USFM book id, chapter, verse), identical to what HelloAO and `books.ts` (`fromApiBookId`) already use. WEB text is used only for *matching*; the user sees KJAV.

Flow per search: server `search_bible` returns up to ~10 keys → the server fetches those verses in **KJAV** through the existing `helloao-provider` (the same verify/hydrate step the AI path already uses, with chapter cache and in-flight sharing) → returns the existing `ScriptureSearchResponse` shape (`source:"free"`, `route`, `canTryAi`, `aiStatus`) so the results UI needs no redesign → each card links to `/verse/KJAV/{slug}/{chapter}/{verse}` (the route Phase A tests already exercise). Because the verse page takes the edition from the URL and the reader keeps its switcher, **translation switching inside the Bible Reading Session is unchanged**; the display edition for results becomes a search preference later, not the reader's selected edition.

**Versification differences found.** Comparing `books.json` for `ENGWEBP` vs `eng_kjv`: 65 of 66 books have identical verse totals; **Romans differs (WEB 434, KJAV 433)**. Chapter-level check: WEB Romans 14 has verses 24–26 (the closing doxology, placed there by the Majority-text tradition) and Romans 16 ends at verse 25, while KJAV has the doxology at **16:25–27** and Romans 14 ends at 23. So a WEB hit on Rom 14:24–26 must open KJAV **Rom 16:25–27**, and a WEB hit on Rom 16 end maps accordingly. This is why `bible_verse_map` exists: a handful of rows, built and checked during the import (the full-chapter comparison needs the downloaded data, so identical totals in other books could still hide offsetting differences — the import script will diff verse lists for all 1,189 chapters against KJAV and fail loudly on any unmapped difference). Fallback rule for any unmapped key: open the KJAV chapter and scroll to the nearest existing verse, never a 404.

## 5. Storage and performance (task 3) — estimates, to be measured in the spike

| Item | Estimate |
|---|---|
| Plain WEB text | ≈ 4.3 MB (the 6.3 MB JSON includes markup) |
| `bible_verses` heap (31,103 rows, ~140 B text + keys + stored tsvector ~100–150 B) | ≈ 12–16 MB |
| GIN on `tsv` | ≈ 3–6 MB |
| `bible_words` (~13–16k distinct words) + trigram GIN | ≈ 2–4 MB |
| **Total for one edition** | **≈ 20–30 MB** (research estimate for four editions: 85–110 MB) |

Assuming the free Supabase plan (500 MB database — please confirm in the dashboard), WEB uses ≈ 5%; four editions ≈ 20%.

**Performance:** a GIN lookup over ~31k short documents is single-digit milliseconds in the database; the cost that users feel is the round trip Vercel → Supabase (tens of ms same region) plus up to ten KJAV chapter fetches (cached after first use; the reader's Workbox cache helps). Targets for the spike: DB time p95 < 50 ms, server function p95 < 300 ms uncached, < 150 ms with chapters cached. Nothing is measured yet; the spike reports `pg_total_relation_size`, `EXPLAIN (ANALYZE, BUFFERS)` and timings.

## 6. Concerns (task 5), most important first

1. **Recall mismatch: KJV wording vs WEB index (product risk).** Users often quote KJV phrasing. `for God so loved the world, that he gave his only begotten Son` — WEB says "only born Son"; "charity suffereth long" vs "love is patient". A WEB-only index cannot bridge these and stemming will not help. Mitigation: run the trial with WEB as directed, but include KJV-worded queries in the evaluation to *measure* the gap, and plan KJAV as the immediate second edition (data only, ~+25 MB). Searching all indexed editions while displaying KJAV is the design that fixes this. Recommend deciding whether the trial should load KJAV as well; the schema supports it either way.
2. **Trademark wording.** Do not call modified/indexed derivatives "WEB". Credits screen and internal labels must say so (§1).
3. **Direct-table exposure.** Option 1 in §2 would let anyone scrape the table; use option 2.
4. **Free-search abuse and cost.** Cheap per request, but unbounded traffic still costs Supabase compute/egress; needs its own limit and a hard query cap (200 chars, ≤ 25 rows, 2 s timeout).
5. **Source drift.** eBible edits files frequently; pin hash, never auto-refresh, and re-import deliberately.
6. **Versification beyond Romans** is unverified until the chapter-level diff runs (§4). Treat as an import gate.
7. **Query privacy.** The free path must not log query text (counts and route only), same as the AI path. No shared result cache until the retention policy exists (deferred earlier).
8. **Operational.** Only the independent dev project `shoztcflucpnfenohgcr` exists; production will need the same migration + import run (hence a repeatable script). The old Lovable project is untouched. Dev server and CLI must be pointed at the dev project explicitly.
9. **Spec limits remain:** spoken ranges, comma lists, unsupported-edition notice (Phase A limitations) are unaffected.
10. **Router calibration:** `ROUTER_THRESHOLDS` are placeholders until real free-search signals exist; Phase B supplies `phraseHit`, `bestCoverage`, `resultCount`, `scoreGap`, `outOfVocabularyRate`.

## 7. Proposed implementation sequence (each step needs your go-ahead)

- **B0 — Interaction change (no database):** Enter/Search = free path; separate "Try Smart Search" button; "Free Bible search is being prepared" state; tests; browser re-verification. Can be done first and safely.
- **B1 — Migration 7** (dev project only) + verification SQL 05 + rollback script.
- **B2 — Import script**, dry run with no database writes (hash, counts, chapter diff vs KJAV, chunk files), review report; then load and verify.
- **B3 — Search server function** with the new rate limit, KJAV hydration, verse map, router signals.
- **B4 — Evaluation:** the 40-query set plus KJV-worded and misspelled queries; storage/latency report; go/no-go for adding KJAV/BSB/ASV (Phase C).

## 8. Decisions I need from you
1. RLS option 2 (server-only access) — approve?
2. Import source: HelloAO `ENGWEBP` (recommended, matches the reader) vs eBible's own VPL zip.
3. Trial scope: WEB only as stated, or WEB + KJAV together given concern 1?
4. OK to start with B0 (UI interaction, no database) before the migration work?
