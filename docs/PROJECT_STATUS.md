# Project status

*Updated 2026-10-25 (Batch 1F complete; `main` cutover merged). `main` is Production; development continues on `testing/vercel-mobile-preview`. Earlier phase
checklist: `roadmap.md` (historical).*

## Done
- **Screens (Stitch designs):** onboarding, Home, Voice, Camera scan, Search, Books, chapter reader (verse
  sheet, highlights, share, compare, verse card), single-verse reader, Saved (three hubs), History,
  Settings (+ text size, Voice & Audio rebuilt from Stitch 18), Reflection Journal, Cross References
  Explorer, loading/network-error states, light/dark theme, Vercel Analytics.
- **Batch 1A:** guest→account merge of Saved/History (consent, idempotent); chapter reading in History.
  Migration `20261020000000` applied (`ACCOUNT_HISTORY_V2 = true`).
- **Batch 1B:** persistent highlights, per translation, guest + account. Migration `20261021000000`
  applied (`ACCOUNT_HIGHLIGHTS_ENABLED = true`).
- **Free Bible Search:** WEB, BSB, ASV keyword/phrase search (KJAV pending, BBE/FBV excluded). Migrations
  `20261023000000` and `20261023000100` applied; editions imported (31,098 / 31,086 / 31,086 verses).
  Controlled only by `FREE_SEARCH_ENABLED`; rate-limited; AI Smart Search stays off.
- **Batch 1C — Reflection Journal:** notebooks and reflections for guests (device) and accounts (RLS).
  Migration `20261022000000` applied and verified (07 and 01 pass); `ACCOUNT_JOURNAL_ENABLED = true`.
  Live on Production (deployed by the owner). The note card holds only the note; no posture, title field
  or word count (existing titles and postures are kept when a note is saved).
- **Batch 1D — Reader improvements:** multi-verse highlighting (long press / Ctrl-click, existing
  highlight storage), saved-reflection note icons at the end of a verse with a dialog, Reflect action in
  the single-verse reader, Saved rebuilt as Verses / Notes / Highlights hubs (Stitch 31/33/34), the
  reflection verse card follows the Text Size settings. Deployed to Production by the owner.
- **Batch 1E — Scripture cross-references (complete; confirmed working on Production by the owner):** real data from
  HelloAO `open-cross-ref` (OpenBible.info, CC BY 4.0) fetched per chapter and cached; Explorer in Old /
  New Testament groups; chapter verse sheet chips and "Explore all (N)"; "Related passages (N)" link and
  reusable sheet in the single-verse reader; credit in the Explorer, the sheet and Settings → About. No
  database change. The two sample-data files are gone.
- Tests: unit suite (~840), DB harnesses (history, highlights, journal, Bible search/import), browser
  suites in `scripts/e2e` (library, merge, smoke, highlights, journal, saved-hubs, reader-batch1d,
  free-search, reader-spacing, cross-references).

- **Batch 1F — Offline Bible reading (complete; Production-tested by the owner):** IndexedDB downloads of WEB/ASV,
  Reader fallback, offline app shell service worker, `/offline-shell`, iPhone install guide.

## In progress
- Phase 2 cleanup in review: remove `@lovable.dev/vite-tanstack-config` (native `vite.config.ts`). `main` branch protection is pending (see `docs/NEXT_TASK.md`).

## Recently completed
- Lovable retired and `main` replaced by the Verse Snap app (PR #2, 2026-10-25); `main` is the GitHub default branch and the Vercel Production Branch; the first Production deployment succeeded.
- Repository cleanup phases 1 and 1B (unused assets, icons, 41 shadcn components, 31 packages).
- Books page: "All" chip first in each testament, selected by default (PR #1).

## Pending / needs approval
- Reflect screen: recovery actions for an invalid reference ("Search Manually" first).
- Phase B remainder (`docs/audit/PHASE_B_PLAN.md`): router calibration, KJAV, credits, Romans verse map; AI search stays off.
- KJAV for free search (UK rights); BBE/FBV licensing and UK KJV patent review.

## Known issues / risks
- Signed-in Supabase flows are tested against a mock in CI; the owner has tested the account journal and
  privacy live on Production and Preview.
- Cross-device sync is on page open/refocus, not realtime. Timestamps use the device clock.
- The old Lovable `main` (`c6caa12`) is kept only as `archive/lovable-main` and tag `legacy/lovable-main-c6caa12`;
  it is never merged into the app. `main` is the Production branch (GitHub default and Vercel Production Branch).
- Env vars `SUPABASE_*`, `RATE_LIMIT_SALT`, `AI_SEARCH_ENABLED`, `FREE_SEARCH_ENABLED`, `FREE_LIMIT_*` are
  shared by Production and Preview in Vercel; changing them affects both.
- A Vercel deployment-protection bypass token was created by `vercel curl`; delete it in the project
  settings if not wanted.
- Cross-references and Bible text depend on the HelloAO host at view time. About 0.03% of cross-reference
  targets run past a chapter's end in our editions; the end is clamped, or the passage shows "isn't in
  this edition" with a link to the chapter.
- `history` gives signed-in roles Supabase's default TRUNCATE/TRIGGER grants; not reachable via the API.
- `reference parser` golden test can time out under full-suite load (passes alone). guest-merge and
  mobile-smoke browser suites occasionally fail once under load and pass on rerun.
- Preview deployments are behind Vercel sign-in; verify with a local production build or `vercel curl`.
