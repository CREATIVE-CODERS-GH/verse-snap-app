> **Historical (2026-10-23).** Written while the app was still connected to Lovable. Lovable is retired; the current workflow is in `CLAUDE.md` and `docs/DECISIONS.md`. Kept for the record; details may be outdated.

# Roadmap

## Additional Bible versions
- [x] Enable complete public-domain English BSB, WEB, ASV, and BBE editions alongside KJAV
- [x] Add the Free Bible Version (FBV) — modern NLT-style wording; NLT itself is copyrighted and unavailable
- [x] Use selected-edition text and accurate names throughout reading and search
- [x] Verify switching, guest saved/history isolation, navigation, and version-specific lookup

- [x] Verify AO Lab API contract and licensing
- [x] Implement real verse and chapter lookup
- [x] Add direct search loading and error states
- [x] Add local guest recent history and saved verses
- [x] Add copy, share, listen, and navigation behavior
- [x] Validate app flows and preserve existing design

## Phase 3 — Voice reference lookup
- [x] Add spoken-reference normalization and ambiguity handling
- [x] Add voice input route and browser recognition lifecycle
- [x] Connect Home Say a Verse action
- [x] Validate parser, voice states, navigation, and metadata

## Phase 4 — Camera reference scanning
- [x] Add on-device OCR service module (tesseract.js, lazy loaded)
- [x] Add reference detection inside free-form OCR text
- [x] Add camera screen with capture, guide frame, permission and fallback states
- [x] Handle multiple, missing, and unclear references
- [x] Validate end-to-end scan to Verse View

## Phase 5 — Polish and production hardening
- [x] Cache recent chapters locally and fall back when the service is unreachable
- [x] Tune query caching defaults for instant repeat lookups
- [x] Refine loading, error, and empty-state wording
- [x] Show the real translation label on verse and chapter screens
- [x] Guard duplicate microphone sessions and OCR reads; hold the captured frame while reading
- [x] Remove unused sample data and placeholder dialog code
- [x] Fix formatting/lint issues across the app
- [x] Validate search, save, history dedupe, offline fallback and reference parsing

## Phase 6 — Natural scripture search
- [x] Classify typed and spoken input as reference or description
- [x] Add server-side candidate lookup, verified against the Bible source
- [x] Rank and show matching verses in the existing search screen
- [x] Route natural-language speech from voice into search
- [x] Validate reference routing, phrase matches and topical queries

## Phase 7 — First-time experience and mobile polish
- [x] Add short, locally remembered first-use onboarding
- [x] Add a restrained Verse Snap brand mark and app icon
- [x] Refine core mobile hierarchy, terminology and touch targets
- [x] Normalize loading, offline, empty and error states
- [x] Audit accessibility and resource cleanup
- [x] Validate first-use and returning-user journeys

## Reliability — Camera OCR and natural search
- [x] Enhance captured images locally before OCR
- [x] Add tolerant OCR reference normalization and review/edit recovery
- [x] Accept unrestricted natural-language descriptions within safe length limits
- [x] Improve candidate ranking, fallback guidance, and Gateway error handling
- [x] Validate requested camera/reference and semantic-search cases

## V1 production readiness audit
- [x] Tighten database privileges (signed-out visitors can only read translations)
- [x] Add abuse throttling to the semantic search endpoint
- [x] Add request timeouts and de-duplication to Bible lookups
- [x] Add anonymous product analytics events
- [x] Add a voice startup fallback for devices that never begin listening
- [x] Verify production build, types, lint, and key mobile flows

## Installable app (home screen)
- [x] Add web app manifest with standalone display, app icons, and maskable icon
- [x] Wire apple-touch-icon, theme colour, and iOS web-app metadata
- [x] Keep theme colour in sync with the app's light/dark setting

## Offline support (done)
- Generated service worker (/sw.js) via vite-plugin-pwa; registered only in production, never in dev/preview; ?sw=off kill switch.
- App shell + pages: NetworkFirst; Bible API text cached up to 30 days; OAuth callbacks excluded.
- Offline copy on verse/chapter screens explains only recently opened passages are available offline.

## Share verse as image (done)
- Share button on Verse View renders a branded PNG card on-device (canvas, works offline); system share sheet when supported, download fallback, then text share/copy.

## Reading continuity (done)
- Home shows a "Continue reading" card (last opened chapter + translation) once the reader has opened a chapter.
- Chapter pages have previous/next chapter navigation that crosses book boundaries (e.g. John 21 → Acts 1).
