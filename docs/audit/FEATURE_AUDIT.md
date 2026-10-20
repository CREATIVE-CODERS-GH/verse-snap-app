# Verse Snap — Feature Audit

**Legend.** *Code-inspected* = read the code and believe it works. `tsc --noEmit` passed (exit 0). **No feature was run or exercised in a browser during this audit**, so nothing below is "tested". `src/lib/bible/helloao-provider.test.js` (a `bun:test` file) exists but was not run: there is no `test` script and bun was not invoked.

| # | Feature | Status | Evidence (files) | Verified how |
|---|---|---|---|---|
| 1 | Reference lookup (typed), e.g. "John 3:16" | Implemented | `parse-reference.ts`, `classify-query.ts`, `routes/search.tsx`, `routes/index.tsx` | code-inspected |
| 2 | Chapter + verse reader, prev/next continuity | Implemented | `routes/chapter.*`, `routes/verse.*`, `last-read.ts` (latest commit "Added reading continuity nav") | code-inspected |
| 3 | Multiple editions (KJAV, BSB, WEB, ASV, BBE, FBV) | Implemented | `bible/translations.ts`, `helloao-provider.ts`, provider test | code-inspected |
| 4 | Voice reference lookup | Implemented, browser-dependent | `routes/voice.tsx` (Web Speech API, `en-US`) | code-inspected |
| 5 | Camera scan + OCR | Implemented | `routes/scan.tsx`, `lib/ocr/*` (tesseract.js, 3 page-seg modes) | code-inspected |
| 6 | Natural-language scripture search (AI) | Implemented, **Lovable-dependent** | `search.functions.ts` | code-inspected |
| 7 | Email/password sign-up, sign-in, reset | Implemented | `auth-form.tsx`, `reset-password.tsx` | code-inspected |
| 8 | Google sign-in | Implemented, **Lovable-dependent** | `auth-form.tsx:53`, `integrations/lovable/index.ts` | code-inspected |
| 9 | Saved verses (guest local + cloud) | Implemented | `library.ts`, `routes/saved.tsx` | code-inspected |
| 10 | Reading history (guest local + cloud, 100 cap locally) | Implemented | `library.ts`, `routes/history.tsx` | code-inspected |
| 11 | Preferences (text size, theme, translation, speed) | Implemented, **local only** | `preferences.tsx` | code-inspected |
| 12 | Share verse as image / copy | Implemented | `share-verse-image.ts` | code-inspected, shallow |
| 13 | Listen (TTS) / playback speed | Implemented (inferred from prefs + analytics event) | `preferences.tsx`, `verse.*` route | shallow |
| 14 | Onboarding | Implemented | `components/onboarding.tsx` | code-inspected, shallow |
| 15 | PWA / offline | Implemented with caveats | `vite.config.ts`, `pwa-register.ts`, manifest | code-inspected |
| 16 | Analytics / error reporting | Effectively **inert outside Lovable** | `analytics.ts`, `lovable-error-reporting.ts` | code-inspected |

## Findings by risk

### HIGH
1. **AI search stops working when Lovable is removed.** `search.functions.ts:156–160` needs `LOVABLE_API_KEY`, the endpoint is `ai.gateway.lovable.dev`, and the model ID `openai/gpt-6-astra` is a gateway ID that another provider will not recognise. The app degrades gracefully (`failed: true`, "Scripture search is not configured."), but the "describe a verse" feature is down.
2. **Google sign-in depends on Lovable Cloud's managed OAuth broker** (`@lovable.dev/cloud-auth-js`). With your own Supabase project it will not work until Google is configured in Supabase and the call is switched to `supabase.auth.signInWithOAuth`.
3. **Existing user rows may not match the app's translation codes** (`'KJV'` default in DB vs `'KJAV'` in app). `library.isSaved/unsave` use exact-match filters, so old rows can show as "not saved" and re-saving creates duplicates.

### MEDIUM
4. **Server-side rate limit and cache are per-instance memory** (`search.functions.ts:36–60`). On Workers/serverless they reset per isolate, so "20/min" is not real cost control once AI spend is on your own key. Use a durable limiter and/or require sign-in.
5. **`searchScripture` is unauthenticated**, so anyone can spend your AI credits up to the throttle.
6. **Cloud preferences never sync.** The `profiles` table is unused. Preferences are lost on a new device.
7. **History write is delete-then-insert** (`library.ts` `recordView`): two round trips, not atomic. Prefer a single upsert on a unique key.
8. **Voice is `en-US` only and uses vendor Web Speech APIs.** Firefox has no support, and Chrome sends audio to Google. Check any privacy copy that says audio stays private.
9. **OCR language data source is unverified.** `createWorker("eng")` (`tesseract-provider.ts:12`) uses tesseract.js defaults, which fetch `eng.traineddata` from a public CDN. That means no offline OCR and an extra third-party runtime dependency. The repo-root `eng.traineddata` is not referenced anywhere (no `langPath` found).
10. **Camera** needs HTTPS and permission; unsupported/denied states are handled (`scan.tsx:101`), code-inspected only.

### LOW
11. `profiles.translation` default and the `translations` seed (`KJV` only) are stale versus the app catalogue.
12. `trackEvent` calls are silently dropped off-Lovable, so there is no product analytics today.
13. No `test` script and no CI; the only test file is `.js` using `bun:test`.

## Not tested (explicit)
Auth flows against any Supabase project, RLS behaviour, OCR accuracy, voice accuracy, offline mode, installability, Lighthouse, multi-translation correctness against the live HelloAO API, and the production build (`vite build` was deliberately **not** run, since it would overwrite the existing `.output/` and `dist/`).
