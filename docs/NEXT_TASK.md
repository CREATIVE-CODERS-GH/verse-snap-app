# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
**Retire Lovable and make `main` the Production branch.** Approved plan (staged); the application on
`testing/vercel-mobile-preview` is authoritative and the old Lovable `main` (`c6caa12`) is never merged.
- **Stage A (done locally, awaiting owner review, not committed):** Lovable cleanup (`.lovable/`, Bun files,
  Lovable notes in AGENTS/README, error-reporting hook, `supabase/config.toml` project id), docs updated.
  `@lovable.dev/vite-tanstack-config` stays for now (replacing it is a separate task).
- **Backups:** local branch `archive/lovable-main` and tag `legacy/lovable-main-c6caa12` exist at `c6caa12` and are pushed to origin;
  `prod/pre-main-cutover-306bf67` waits until the live Production commit is confirmed.
- **Next:** owner reviews Stage A -> push backups -> commit/push cleanup -> branch from tip with
  `git merge -s ours origin/main` (tree must equal the tip) -> fast-forward `main` -> owner switches the GitHub
  default branch and the Vercel Production Branch to `main`, then protects `main`.

## Done and live
- Free Bible Search (WEB/ASV/BSB), Reflection Journal (1C), Reader improvements and Saved hubs (1D),
  cross-references (1E), offline Bible reading (1F: IndexedDB downloads + service worker, in Production,
  owner-tested). Details in `docs/PROJECT_STATUS.md`.

## Pending follow-ups
- Reflect screen (`reflect.$translation.$book.$chapter.$verse.tsx`): the invalid-reference state has no
  recovery action; "Search Manually" should be primary.
- Phase B remaining: router calibration + evaluation on the existing index (recommended first), then KJAV
  indexing (needs the UK rights decision), credits line, Romans verse map.

## After that
Phase B / KJAV / BBE / FBV items need separate approval (`docs/PROJECT_STATUS.md`).
