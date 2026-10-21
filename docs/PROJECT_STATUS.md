# Project status

*Updated 2026-10-21. Branch `testing/vercel-mobile-preview` (last pushed: `a13e4ad`). Earlier phase
checklist: `roadmap.md` (its "Offline support" item is outdated — see Known issues).*

## Done
- **Screens (Stitch designs):** onboarding, Home, Voice, Camera scan, Search, Books (13 Pauline /
  8 General incl. Hebrews; rest of a group reveals on scroll), chapter reader (verse sheet, highlights,
  share, compare, verse card, cross references), Saved, History, Settings (+ text size, voice & audio),
  Reflection Journal, loading/network-error states, light/dark theme, Vercel Analytics.
- **Batch 1A:** guest→account merge of Saved/History (consent, idempotent); chapter reading in History.
  History migration `20261020000000` applied (`ACCOUNT_HISTORY_V2 = true`).
- **Batch 1B:** persistent highlights, per translation, guest + account. Migration `20261021000000`
  applied (`ACCOUNT_HIGHLIGHTS_ENABLED = true`). Preview-accepted (Batch 1A is in Production).
- **Batch 1C (built, not reviewed/pushed):** reflections + notebooks (create/edit/delete, per verse and
  translation, guest + account, merge, Saved → "Reflections" view). Migration
  `20261022000000_reflection_journal.sql` prepared, **not applied**; `ACCOUNT_JOURNAL_ENABLED = false`.
- Tests: ~630 unit, DB harnesses (history, highlights, journal), browser suites (`scripts/e2e`).

## In progress
- Batch 1C awaiting review. Local only (uncommitted): journal code, migration, rollback, verification 07,
  tests, e2e scripts.
- "Verse not found" recovery buttons (see `docs/NEXT_TASK.md`): inspected, no code written.

## Pending / needs approval
- Apply journal migration → run verification 01/02/05/06/07 → regenerate types → enable switch → deploy.
- Phase B search-index migration (`docs/audit/PHASE_B_PLAN.md`); AI search stays off.
- BBE/FBV licensing and UK KJV patent review.

## Known issues / risks
- Offline service worker is **disabled** (`OFFLINE_ENABLED = false` in `pwa-register.ts`) after the
  `/sw.js` 404; the roadmap's offline item is stale. Step 2 offline plan not approved.
- Real signed-in Supabase flows are only tested against a mock in CI; check on a Vercel preview.
- Cross-device sync is on page open/refocus, not realtime. Timestamps use the device clock.
- Merging this branch to `main` may make Lovable apply migrations to the old project — avoid.
- `history` (checked live) gives signed-in roles Supabase's default TRUNCATE/TRIGGER grants; not
  reachable via the API. Other older tables not checked. Highlights/journal tables are tighter.
- `reference parser` golden test can time out under full-suite load (passes alone).
- Preview deployments are behind Vercel sign-in; verify with a local production build.
