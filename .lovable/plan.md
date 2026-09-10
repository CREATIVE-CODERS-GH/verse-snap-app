# Verse Snap Phase 2

## Goal
Replace the bundled sample text with live, normalized Bible data from AO Lab while preserving the current quiet, mobile-first interface. Reading, searching, saving, history, copy, sharing, and basic listening will work without requiring an account.

## Build

### Real Bible data
- Implement the existing AO Lab provider against the verified public JSON endpoints with no API key.
- Use the API's `eng_kjv` English King James edition and expose it in the app as the only currently available translation.
- Fetch the translation's book metadata and chapter JSON, map API book identifiers to Verse Snap's existing book model, and normalize nested verse content into the app's internal types.
- Remove the sample provider from the production request path; retain no hard-coded verse as a fallback.
- Add typed, human-readable error categories for invalid references, unavailable translations, missing verses, and connection/API failures.

### References and direct search
- Extend the parser so a missing verse remains a chapter request instead of silently becoming verse 1.
- Keep support for numeric, spoken-word, abbreviated, and ordinal book formats already handled by the parser.
- Submit valid references directly from Search with Enter or the existing result action.
- Add a dedicated chapter route for requests such as `Psalm 23`; display the whole chapter as numbered verses in the same typography-led design.
- Keep concise inline feedback for empty or malformed input.

### Verse and chapter reading
- Connect Verse View to the live provider and show the verified translation label.
- Preserve the current screen structure while adding restrained loading, retry, invalid-reference, and connection-error states.
- Use the API's actual chapter verse list and chapter metadata for Previous/Next, including transitions to adjacent chapters at boundaries.
- Keep the translation selector architecture, but list only the one verified edition for now.

### Local saved verses and history
- Add a local device library for guests using versioned browser storage.
- Save complete normalized verse text locally, support unsaving, and show it on the existing Saved screen without sign-in.
- Record every opened verse locally for guests; deduplicate by translation/book/chapter/verse and refresh the timestamp when reopened.
- Populate Home Recent and the History screen from real local views for guests, with clear-history support.
- Preserve the existing private cloud-backed library for signed-in users; each signed-in account continues using only its own protected records.

### Copy, share, and listen
- Copy reference, translation, and actual verse text to the clipboard with the existing small toast confirmation.
- Use native device sharing when available and clipboard fallback otherwise.
- Replace the Listen placeholder with browser text-to-speech for the actual verse, exposing a simple Listen/Stop state and cancelling speech when leaving or changing verses.
- Show a concise toast if speech is unavailable.

## Technical details
- Extend the Bible provider contract with normalized chapter data and deterministic neighbour lookup.
- Flatten AO Lab verse content safely, including nested text fragments, while excluding formatting-only metadata.
- Validate API response shapes before use and never surface raw provider errors.
- Keep API access exclusively behind the Bible service/provider layer.
- Add no dependencies, secrets, redesign, gradients, decorative effects, or unrelated features.

## Validation
- Verify live `John 3:16`, `Hebrews 2:5`, `Romans 8:28`, `1 Corinthians 13:4`, and full `Psalm 23` lookup.
- Verify invalid book/chapter/verse and simulated network failure states.
- Verify Previous/Next within a chapter and across chapter boundaries.
- Verify guest save/unsave, deduplicated recent history, clear history, copy fallback, share handling, and text-to-speech capability handling.
- Check mobile and desktop rendering without changing the established design direction.
