# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
Turn on **account saving for the Reflection Journal** (Batch 1C, committed, `ACCOUNT_JOURNAL_ENABLED = false`).
Each step needs explicit approval:

1. Isolated Supabase folder (`C:/vs-search-deploy`, linked to `shoztcflucpnfenohgcr`): add
   `20261022000000_reflection_journal.sql`, `supabase db push --dry-run --include-all` must list exactly
   that one file (it sorts before the applied `20261023…` search migrations).
2. Logical backup, then apply only that file; run `supabase/verification/07` and `01` (last row: all pass).
3. In a separate commit set `ACCOUNT_JOURNAL_ENABLED = true`; deploy to Preview; test with a signed-in
   account (save, edit, delete, reload, second account cannot see it, guest merge, Reader row at 320px).
4. Only then Production.

## Done and live
- Free Bible Search (WEB/ASV/BSB) is on Production, controlled only by `FREE_SEARCH_ENABLED`.
- "Verse not found" recovery actions and the Reader "Reflect" action (5 Reader actions).

## Pending follow-up: Reflect screen
`reflect.$translation.$book.$chapter.$verse.tsx` (invalid reference, `ErrorIllustration`) has no recovery
action. It is entered from the reader, so "Search Manually" should be primary there.

## After that
Pending items in `docs/PROJECT_STATUS.md` (Phase B needs separate approval).
