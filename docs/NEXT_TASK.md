# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
**Repository cleanup, then resume Phase B.** The Production cutover is complete: PR #2 merged
2026-10-25 (`a9f8908`), so `main` now holds the Verse Snap application (tree identical to the former
`testing/vercel-mobile-preview` tip `e76f824`) and keeps the old Lovable history as a parent.
- **Branch ownership:** `main` = Production and the GitHub default branch. `testing/vercel-mobile-preview` =
  development and Preview. Lovable is retired; its old `main` (`c6caa12`) lives only at `archive/lovable-main` and tag
  `legacy/lovable-main-c6caa12` and is never merged into the app.
- **Confirmed by the owner:** GitHub default branch is `main`; Vercel Production Branch is `main`; the first Production
  deployment from `main` succeeded and the app works in Production.
- **Pending:** `main` branch protection (not configured). After the docs PR merges, sync
  `testing/vercel-mobile-preview` with `main`.
- **Repository cleanup:** Phase 1 (unused assets/icons, ignore rules) and Phase 1B (unused shadcn `ui/` files and
  31 packages) are merged. Phase 2 (this branch, `chore/remove-lovable-vite-config`): `vite.config.ts` is now native
  Vite plugins and `@lovable.dev/vite-tanstack-config` is gone; Lovable independence is complete once it merges and
  the Vercel Preview build is confirmed.
- **Housekeeping:** `prod/pre-main-cutover-306bf67` backup tag was never created; skip unless wanted.

## YouVersion editions (NIV, AMP): merged to `main`
NIV and AMP behind `VITE_YOUVERSION_TRANSLATIONS` (off by default; set in Vercel Preview for the branch and in
Production). Design, limits and the open licence conditions: `docs/audit/YOUVERSION_YV1.md`. Preview plan:
`docs/audit/YOUVERSION_PREVIEW_CHECKLIST.md`. Publisher answers for the Open items are still pending.

## Discover Search: branch `feature/youversion-discover-search` (committed locally, not pushed)
A YouVersion-powered mode on the Search screen beside Verse Snap search, behind `VITE_YOUVERSION_DISCOVER`
(off by default). Design, verified endpoints, request volume, quota safeguards and blockers:
`docs/audit/YOUVERSION_DISCOVER.md`; Stitch spec: `docs/design/DISCOVER_SEARCH_STITCH_SPEC.md`. Repeatable
browser suite uses a local mock (`npm run test:e2e:youversion-discover`, no live traffic). **Blocker:** reader and
Discover share one YouVersion key and quota (`429`, `Retry-After: 300` seen in testing): a separate Preview key and
an agreed quota are needed before any Preview with real traffic or public use. Next: owner decision to push and
set the Preview-only variables (see the doc).

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
