# Phase 7 — First-time experience and mobile polish

## Goal
Make Verse Snap feel like a finished mobile utility without changing its product, adding features, or changing its restrained visual direction.

## First-time experience
- Add a three-step, full-screen onboarding flow shown only when Home opens for the first time.
- Use the supplied wording, simple microphone/camera icons, clear progress, **Skip**, **Back/Next**, and **Get Started** controls.
- Store completion locally so returning users open Home immediately; keep guest use and optional sign-in unchanged.
- Prevent the bottom navigation and Home content from appearing behind onboarding, and avoid an incorrect first-render flash while local state is checked.

## Brand and core screens
- Add a small, simple Verse Snap mark based on an open Scripture page and capture corners; use it on onboarding and Home without adding decorative imagery.
- Add a lightweight app-icon asset and wire it into page metadata as the current placeholder production mark.
- Preserve Home’s exact hierarchy and terminology: Verse Snap, tagline, Say a Verse, Snap a Verse, Search the Bible, Recent.
- Audit screen titles, navigation labels, actions, and empty states for consistent product wording.

## Mobile reading and interaction polish
- Refine the Verse View hierarchy so reference and scripture lead, translation remains quiet, long text stays comfortable, and actions retain reliable touch targets.
- Keep voice copy focused on “Say the Bible reference,” while still allowing descriptions to use the existing Scripture results.
- Keep camera instructions and controls minimal, with Capture and Cancel prominent.
- Strengthen active bottom-navigation and keyboard-focus states without enlarging the navigation.
- Keep transitions short and limited to color/state changes; add no page animation, gradients, shadows, or decorative effects.

## Reliability, accessibility, and performance
- Normalize loading, empty, offline, and failure messages into concise human language; explicitly distinguish an uncached offline verse.
- Preserve the existing chapter cache, settings, guest Saved/History, and optional account behavior.
- Review labels, live regions, focus visibility, contrast, and minimum touch areas across the core journey.
- Confirm camera streams, speech recognition, speech playback, and OCR work are cleaned up when leaving their screens; avoid new dependencies or large assets.

## Technical details
- Implement onboarding as a focused client-side experience with a versioned local completion key and hydration-safe initial state.
- Reuse existing semantic color/type tokens, design-system buttons, Lucide icons, and the current mobile shell.
- Add only small reusable presentation pieces needed for the onboarding/brand mark; no backend or data-schema changes.
- Update the project roadmap and durable product notes after implementation.

## Validation
- Test first visit, Skip, Get Started, and returning-visit behavior.
- Test Home → voice reference, Home → camera fallback/capture states, typed reference search, natural-language search, verse reading, Saved, History, Settings, and optional auth entry.
- Check keyboard and screen-reader naming, visible focus, mobile-width layout, dark/light themes, and absence of technical error text.
- Verify no console errors or leaked camera/voice activity after navigation.
- Report any camera, microphone, browser-permission, safe-area, or install-icon behavior that still requires physical Android/iOS testing.
