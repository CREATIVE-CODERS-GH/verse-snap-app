# Batch 1D — Stage D1 record (database infrastructure, local only)

> **Amended in D2** (see [BATCH_1D_D2.md](BATCH_1D_D2.md)): source checksums now pin the verified file hash (HelloAO's listed values do not match the files); offsets above 1,000 return no rows; typo repair uses `fuzzystrmatch` (swap, then edit distance) instead of `pg_trgm`; the trigram index is gone (vocabulary now 1.2 MB). Figures below that mention trigrams or synthetic storage are superseded by the D2 measurements on real text.

*2026-10-21. Prepared and tested on a throwaway local PostgreSQL 17. Nothing applied to Supabase (`shoztcflucpnfenohgcr` or any other), no Bible text imported or stored, no AI, no commit/push/deploy.*

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/20261023000000_bible_search_index.sql` | Sources, verses, vocabulary, `search_bible()`, `refresh_bible_words()`, six source records (metadata only) |
| `supabase/migrations/20261023000100_free_search_rate_limit.sql` | Separate free-search rate limit |
| `supabase/rollbacks/…0000_bible_search_index.down.sql`, `…0100_free_search_rate_limit.down.sql` | Independent, never auto-applied |
| `supabase/verification/08_bible_search_checks.sql` | Read-only structure/security check for the dev project |
| `scripts/db/bible-search-migration-test.mjs` | 112 checks on a disposable Postgres |

Run: `DB_TEST_DEPS=<folder> node scripts/db/bible-search-migration-test.mjs` (setup in `scripts/db/lib.mjs`). `package.json` is not touched (Batch 1C owns its pending change); add a `test:db:bible-search` script when that is committed.

## Schema

- **`bible_sources`** (PK `edition_code`): `helloao_id`, `name`, `source_url`, `license_name`, `license_url`, `license_notice`, `license_status` (`approved|pending|excluded`), `license_checked_on`, `source_sha256`, `source_bytes`, `expected_verse_count`, `status` (`staging|active|retired`), `imported_at`, `notes`. Check: `active` requires `approved`. Seeds: WEB/BSB/ASV approved, KJAV pending, BBE/FBV excluded; checksums as published by HelloAO.
- **`bible_verses`** (PK `edition_code, book, chapter, verse` = the edition's own numbering): USFM `book`, `book_order`, `verse_text` (1–4,000 chars), stored `tsv` (`english` config), GIN index. `license_status` is fixed to `'approved'` and a composite foreign key to `bible_sources(edition_code, license_status)` makes an import for an unapproved or unknown edition impossible and blocks un-approving or deleting a source that has verses.
- **`bible_words`**: the vocabulary (`word`, `doc_freq`) with a trigram GIN index, rebuilt by `refresh_bible_words()` in one statement.
- **`free_search_usage`** (separate migration): counters per subject and window (minute, day, plus a `global` minute ceiling); no query text, no addresses.
- **No verse-map table.** Results open in the edition where the match was found, in that edition's numbering (D0 behaviour), so nothing needs mapping. WEB Romans 14:24–26 and BSB 16:25 simply exist as their own editions number them. Add a map only if cross-edition grouping is wanted later.

## Security model

RLS enabled on all four tables with no policies; every privilege revoked from `public`, `anon`, `authenticated`; `service_role` only (the server). Functions: `execute` revoked from API roles, granted to `service_role`; `search_bible` and `refresh_bible_words` are `security invoker`, `search_path = ''`; the quota function is `security definer` with the same pinned path. Query text is a function argument only; nothing stores or logs it. Verified as `anon` and `authenticated` (denied everywhere) and with a deliberate mistaken `SELECT` grant (RLS alone still shows zero rows).

## Search behaviour

Tier 3 phrase, tier 2 all words, tier 1 some words **only when no verse has all words**. Unknown words of 4+ letters are repaired to the closest vocabulary word (trigram similarity ≥ 0.45) and returned in `corrected_query`. Unknown, pending, excluded, retired and lower-case edition codes are ignored. Query 2–200 characters; limit clamped 1–25; offset 0–1,000. The D0 mock now follows the same tier rule.

## Pagination

`total_count` is the **exact** number of matching verses (not the page size) and is identical on every page. Ordering is total (tier, rank, Bible order, edition), so pages never repeat or skip a verse; tested with pages of 10 and 7 over 60 matches. The UI asks for the next page only while `shown < total_count`; an offset at or past the end returns no rows (the total is known from page one). Offset paging is acceptable because the offset is capped at 1,000; it costs 31 ms at offset 500.

## Local test results (112 passed, 0 failed)

Additive-only change (no existing object altered); apply, rollback (with data present), double rollback and re-apply; the public schema after rollback equals the one before; licence gate (KJAV, BBE, FBV, unknown editions rejected; cannot activate a non-approved source); constraints; duplicates; native numbering; edition isolation; phrase, keywords, fallback, stemming; typos; injection-shaped input; exact paging; server-only access and RLS; the rate limit (minute, day, global, no partial counting, 20-way concurrency = exactly the limit); cancellation by `statement_timeout`; verification 08 before and after.

## Measurements (synthetic corpus, not real Bible text)

Invented words, Zipf frequency, 3 editions × 31,086 verses = 93,258 rows, 9.4 MB of text.

| Measure | Result |
|---|---|
| Table heap / GIN / primary key / vocabulary + trigram | 31.0 / 8.0 / 2.8 / 2.8 MB |
| **Total, 3 editions** | **44.7 MB** (≈ 15 MB per edition) |
| Phrase | 8–10 ms |
| Two moderately common words (317 matches) | 7–10 ms |
| One common word (7,483 matches, exact count) | 36–42 ms |
| Some-words fallback over the same set | 75–85 ms |
| Typo repaired | 22–26 ms |
| Rare word | 6–8 ms |
| Deep page (offset 500) | 31 ms |
| One edition only | 15–17 ms |
| Vocabulary refresh (13,000 words) | 2.0 s |
| Load of 93,258 rows incl. index build | 4.6 s |

Timings are local, database round trip only (no network, no HelloAO hydration). The planner does a sequential scan of the 13,000-word vocabulary for typo lookups (about 15 ms per unknown word); the trigram index is usable (confirmed with scans disabled) and will matter if the vocabulary grows. **Real text will differ**: real verses average more characters than the synthetic ones and have a different word distribution, so treat the storage figure as ±40%, roughly 45–65 MB for three editions and 60–85 MB for four. Re-measure with the real files locally in D2 before any live load.

**Timeouts.** A function-level `SET statement_timeout` does not apply to the call that is already running, so the 2-second limit has to come from the caller: the server function wraps the call with an abort signal, and Supabase's own role timeouts apply. Cancellation by `statement_timeout` was verified (1 ms and 100 ms limits cancel; 5 s lets a normal search finish; the connection stays healthy). Worst measured query is 85 ms.

## Risks and open decisions

1. **Real-text behaviour is unmeasured** (storage, ranking, typo repair on archaic words). D2's local dry run against the real files answers this before any live import.
2. **KJAV stays `pending`.** Approving it is one `UPDATE` plus an import, after the UK decision.
3. **BSB numbering** differs from KJV (31,086 verses). Native numbering is kept, so reader navigation for BSB results must use BSB's own chapter/verse structure (already true of the reader).
4. **Typo repair can over-correct** a real English word the Bible never uses; the repaired text is returned so the screen can say "Showing results for …". UI wording is a D3 decision.
5. **Supabase specifics unverified**: that `pg_trgm` is not already installed outside `extensions` (the migration refuses to run if it is), the plan's storage limit, and that `service_role` keeps `usage` on `extensions`. The structure check 08 and `supabase db push --dry-run` cover this before applying.
6. **`src/integrations/supabase/types.ts` is not regenerated** (server-only tables; the server function can use untyped RPC or a hand-written type).
7. Offset paging is capped at 1,000; deeper results would need keyset paging (not needed with a 25-per-page, show-more UI).
8. Rate-limit numbers (30/min, 600/day per subject, global per-minute ceiling) are parameters of the function, set by the server; nothing is hard-coded in the database.
