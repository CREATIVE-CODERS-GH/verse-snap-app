# Verse Snap — first build

A calm, mobile-first Bible lookup app. Six screens, bottom navigation, sample Bible text, and a swappable Bible data layer ready for the real API and accounts later.

## Screens

**Home** — "Verse Snap" and "Find your verse. Instantly." at the top. Three actions in clear order of weight: a solid primary "Say a Verse" button with a microphone icon, an outlined "Snap a Verse" button with a camera icon, and a plain text action "Search the Bible". Tapping the first two opens a small sheet saying voice/camera search is coming soon — no fake behaviour. Below, a "Recent" list of the last few verses with a "See all" link to History.

**Search** — "Search the Bible", one search field ("Enter a reference, e.g. John 3:16"). Typing a reference produces a tappable result. Understands `John 3:16`, `John 3 16`, `john 3v16`, `1 Corinthians 13:4`, and `John chapter 3 verse 16`. Book names and common abbreviations (Jn, Rom, Ps, 1 Cor) are matched. Invalid input shows a quiet inline hint, not an error banner.

**Verse view** — reference as a modest heading, verse text set in a serif face at a generous size and line height, comfortable margins. Below it: Listen, Save, Copy, Share as icon + label actions in a row (Listen shows the coming-soon note; Copy and Share work; Save toggles). Previous / Next verse at the bottom. A translation control showing KJV, built as a list so more translations drop in later.

**Saved** — "Saved Verses", each row showing the reference and a one-line preview, tapping opens the verse, swipe/long-press-free simple remove action. Empty state: "No saved verses yet." / "Save verses you want to come back to."

**History** — entries grouped under Today / Yesterday / earlier dates, tap to reopen, a quiet "Clear History" action with a confirm step.

**Settings** — plain grouped rows, no cards: Bible (Translation, Text Size), Appearance (Theme), Audio (Playback Speed), About (About Verse Snap, Privacy Policy, Terms of Service). Text Size and Theme actually work; the rest are labelled placeholders.

**Sign in** — a quiet sign-in / create-account screen matching the rest of the app: email and password, plus "Continue with Google". Password reset by email, with its own set-new-password screen. Settings gains an Account section showing the signed-in email and a Sign out action.

**Navigation** — fixed bottom bar: Home, Saved, History, Settings. On tablet and desktop the content stays in a narrow reading column, centred, so verses stay comfortable to read.

## Look and feel

Warm off-white paper background, near-black warm ink text, one restrained accent (a deep muted blue-teal) used for the primary button, active nav item, and links. A serif for verse text and headings, a clean sans for interface labels. Hairline borders and one very light shadow reserved for the bottom bar. No gradients, glows, glass, badges, or decorative graphics. Full dark mode using the same warm palette.

## Accounts and storage

Real accounts are switched on using the built-in backend (email + password and Google sign-in). Saved verses and history belong to the signed-in person and sync across their devices.

- Reading the Bible, searching, and opening verses stay open to everyone — no sign-in wall on the reading experience.
- Saving a verse or seeing your Saved and History lists requires an account; tapping Save while signed out opens the sign-in screen and completes the save afterwards.
- Tables: a profile row per person (display name, preferred translation, text size, theme), saved verses, and history entries — each tied to the account, with access rules so a person can only ever read or change their own rows. A translations table holds the available versions. A profile is created automatically on signup.

## Data and services

- `bibleService` is the only thing the screens talk to for scripture: get a verse, get neighbouring verses, list translations, parse a reference. It is backed by a sample KJV dataset now (a few dozen well-known verses plus surrounding context), with a documented adapter stub for the Free Use Bible API at bible.helloao.org — no invented endpoints.
- A separate reference parser handles the input variations above.
- Saved verses and history go through one storage layer that talks to the backend, so the screens never touch the database directly.

## Technical notes

- Routes: `/` (home), `/search`, `/verse/$translation/$book/$chapter/$verse`, `/auth`, `/reset-password`, and account-gated `/saved`, `/history`, `/settings`. Each gets its own page title and description.
- Design tokens (colours, fonts, radii) defined once in `src/styles.css`; components use semantic classes only.
- Structure: `src/components/` (nav, layout, verse row, action button, settings row), `src/lib/bible/` (service, parser, sample data, API adapter stub), `src/lib/storage/` (saved + history against the database).
- Voice, camera, audio playback, and the live Bible API stay as clearly marked placeholders for the next phase.
