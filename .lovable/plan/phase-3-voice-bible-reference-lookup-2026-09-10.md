# Phase 3: Voice Bible Reference Lookup

## Goal
Make the existing **Say a Verse** action open a quiet, mobile-first voice lookup screen that listens once, recognizes a Bible reference, and opens the existing Verse View without changing Verse Snap’s visual identity.

## What will change
- Add a dedicated `/voice` screen with four clear states: idle, listening, processing, and error.
- Connect the existing Home **Say a Verse** button directly to this screen; leave camera scanning unchanged.
- Use the browser/device Web Speech Recognition API when available, configured for one English utterance rather than continuous listening.
- Show the recognized words beneath the microphone, plus Cancel, Try again, and Search manually actions where appropriate.
- Stop recognition and remove listeners when recognition completes, the user retries, cancels, or leaves the screen.

## Spoken-reference parsing
- Extend the existing dedicated parser rather than creating a second conflicting parser.
- Normalize number words and compounds into digits, including forms such as `twenty eight`, `one hundred nineteen`, and ordinal book prefixes such as `first`, `second`, and `third`.
- Continue using the canonical 66-book list and its aliases, adding practical speech-to-text variants such as singular/plural Psalms and common book-name transcriptions where they are safe and unambiguous.
- Support both explicit forms (`Hebrews chapter two verse five`) and compact forms (`John three sixteen`, `Psalm twenty three`).
- Validate book and chapter locally; the existing Bible service remains responsible for validating the real verse against AO Lab data.

## Confidence and ambiguity
- Open the verse or chapter immediately only when the recognition result is marked final, browser confidence is strong, and one valid reference parses cleanly.
- If confidence is lower but a valid reference exists, show **Did you mean?** with the normalized reference and an **Open verse** action.
- Consider up to three recognition alternatives and show distinct valid interpretations when available.
- Never guess when parsing fails; show a concise unclear/no-speech/permission message with Try again and Search manually.

## Technical details
- Add local TypeScript declarations for the prefixed and unprefixed browser Speech Recognition APIs, with no new dependency.
- Keep recognition entirely on-device/browser-managed; no audio is stored or sent through Verse Snap’s backend.
- Navigate successful verse references to the current Verse View and chapter-only references to the current Chapter View, both using the selected translation.
- Preserve semantic colors, existing buttons, spacing, typography, bottom navigation, and all current reading actions.
- Add route-specific title, description, Open Graph metadata, and Twitter card metadata for the voice screen.

## Validation
- Unit-style parser checks for all requested examples plus representative compound numbers and all numbered-book patterns.
- Browser checks for unsupported, idle, listening, processing, permission-denied, no-speech, ambiguous, retry, cancel, and successful navigation states using a mocked Speech Recognition implementation.
- Confirm real Verse View data still loads after voice navigation, the microphone has an accessible label and focus state, and no console errors or listener leaks occur.

## Out of scope
Camera scanning, continuous dictation, voice commands, AI chat, semantic search, audio storage, and any visual redesign remain deferred.
