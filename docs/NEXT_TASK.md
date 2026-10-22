# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
**Batch 1F Stage 2 — offline app shell: pushed to the Preview branch, awaiting owner acceptance.** Stage 1 (IndexedDB
downloads of WEB/ASV, popup controls, Reader fallback) is `708f502`/`acb866b`. Stage 2 adds a generated service
worker (`scripts/sw/`, written into the build by `build-sw.mjs`; shipped only when `scripts/sw/flag.mjs` says so:
Preview and Production builds; Production switch `OFFLINE_IN_PRODUCTION = true`, set by the owner), a content-free `/offline-shell` route
as the cached document, an offline note on Home, and the iPhone install guide (`install-guide.ts`: iOS Safari
only, not standalone, not native via `VITE_NATIVE_APP`/Capacitor, remembered dismissal; independent of downloads
and of the worker). Tests: `NITRO_PRESET=node-server OFFLINE_SW=1 npm run build` then `npm run test:e2e:offline-sw`
(38 checks, cold offline with the server stopped). Next: real iPhone/Android check on the Preview, then decide
that the live Production site serves `/sw.js` and `/offline-shell` once Production is deployed.

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
