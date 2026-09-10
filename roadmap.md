# Roadmap

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
- [ ] Add short, locally remembered first-use onboarding
- [ ] Add a restrained Verse Snap brand mark and app icon
- [ ] Refine core mobile hierarchy, terminology and touch targets
- [ ] Normalize loading, offline, empty and error states
- [ ] Audit accessibility and resource cleanup
- [ ] Validate first-use and returning-user journeys
