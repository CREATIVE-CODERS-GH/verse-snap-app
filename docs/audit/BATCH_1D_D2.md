# Batch 1D — Stage D2 record (import pipeline and local dry run)

> **Note from D3:** the Reader text assembly described under "Reader finding" is now fixed (see [BATCH_1D_D3.md](BATCH_1D_D3.md)), and the statement that a function-level `statement_timeout` does not apply was re-tested on PostgreSQL 17.10 and holds locally; Supabase's docs say otherwise, so it is to be verified on the dev project.

*2026-10-21. Local only: the three approved editions were downloaded to a scratch folder outside the repo and loaded into a throwaway PostgreSQL 17 (UTF-8). Nothing was applied to Supabase, no Bible text is in the repo or any live database, no AI, no commit/push/deploy.*

## 1. Files

| New | Purpose |
|---|---|
| `scripts/bible-import/editions.json` | The six editions: licence status, HelloAO id, pinned SHA-256/size, expected counts. Only `approved` can be imported. |
| `scripts/bible-import/lib.mjs` | Parse, validate, SQL generation, manifest verification (pure; no network, no database, no credentials). |
| `scripts/bible-import/prepare-bible-import.mjs` | CLI: download, verify, parse, report, write SQL chunks + manifest; optional check against the Reader's own endpoint. Refuses to write inside the repo. |
| `scripts/db/bible-import-test.mjs` | 83 checks on real text in a disposable database. |
| `src/lib/bible/bible-import.test.ts` | 21 unit tests: identifier/route consistency, parsing, SQL escaping, refusals. |
| `docs/audit/bible-import-manifest.2026-10-21.json`, `…-report.2026-10-21.json` | Hashes, counts and findings only (no verse text). |

| Modified | Change |
|---|---|
| `supabase/migrations/20261023000000_bible_search_index.sql` (unapplied) | Pins the verified file hash and size, adds `publisher_sha256`, active needs a hash; offset > 1,000 returns nothing instead of repeating a page; typo repair rewritten (below); `fuzzystrmatch` replaces `pg_trgm`, trigram index removed. |
| `supabase/rollbacks/…bible_search_index.down.sql`, `supabase/verification/08_bible_search_checks.sql` | Follow the above. |
| `scripts/db/lib.mjs` | Optional `initdbFlags` (the Windows default cluster is WIN1252 and cannot store ASV's Hebrew letters; tests now use UTF-8). |
| `scripts/db/bible-search-migration-test.mjs` | Follows the above (113 checks pass). |
| `src/lib/bible/free-search-mock.ts` | Comment only (tier rule). |

Batch 1C files, `package.json`, `search-states.tsx` and the Reflect screen were not touched.

## 2. Source provenance

All three: `https://bible.helloao.org/api/<id>/complete.json`, downloaded twice about 5 minutes apart with identical hashes (and the WEB ETag equals the one recorded on 2026-10-19). The file's own `translation` block is checked for id, name and short name; a mismatch is refused, never substituted.

| Edition | Identifier / name in file | Bytes | SHA-256 of the downloaded file | ETag / Last-Modified |
|---|---|---|---|---|
| WEB | `ENGWEBP` / World English Bible | 6,293,463 | `afa177afbcf775b294bee9b13059090b548e4d996679cf53214bfaaea9e427fd` | `84c5657dc0247417cbff829c659f0cd1` / 12 Oct 2026 19:04 GMT |
| BSB | `BSB` / Berean Standard Bible | 8,155,925 | `d02b81e78441f5ae5dadec0688ad8596cde6793c28f52ab711d901a855698b6a` | `64c6d5ac308a93246c5d58a0aa0e35ac` / 12 Oct 2026 19:04 GMT |
| ASV | `eng_asv` / American Standard Version (1901) | 6,152,058 | `125acd86760f362fe5a8b47791057e546c26dcd0cde628f6017af146752cc69a` | `7106a17e0b7d20dde061302ca89e3d62` / 12 Oct 2026 19:44 GMT |

**Checksum finding (corrects D0/D1).** HelloAO's `available_translations.json` lists a `sha256` per edition (WEB `72b3e6d8…`, BSB `6cc5238e…`, ASV `154967f9…`). **None of them matches the hash of `complete.json`** (nor of `complete.simple.json`, nor of eBible's current USFM zip for WEB). They appear to describe HelloAO's own inputs, so they cannot verify a download. eBible and Berean publish no file checksum on the pages read. The pipeline therefore pins the actual verified file hash (reproduced on two downloads) and refuses a different file unless `--accept-new-hash` is given; the listed value is stored as `publisher_sha256`, informational. The D1 migration had seeded the listed values as if they were file hashes; that is corrected.

Licence notices and attribution (unchanged from D0, quoted in `bible_sources.license_notice`): WEB public domain (rename if the text is changed; trademark of eBible.org), BSB dedicated to the public domain 2023-04-30, ASV public domain. HelloAO's licence block lists `attribution: not-required` for all three. A credits line is still recommended. The import date is recorded in the manifest and sets `imported_at` when an edition is promoted.

## 3. Verse counts

| Edition | Verse blocks | Empty (skipped) | **Rows imported** | Chapters | Books |
|---|---|---|---|---|---|
| WEB | 31,103 | 5 | **31,098** | 1,189 | 66 |
| BSB | 31,086 | 0 | **31,086** | 1,189 | 66 |
| ASV | 31,102 | 16 | **31,086** | 1,189 | 66 |

Zero duplicate references, zero non-integer or out-of-order verse numbers, zero verses over 4,000 characters, zero count mismatches against the file's own chapter and book headers. The earlier note that WEB had one empty verse was wrong: it has five.

## 4. Structural discrepancies (nothing remapped)

- **Empty verses** (number present, no text; skipped and listed in the report): WEB Luke 17:36, Acts 8:37, 15:34, 24:7, Romans 16:25; ASV Matthew 17:21, 18:11, 23:14, Mark 7:16, 9:44, 9:46, 11:26, 15:28, Luke 17:36, 23:17, John 5:4, Acts 8:37, 15:34, 24:7, 28:29, Romans 16:24.
- **BSB omits 16 verse numbers** (gaps in 15 chapters): exactly the verses ASV keeps with empty text, so BSB's rows equal ASV's non-empty rows (31,086).
- **Chapter-level differences:** WEB vs ASV 2 chapters (Romans 14: WEB has 14:24–26; Romans 16: ASV/BSB have 16:25–27, WEB ends at 16:24 with an empty 16:25); WEB vs BSB 16; BSB vs ASV 15. Each edition keeps its own numbering, so a WEB hit on Romans 14:25 opens WEB Romans 14:25.
- **Not indexed because the source does not make them verses:** Psalm superscriptions (`hebrew_subtitle`: WEB 117, BSB 116, ASV 116) and BSB section headings (3,091). Text found only there is not searchable, and the Reader does not show it as a verse either.
- **Characters:** only typographic quotes, dashes, `æ` and Hebrew acrostic letters beyond ASCII; no control characters, no zero-width characters, nothing non-NFC. Stored as in the source.
- **Reader finding (pre-existing, not changed):** the Reader joins the pieces of a verse with nothing between them, so words and punctuation run together in **7,705 WEB, 9,497 BSB and 5,059 ASV verses** (confirmed in the running app: BSB Genesis 1:5 shows `night.”And there was evening`). The import separates pieces with a space. Fixing `readableText` in `helloao-provider.ts` is a one-line change for you to approve.

## 5. Local import and database results

83 checks on real text, plus 113 on the schema, all passing:

- Pipeline refuses KJAV/BBE/FBV/unknown editions and a wrong-edition file; refuses a changed file (hash); detects a SQL file edited after generation; embeds no credentials and has no database client.
- Source record in the database equals `editions.json` and the manifest (id, status, hash, size, verse blocks) for all six editions.
- A real chunk relabelled KJAV/BBE/FBV/NIV is rejected by the database; the check step refuses a wrong hash and an unapproved edition.
- Failure and recovery (ASV): 5 chunks load, chunk 6 fails (duplicate verse) and leaves nothing; the partial edition is invisible to search, the verify step and promote step both refuse it; restarting from chunk 1 completes; re-running is idempotent; a tampered verse is repaired by re-running; a clean import gives byte-identical rows.
- Counts per edition equal the manifest; native numbering confirmed (WEB Romans 14:24–26, BSB/ASV 16:25–27); not searchable until promoted; KJAV/BBE/FBV have no rows and are not searchable.
- Migration atomicity: a migration that fails half-way applies nothing; the `fuzzystrmatch` guard stops it cleanly; it applies after the guard is satisfied.
- **Every one of the 93,270 rows was compared with the Reader's own chapter endpoint (3,567 chapters): 0 problems.** Every imported verse exists in the Reader, and the Reader has no verse that was not imported.

**Real wording** (top results; all assertions pass): "for God so loved the world" John 3:16 in all three editions as a phrase; "Jesus wept"; "In the beginning God created"; "be still and know that I am God" Psalm 46:10; "love is patient" 1 Cor 13:4 (WEB/BSB) and the older "love suffereth long" (ASV only); "thou shalt not kill" only in ASV (Exodus 20:13, Matthew 19:18…); "Abraham begat Isaac" ASV Matthew 1:2; "whosoever believeth on him" ASV; "peace which passeth all understanding" ASV Philippians 4:7; "only begotten Son" ASV/BSB, not WEB; curly and straight apostrophes and quotes behave the same. Known limits: a verse is found by the wording of the edition that has it, so a query worded like another translation ("Do not be anxious about anything", the NIV's Philippians 4:6) falls back to some-words matches, while BSB's own "Be anxious for nothing" finds it as a phrase; and stop words act as wildcards inside phrases ("I can do all things through Christ" also returns Ephesians 1:10).

**Typo repair, measured on the real vocabulary (17,921 words).** The D1 trigram method was poor: it turned "sheperd" into "sherd" and got about half of 24 test typos right. Replaced by: a vocabulary word one adjacent-letter swap away, else the nearest word within 1/2/3 edits (5 / 6–8 / 9+ letters), nearest then commonest; words under 5 letters are not touched; at most 8 words per query. Result: **18 of 20 realistic misspellings repaired correctly** (missed "transfiguraton", whose true form is not in these texts, and "tounge"→"lounge"). Modern words the Bible never uses are sometimes rewritten (6 of 13 tried: computer→compete, internet→interest, coffee→coffer…), harmless for recall but the screen must show "Showing results for …" and offer the original.

## 6. Measurements (three real editions, 93,270 rows)

| Storage | |
|---|---|
| Table heap / GIN full-text / primary key | 29.9 / 3.8 / 2.8 MB |
| Vocabulary (17,921 words) | 1.2 MB |
| **Total** | **37.8 MB** (about 12.6 MB per edition); raw text 11.4 MB |
| Before `VACUUM FULL` (dead rows from the recovery tests) | 59.1 MB |

Plan on about 50 MB with KJAV. Earlier synthetic estimate (44.7 MB) was close.

| Search latency (database round trip, first page of 10; median / worst of 12) | |
|---|---|
| 7-word phrase / phrase with names / three words | 9 / 12 / 9 ms, worst 14 ms |
| Rare word / common word "love" | 6 / 10 ms |
| Very common word "God" (11,900 matches, exact count) | 68 ms, worst 73 ms |
| Some-words fallback | 49 ms, worst 64 ms |
| Typo repaired / typo in a phrase | 11 / 13 ms |
| 24 unknown words (worst typo case) | 102 ms, worst 109 ms |
| Deepest page (offset 1000) of "God" | 80 ms, worst 92 ms |
| One edition only ("God", WEB) | 23 ms |
| Import time per edition / vocabulary rebuild | about 2.1–2.4 s / 2.5 s |

No network, no hydration, local machine: add Vercel↔Supabase round trip in production.

## 7. How D1's pagination API relates to D0's "Show more verses"

- D0 asks the provider **once** for up to 25 results (`FREE_SEARCH_LIMIT`) and reveals them **10 at a time locally**. D1 returns pages of up to 25 with exact `total_count` and an offset up to 1,000.
- **Gap:** D0 has no `offset`, ignores `total`, and stops at 25. For "grace" (395 matches) or "God" (11,900) the user sees 25, the button disappears, and nothing says more exist. Not wrong, but not what the API can do.
- **Plan for D3:** add `offset` to `FreeSearchInput` and fetch the next page of 25 when the local reveal is exhausted and `shown < total`; show "Showing N of total"; stop at 1,025 reachable rows with "Refine your search to narrow the results" (offset > 1,000 now returns nothing, never a repeated page; verified on "God").
- Field mapping: `total` ← `total_count`; `searchedEditions` comes from the server's own query of active sources (the SQL does not return it); `corrected_query` has no D0 field yet; `verse_text` is the spaced search text (cleaner than the Reader's); `book` (USFM) → slug via `fromApiBookId`.
- **Identifiers:** DB `edition_code` equals the Reader code for all six (WEB, BSB, ASV, KJAV, BBE, FBV) and `helloao_id` equals the Reader's `apiId` (tested). The Reader also accepts the legacy alias `KJV`; the database does not, so the server must send canonical codes. USFM book ids map one-to-one to Reader slugs in the Reader's book order (tested); results link to `/verse/{edition}/{slug}/{chapter}/{verse}`.

## 8. SQL security review (actual D1 SQL, as amended)

| Area | Finding |
|---|---|
| SECURITY DEFINER | One function only: `consume_free_search_quota`. `search_path = ''`, all references schema-qualified or built in, no dynamic SQL, subject validated by regex, limits validated, writes only `free_search_usage`. It runs as the migration owner; on Supabase that is `postgres`, which owns the table and is exempt from RLS (no `FORCE`). **Unverified here:** the local owner is a superuser, Supabase's is not. |
| Invoker functions | `search_bible` and `refresh_bible_words` run as the caller (`service_role`), `search_path = ''`, operators schema-qualified (`extensions.levenshtein_less_equal`). |
| EXECUTE | Revoked from `public`, `anon`, `authenticated`; granted to `service_role`. Tested with Supabase's default `grant execute on functions` to the API roles simulated first: the revokes undo it (check 08 reads the ACLs). |
| RLS and grants | RLS on all four tables, no policies; all table privileges revoked from API roles; `service_role` full. RLS alone hides rows even if `SELECT` were granted by mistake (tested). Expect Supabase's advisor to show "RLS enabled, no policy" (informational, intended). |
| "Licence triggers" | There are none: the gate is a composite foreign key plus `check (license_status = 'approved')`, which also blocks un-approving or deleting a source that has verses. It cannot be bypassed by `service_role`; it can be changed by whoever sets `license_status` on a source (service key or `postgres`), by design. Optional hardening: a trigger freezing `source_sha256` once verses exist. |
| Transactions | Each migration is one implicit transaction in the simple protocol (tested: half-way failure applies nothing). Assumes the Supabase CLI applies a file as one batch. Each import chunk is its own `begin … commit`; a loader must stop at the first error (`ON_ERROR_STOP`) and roll back. |
| Privacy | The function stores nothing. **Risk:** if a call errors or is cancelled, Postgres logs the statement parameters, i.e. the search text. The server must validate length before calling, call via POST (never GET, which puts the text in URLs), and avoid logging errors that include arguments. |
| Cost / abuse | Worst measured query 122 ms; a 200-character query repairs at most 8 words. The caller must still apply the 2-second limit (a function-level `statement_timeout` does not apply to the running call) and the rate limit. |
| Extensions | `fuzzystrmatch` in the `extensions` schema; the migration refuses to run if it is installed elsewhere. |
| Not verified | Supabase specifics (extension availability, owner role, plan size). `supabase db push --dry-run` and `08_bible_search_checks.sql` on the dev project cover them after approval. |

## 9. Risks and decisions before D3

1. **Approve the Reader fix** (join verse pieces with a space) or leave it; it affects 16–31% of verses in these editions and the search results will look cleaner than the Reader.
2. **Approve the D1 migration amendments** (pinned file hash + `publisher_sha256`, offset rule, `fuzzystrmatch`). Nothing has been applied; the amended files are what D3 would apply.
3. **Psalm superscriptions and BSB headings are not searchable.** Accept, or index them as separate rows (a schema decision).
4. **KJAV** stays pending (UK question). Without it, KJV-worded queries find ASV/BSB wording only; the older-vocabulary tests show ASV covers much of that.
5. **Typo-repair UX:** wording and an "original search" link for "Showing results for …".
6. **Pagination UX** as in section 7; confirm the 1,025-row cap.
7. **Loader for the live project:** `supabase db query --linked -f` per file with stop-on-error, checking the manifest first; needs your approval at D3/D4 and a pre-import `supabase db dump`. The generated SQL is about 15 MB per edition and must stay out of git.
8. Re-fetch cadence: HelloAO regenerates files; a different hash fails the import until reviewed.
