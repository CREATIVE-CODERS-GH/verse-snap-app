# Free Bible Search — Preview deployment checklist

*Independent project `shoztcflucpnfenohgcr` only. Never the old Lovable project `pnugxqkdelknprbhejur`. **Nothing here has been run against Supabase.** Every step that changes the project needs your explicit approval at the time. Prepared 2026-10-21 (D4).*

## What the SQL does (inspected, and enforced by tests)

The two migrations are additive. A static test (`free-search-sql-safety.test.ts`) fails if either file gains a `drop`, `truncate`, an `update` of existing rows, an `alter` of anything but the four new tables, a grant to `anon`/`authenticated`/`public`, or any reference to user-data tables or `auth`.

| Statement | Where | Effect |
|---|---|---|
| `create schema if not exists extensions` | index | No-op on Supabase (it exists) |
| `create extension if not exists fuzzystrmatch with schema extensions` | index | Adds the extension's functions to `extensions` (public-readable by default per Supabase docs); refuses to continue if it already exists in another schema |
| `create table` ×4 | both | `bible_sources`, `bible_verses`, `bible_words`, `free_search_usage` (all new, RLS on, no policies) |
| `create index` ×2 | both | GIN index on `bible_verses.tsv`; window index on `free_search_usage` |
| `alter table … enable row level security` ×4 | both | New tables only |
| `revoke` / `grant` | both | New objects only; everything revoked from `public`, `anon`, `authenticated`; only `service_role` granted |
| `create or replace function` ×3 | both | `search_bible`, `refresh_bible_words`, `consume_free_search_quota` (the only `security definer`; empty `search_path`; database-side `statement_timeout`) |
| `insert into bible_sources` ×6 rows | index | Metadata and licence notices, `on conflict do nothing`; **no Bible text**; WEB/BSB/ASV approved, KJAV pending, BBE/FBV excluded |
| `delete from` | functions only | `refresh_bible_words` (its own vocabulary table) and housekeeping of old counter rows |

Unintended side effects found: none. Expect a brief PostgREST schema-cache reload after the DDL.

## Gates that must be cleared first

| Gate | Why | Status |
|---|---|---|
| **B1 pending journal migration** | `supabase db push` applies **every** unapplied local migration in order. `20261022000000_reflection_journal.sql` (Batch 1C, not approved) sorts before the search files and would be applied too. | **Open.** Either approve and apply Batch 1C first, or apply the two search files alone (SQL editor or `supabase db query --linked -f`) and then run `supabase migration repair --status applied 20261023000000 20261023000100`; later pushes then need `--include-all`. The dry run must list exactly the files you intend. |
| **B2 Supabase CLI** | Not installed on this machine, so the dump, dry run and `db query` are unrehearsed. | Open. Install (`npx supabase` works) and run `supabase --version`, `supabase login`, `supabase link --project-ref shoztcflucpnfenohgcr`; confirm the linked ref before anything else. |
| **B3 real-service behaviour** | The database-side time limit works through PostgREST locally (v16.5, PostgreSQL 17.10) because PostgREST applies function settings per request. Unverified on the project's PostgREST, on the Supabase gateway, and for the Vercel runtime's handling of a closed request. | Open: verify as in step 11. |
| **B4 query in the page URL** | `/search?q=…` is logged by hosting when loaded directly. | Decision needed; not a deployment blocker for a private Preview if accepted. |
| **B5 backup** | Plan entitlement for backups/PITR unknown; no `pg_dump` here to rehearse a restore. | Open: confirm in the dashboard; rehearse a restore on a Supabase branch if available. |
| **B6 shared ceiling** | `FREE_LIMIT_GLOBAL_MINUTE` refuses everyone when exhausted. | Set low for Preview (60/min) and keep the guest limit low (10/min). |

## Steps (stop at the first failure)

1. **Environment verification (read-only).** `node scripts/check-free-search-env.mjs` against the Preview values (for example `node --env-file=<preview env file outside the repo> scripts/check-free-search-env.mjs`). It must pass: project host is `shoztcflucpnfenohgcr.supabase.co`, not the old project; service-role key and salt present (24+ characters); no secret in a `VITE_` variable; AI off; Smart Search button off; free search not enabled on Production. It prints lengths and the host, never values. Do not edit `.env.local`.
2. **Backup.** `supabase db dump --linked -f backup/schema-2026-10-21.sql` and `--data-only -f backup/data-2026-10-21.sql` into a folder outside the repo; note the dashboard's backup list and PITR status (B5). Nothing in the migrations changes existing data, so the dump is for policy and for the restore test.
3. **Read-only pre-flight.** Run `supabase/verification/08a_bible_search_preflight.sql` (SQL editor). Every row must be true: PostgreSQL 15+, `fuzzystrmatch` available and not installed elsewhere, API roles exist, none of the new objects exist, the AI limiter exists, database size under 400 MB, and the three log-privacy settings (`log_statement` not `all`/`mod`, `log_min_duration_statement = -1`, `log_parameter_max_length_on_error = 0`). Also record by hand: the plan's database size limit (about 50 MB is needed), the Postgres version, and `select rolname, rolconfig from pg_roles where rolname in ('authenticator','service_role','anon','authenticated')` (documented defaults: `authenticator` 8 s).
4. **Dry run.** `supabase db push --dry-run` must list **exactly** `20261023000000_bible_search_index.sql` and `20261023000100_free_search_rate_limit.sql`. If it lists `20261022000000_reflection_journal.sql`, stop (B1).
5. **Apply the two migrations** (after approval). Re-run the PostgREST schema reload if the dashboard does not (`notify pgrst, 'reload schema'`).
6. **Privilege and structure checks.** Run `supabase/verification/08_bible_search_checks.sql`; the last row must be `OVERALL: all checks pass`. It verifies RLS on all four tables, no policies, no privileges for `anon`/`authenticated`, `service_role` only on the functions, an empty `search_path` everywhere, the GIN index, the native-key primary key, the licence-gate foreign key, the source records (WEB/BSB/ASV approved, KJAV pending, BBE/FBV excluded, pinned file hashes) and the log settings. Also run, as `service_role` through the API, one call with the anon key (must be 401) and one with a signed-in user's token (must be 403).
7. **Source checksum verification.** On a trusted machine, outside the repo: `node scripts/bible-import/prepare-bible-import.mjs --source-dir <dir> --out <dir> --download --check-reader all`. It must report the pinned SHA-256 for each file (WEB `afa177af…`, BSB `d02b81e7…`, ASV `125acd86…`), 0 hard problems and 0 reader-check problems. A different hash stops the import until reviewed (`--accept-new-hash` is deliberate). Compare the manifest with `docs/audit/bible-import-manifest.2026-10-21.json` (hash-only).
8. **Import one edition at a time** (ASV, then WEB, then BSB), each from the manifest-verified files (`verifyOutputFiles` first): `<ED>_00_check.sql`, then the chunks **in order, stopping at the first error** (each chunk is its own transaction and safe to re-run), then `<ED>_90_verify.sql` (counts must equal the manifest; it rebuilds the vocabulary, about 2.5 s, with no time limit of its own). The edition stays invisible to search until promoted. Load method: `supabase db query --linked -f <file>` per file or the SQL editor for chunks within its limits (each chunk is about 0.7 MB). Never put the generated SQL in git.
9. **Post-import verification.** After each edition: `08` again; row counts (WEB 31,098, BSB 31,086, ASV 31,086), no empty or duplicate rows, storage (`pg_total_relation_size` of the four tables; expect about 13 MB per edition). Promote with `<ED>_99_promote.sql` only after review.
10. **Preview-only enablement.** In Vercel, set for the **Preview** environment only: `FREE_SEARCH_ENABLED=true`, `FREE_LIMIT_GLOBAL_MINUTE=60`, `FREE_LIMIT_GUEST_MINUTE=10` (and confirm `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, `SUPABASE_URL` exist for Preview and name the right project). Production stays unset. Redeploy the Preview.
11. **Preview tests.** A phrase ("for God so loved the world": three editions, Reader links work); a keyword; a typo with "Search instead for …" and back; paging past 25; a refused request (exceed 10 in a minute: message, then recovery); Back and Reader navigation. **Time-limit gate (B3):** read `select proname, proconfig from pg_proc where proname in ('search_bible','consume_free_search_quota')` (must show `statement_timeout=2s` / `1s`); then, on the dev project only and with approval, confirm cancellation by calling the function through the API with its limit lowered in a transaction-safe way (or on a branch database), and check the Supabase logs show no query text and no parameters.
12. **Kill-switch verification (before others use it).** (a) Instant, database side: `update public.bible_sources set status = 'retired' where edition_code in ('WEB','BSB','ASV')`; within a minute (the editions cache) the screen shows "Free Bible search is being prepared" and Supabase receives no search calls; set back to `active` afterwards. (b) Environment side: set `FREE_SEARCH_ENABLED=false` and redeploy (a variable change does not reach a running deployment); the screen shows the same state and no database call is made. Note that (b) needs a redeploy, so (a) is the fast switch.

## Recovery and rollback (cheapest first)

1. Retire the sources (12a) or disable the flag and redeploy (12b): search stops, references and the Reader are unaffected.
2. Remove one edition: `delete from public.bible_verses where edition_code = 'WEB'; select public.refresh_bible_words();`
3. Remove the feature: `supabase/rollbacks/20261023000100_free_search_rate_limit.down.sql`, then `…000000_bible_search_index.down.sql` (tested with data present, twice, and with re-apply). They drop only the new tables and functions; the extension is left installed. If applied with the CLI: `supabase migration repair --status reverted <version>`.
4. Last resort: restore from the step 2 dump (rehearsal not possible locally, B5).

## Remaining items that are not blockers for a private Preview

KJAV approval (UK rights); Psalm superscriptions and BSB headings unsearchable; single-keyword ordering by length-normalised frequency; stemming conflation ("Comforter"); typo repair occasionally rewrites a modern word (always with the notice and the original-wording link); production latency over the network is unmeasured.
