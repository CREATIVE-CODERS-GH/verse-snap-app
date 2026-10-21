# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
Add recovery actions to the **"Verse not found"** screen. Spec (from the user): keep illustration,
type, colours, header; add under the description

1. Primary **"Speak Again"** (green brand button, microphone icon) → reopen the existing Say a Verse
   voice screen (`/voice`); reuse it, no new mic code.
2. Secondary **"Search Manually"** (outlined, search icon) → the existing reference search (`/search`).
3. Description: "We couldn't find that Bible reference. Try speaking again or search for a different verse."
4. Good mobile touch targets (≥44 px). Make the primary action context-aware where entry points differ.
5. Focused tests for the actions and navigation. No commit/push/deploy until the user reviews.

## Findings so far (no code written yet)
- "Verse not found" is rendered in two places: `src/routes/verse.$translation.$book.$chapter.$verse.tsx`
  (~line 363, `StateMessage` with `NoResultsIllustration`, `action` slot already exists) and
  `src/routes/reflect.$translation.$book.$chapter.$verse.tsx` (~line 768, `ErrorIllustration`).
- `StateMessage`, `PILL_OUTLINE`, illustrations: `src/components/search-states.tsx`.
- Voice is `src/routes/voice.tsx` (`autoListen`, `speechLanguage` preferences); it navigates to
  `/verse/...` or `/search?q=`. Manual search is `src/routes/search.tsx`.
- Decide: the reflect screen is entered from the reader, not by speaking — likely keep "Search Manually"
  as primary there, or show both; confirm with the user if unclear.

## Files likely relevant
`src/components/search-states.tsx`, the two routes above, `src/components/stitch-icons.tsx`
(mic/search icons exist). No test file covers search-states yet; add one in `src/components/` in the
style of `reflection.test.ts` (server-rendered markup + route source checks).

## Acceptance criteria
Both buttons render in the not-found state with the new copy; "Speak Again" reaches `/voice`; "Search
Manually" reaches `/search`; layout unchanged otherwise; dark mode correct; tests + `tsc` + lint pass.

## After that
1. Review Batch 1C → approve journal migration → verify → enable `ACCOUNT_JOURNAL_ENABLED` → preview.
2. Then pending items in `docs/PROJECT_STATUS.md` (Phase B needs separate approval).

## Housekeeping
Uncommitted Batch 1C work is in the tree: when pushing anything else, stage only that change's files.
