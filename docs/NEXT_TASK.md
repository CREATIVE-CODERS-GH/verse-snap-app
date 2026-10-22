# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
**Batch 1F — Offline Bible reading: inspected, awaiting approval to implement.** Findings and the
recommended first version were reported to the owner; nothing is built. Summary: no service worker and no
IndexedDB today (`OFFLINE_ENABLED = false`, `/sw.js` 404s); the reader keeps only the last 24 chapters in
localStorage as a network-failure fallback. Recommended v1: IndexedDB store of whole translations
(WEB, BSB, ASV; KJAV only if the owner clears the UK question) downloaded from HelloAO `complete.json`
from Settings, read first by the reader, plus a minimal hand-written service worker for the app shell,
behind `OFFLINE_ENABLED` with the existing kill switch, tested on a Preview first.

## Done and live
- Free Bible Search (WEB/ASV/BSB), Reflection Journal with account saving (Batch 1C), Reader improvements
  and Saved hubs (Batch 1D), Scripture cross-references (Batch 1E). Details in `docs/PROJECT_STATUS.md`.

## Pending follow-ups
- Reflect screen (`reflect.$translation.$book.$chapter.$verse.tsx`): the invalid-reference state has no
  recovery action; it is entered from the reader, so "Search Manually" should be primary.
- Production should be on `115b59e` (cross-reference out-of-range handling); the last Production build
  checked was `994264a`.
- `main` has diverged from the working branch (12 main-only commits, 5 conflicting files); Production is
  built from the branch. Decide the authoritative branch before any merge.

## After that
Pending items in `docs/PROJECT_STATUS.md` (Phase B and KJAV search need separate approval).
