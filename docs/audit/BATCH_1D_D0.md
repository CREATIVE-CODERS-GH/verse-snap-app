# Batch 1D — Stage D0 record

*2026-10-21. D0 only: UI/provider seam, tests, licensing check. No Bible text imported or stored, no Supabase change, no migration, no AI call, no commit/push/deploy.*

## Licensing record (checked today from each publisher's own page)

| Edition | HelloAO id | Source notice (URL) | Licence as stated | SHA-256 (HelloAO `available_translations.json`) | Verdict |
|---|---|---|---|---|---|
| WEB | `ENGWEBP` | https://ebible.org/engwebp/copyright.htm · https://ebible.org/Scriptures/details.php?id=engwebp | "The World English Bible is in the Public Domain." Copy, redistribute, post online, etc. Condition: if the text is changed, don't call it "World English Bible" (trademark of eBible.org). | `72b3e6d8…0b8042` (31,103 verses) | **Approved** to index. Unchanged from 2026-10-19. |
| KJAV | `eng_kjv` | https://ebible.org/Scriptures/details.php?id=eng-kjv2006 (updated 2026-09-26) | "public domain". Crown letters patent: printing in the UK / importing printed copies needs permission from Cambridge UP, Oxford UP, Collins; "no effect outside of the UK". | `a847712e…eb43c` (31,102) | **Approved outside the UK; UK decision open.** Patent text concerns *printing*; I found no source saying it covers digital storage or search (secondary sources only, no primary legal text, no statement from the patentees). Needs your decision or UK counsel. |
| BSB | `BSB` | https://berean.bible/terms.htm | "officially dedicated to the public domain as of April 30, 2023." "All uses are freely permitted." Attribution not required; if the text is *changed*, asked not to use the Berean name. | `6cc5238e…ebe37f` (31,086) | **Approved** to index. Verse count differs from KJAV, so the per-chapter diff gate is mandatory. |
| ASV | `eng_asv` | https://ebible.org/Scriptures/details.php?id=eng-asv (updated 2026-10-20) · copyright page `https://ebible.org/engasv/copyright.htm` returned 404 | "public domain"; no conditions beyond a donation request. | `154967f9…731839` (31,102) | **Approved** to index (publisher notice is the details page only; record that when importing). |
| BBE | `eng_bbe` | https://ebible.org/Scriptures/details.php?id=engBBE | Licence field "public domain", justified only by US publication without notice ("fell … into the Public Domain in the United States"). | `1e0aa1bf…aa7bf9` | **Stay unindexed.** The notice rests on US status only. My inference, unverified: the translator died in 1957, so UK/EU term may run to the end of 2027. |
| FBV | `eng_fbv` | https://ebible.org/Scriptures/details.php?id=engfbv | CC BY-SA 4.0, © 2018 Dr. Jonathan Gallagher. Needs copyright/source notice, change notes, share-alike on redistribution. | `b6a81b2c…bb5a6e` | **Stay unindexed.** Share-alike would need a decision on whether an index counts as redistribution. |

Full hashes for WEB/KJAV were also pinned in `PHASE_B_PLAN.md` / `PHASE_B_PREMIGRATION_REPORT.md`; re-read the full values from `available_translations.json` at import time, not from this table. Not legal advice.

## D0 code (what exists now)

- `src/lib/bible/free-search.ts`: provider contract (`FreeSearchProvider`), `preparingProvider` (default), error kinds, query options (in-memory cache only, no retry/refetch), unindexed-edition notice, paging and navigation helpers. `SMART_SEARCH_OFFERED` (build flag `VITE_SMART_SEARCH_OFFERED`, default off) hides the Smart Search button while AI is disabled.
- `src/lib/bible/free-search-mock.ts`: fixture-only provider that defines the matching contract (phrase > all words > some words; edition isolation).
- `src/components/search-results.tsx`: result rows (first page only + "Show more verses") and the unindexed note. `search.tsx` now uses the provider; AI path unchanged.
- Dev-only hook `globalThis.__verseSnapFreeSearch` (ignored in production builds) for `scripts/e2e/free-search.mjs`.

## Proposed migration architecture (nothing written or applied)

Based on `PHASE_B_PLAN.md`, changed as follows:

1. **Licence gate in the schema.** `bible_sources` gets `license_status` (`approved | pending | excluded`), `notice_url`, `notice_text`, `notice_checked_at`, `source_sha256`, `source_bytes`, `source_etag`. A trigger (or FK to a view of approved sources) rejects `bible_verses` rows unless the source is `approved`, so BBE/FBV cannot be loaded by accident.
2. **Editions in scope:** WEB, KJAV, BSB, ASV (KJAV pending the UK decision). One table, `edition_code` on every row, one GIN index; no per-edition schema.
3. **Verse map:** WEB↔KJAV Romans exception as planned; BSB (31,086 verses) and any ASV difference are found by the mandatory per-chapter diff and added as map rows or recorded empties. Import stops on any unexplained difference.
4. **Access:** RLS on, no policies, `service_role` only; search through a server function (30/min, 600/day per subject) as already approved in the Phase B report.
5. **Numbering:** `supabase/verification/07_*` is taken by the journal checks, so the index checks become `08_bible_index.sql` / `09_*`. The rate-limit change is its own migration after the index migration.
6. **Rollback:** additive-only; drop script in `supabase/rollbacks`, `status='retired'` or `FREE_SEARCH_ENABLED=false` as the first, instant step.
