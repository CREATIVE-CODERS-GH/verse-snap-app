> **Historical (2026-10-23).** Written while the app was still connected to Lovable. Lovable is retired; the current workflow is in `CLAUDE.md` and `docs/DECISIONS.md`. Kept for the record; details may be outdated.

# Verse Snap — Phase 4: Removing Lovable Dependencies

*Read-only audit and plan, 2026-10-19. **No code, dependencies, database or Git state was changed.** Findings come from a repo-wide search (`lovable`, `gptengineer`, `~oauth`, `ai.gateway`), reading each file, and reading the installed `@lovable.dev/vite-tanstack-config@2.26.5` source in `node_modules`. Nothing below has been run.*

Scope rules for the implementation that follows this plan: preserve the UI and the working Supabase features (sign-up/in, reset, saved verses, history, RLS); do the work on `migration/independent-supabase`; no push to `main` (Lovable syncs it).

## 0. Inventory (by risk)

| # | Dependency | Risk if left | Risk to remove | Files |
|---|---|---|---|---|
| 1 | Lovable AI gateway (natural-language search) | **High** — feature dead without Lovable | Medium | `src/lib/bible/search.functions.ts` |
| 2 | Lovable OAuth broker (Google sign-in) | **High** — button fails on own Supabase | Medium | `src/integrations/lovable/index.ts`, `src/components/auth-form.tsx`, `package.json` |
| 3 | `@lovable.dev/vite-tanstack-config` | **High** — whole build/dev server, hosting preset | **High** (touches everything) | `vite.config.ts`, `package.json`, `bunfig.toml` |
| 4 | Preview auth-storage broker | Low (inert off Lovable) | Low | `src/integrations/supabase/previewAuthStorage.ts`, `client.ts` |
| 5 | Lovable telemetry hooks | Low (inert) | Low | `src/lib/analytics.ts`, `src/lib/lovable-error-reporting.ts`, `src/routes/__root.tsx` |
| 6 | Cron-secret helper | None (unused) | None | `src/integrations/supabase/cron-auth.ts` |
| 7 | Lovable-worded error strings | None | None | `auth-middleware.ts`, `client.server.ts` |
| 8 | PWA hostname/`/~oauth` assumptions | Low | Low | `src/lib/pwa-register.ts`, `vite.config.ts` |
| 9 | Docs / repo metadata / Git sync | Process risk | Low | `AGENTS.md`, `README.md`, `.lovable/`, `bunfig.toml`, lockfiles |

Environment variables that are Lovable-only: `LOVABLE_API_KEY` (read by app code); `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS` (read by unused code). Read only by the wrapper: `LOVABLE_PREVIEW_HOST`, `LOVABLE_NITRO_PRESET`, `LOVABLE_HMR_FULL_RELOAD`, `LOVABLE_SPAWN_GENERATION`, sandbox flags. We set none of these.

---

## 1. Lovable AI gateway — natural-language Bible search

**Where:** `src/lib/bible/search.functions.ts`
- `askForCandidates(query)` (≈ line 155–215): reads `process.env["LOVABLE_API_KEY"]`; POSTs to `https://ai.gateway.lovable.dev/v1/responses` with headers `Lovable-API-Key` and `X-Lovable-AIG-SDK`, model `"openai/gpt-6-astra"`, `stream: true`, OpenAI Responses-API body with a strict JSON schema; retries 429/5xx up to 3×.
- `readStream(response)` (≈ line 110–145): parses the Responses SSE stream.
- `runSearch` → `askForCandidates`, then re-fetches each reference from HelloAO via `bibleService.getVerse` and ranks with `score()`; the model never supplies verse text.
- `searchScripture` (server fn, line ≈ 398): in-memory cache (100) and in-memory rate limit (20/min/IP via `cf-connecting-ip` / `x-forwarded-for`). **Unauthenticated.**
- `.inputValidator(...)` (line 398): installed `@tanstack/start-client-core` marks `inputValidator` as `@deprecated — use validator`. **This is the Vite warning you saw. It is unrelated to Lovable** (a TanStack API rename); fix it in the same edit.

**Who depends on it:** the "describe a verse" path in `src/routes/search.tsx` (via `searchScripture`; analytics event `semantic_search`). Reference lookup, voice and OCR do **not** depend on it. Failure mode today: returns `{ failed: true, errorMessage: "Scripture search is not configured." }`; UI degrades gracefully.

**Replacement (recommended):** call the Anthropic Messages API directly with `fetch`, no new package.
- Model: **Claude Haiku 5.5** (`claude-haiku-5-5`) — cheap and fast; the task is only "name up to 12 references".
- Structured output: a single forced tool (`tool_choice` = that tool) whose `input_schema` is the existing `SCHEMA`; read `tool_use.input.references`. Drop streaming and `readStream` (not needed for a short JSON answer).
- Keep: system prompt, retry/backoff, candidate validation, HelloAO re-fetch, scoring, cache.
- Config (server-only): `AI_API_KEY`, `AI_MODEL` (default `claude-haiku-5-5`), optional `AI_BASE_URL`. Keep the module behind a tiny `askForCandidates` interface so another provider can be swapped in.
- Verify exact request parameters and current model IDs against Anthropic's docs at implementation time (I will use the `claude-api` reference then). Alternative providers (OpenAI etc.) fit the same interface; **your choice**.

**Protect the endpoint (do in the same change, because you now pay per request):**
1. Durable rate limit and daily cap: the current in-memory limiter resets per isolate/instance. Options: (a) require sign-in and use `requireSupabaseAuth` (already present, currently unused) plus a per-user counter in Supabase; (b) keep guest access with a host KV/Upstash limiter. **Decision for you.**
2. Provider-side monthly spend limit.
3. Never log the query text or the key.

**Risks of removal/replacement:** search quality/cost changes with the model; `process.env` access differs by host (see §3 "Runtime env"); the key must be a server secret, never `VITE_*`.

**Test plan:**
- Unit: mock `fetch`; assert request shape, tool-schema parsing, malformed JSON → `[]`, 429/5xx retry, missing key → "not configured".
- Live (dev key): "love is patient" → 1 Corinthians 13:4 first; "do not be anxious" → Philippians 4:6; gibberish → empty list, not an error; confirm every returned verse text came from HelloAO.
- Abuse: 25 rapid requests → limiter responds; cap behaviour across two server instances.
- Regression: `search.tsx` guest and signed-in; offline message; other search types unchanged.

---

## 2. Lovable OAuth broker — Google sign-in

**Where:**
- `src/integrations/lovable/index.ts` (auto-generated): `createLovableAuth()` from `@lovable.dev/cloud-auth-js`; `lovable.auth.signInWithOAuth(provider, opts)` → broker flow → `supabase.auth.setSession(result.tokens)`.
- `src/components/auth-form.tsx`: `import { lovable }` (line 7) and `handleGoogle()` (≈ line 52–63): `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })`, treats `result.redirected` / `result.error`.
- `package.json`: dependency `@lovable.dev/cloud-auth-js@^1.1.2`.
- `vite.config.ts` line 39: service-worker navigation rule excludes `/~oauth` (Lovable's callback path).

**What depends on it:** only the "Continue with Google" button (rendered in both `/auth` and Settings).

**Replacement:** native Supabase OAuth.
```ts
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: window.location.origin },
});
```
The browser redirects to Google, then to `https://shoztcflucpnfenohgcr.supabase.co/auth/v1/callback`, then back to the app origin where supabase-js (implicit flow, already the default) reads the session from the URL hash and fires `SIGNED_IN`. `AuthProvider`/`AuthSync` already react to that; `AuthPage` already redirects when `user` appears. `onSignedIn` is not called on the redirect path (page unloads), which is fine.

**External setup (you, not code):**
1. Google Cloud Console → OAuth consent screen + OAuth client (Web). Authorised redirect URI: `https://shoztcflucpnfenohgcr.supabase.co/auth/v1/callback`. Authorised JS origin: your dev and later production origins.
2. Supabase Dashboard → Authentication → Providers → Google: paste client ID/secret (never in chat or Git).
3. URL Configuration: Site URL and redirect allow-list already include the dev origin; add production later.

**Risks:**
- Account linking: a Google sign-in with an email that already has a password account is linked to it when the email is verified (Supabase default). Test explicitly with both account types (your two test accounts).
- iOS/Android installed-PWA flows can open the OAuth page in a browser sheet; test on a phone before production.
- If Google credentials are missing or misconfigured the button shows the existing toast ("Google sign-in did not complete"); keep that UX.
- Google consent screen in "Testing" mode only allows listed test users.

**Safe removal order inside this item:** (a) add the Supabase call behind the existing `handleGoogle`, (b) test, (c) delete `src/integrations/lovable/`, (d) remove the package and the `/~oauth` rule (with the config work, §3).

**Test plan:** new Google user → profile row created by `handle_new_user` (display name from Google metadata) → saved verse/history persist after reload; existing email/password user signs in with same Google email → single user, two identities (Dashboard → Users); sign-out/in; cancel at consent screen → toast, no loop; reset-password and email sign-in still work; `01`/`02` verification scripts unaffected.

---

## 3. `@lovable.dev/vite-tanstack-config` and build configuration

**Where:** `vite.config.ts` (`import { defineConfig } from "@lovable.dev/vite-tanstack-config"`), `package.json` devDependency `2.26.5`, `bunfig.toml`, `.lovable/project.json`.

**What the wrapper actually does** (read from `node_modules/@lovable.dev/vite-tanstack-config/dist/index.js`), and therefore what a plain config must reproduce:

| Wrapper behaviour | Needed? | Plain-config equivalent |
|---|---|---|
| `tanstackStart(...)` with `importProtection` (client may not import `**/server/**` or `server-only`) | Yes | `tanstackStart({ importProtection: { behavior: "error", client: { files: ["**/server/**"], specifiers: ["server-only"] } }, server: { entry: "server" } })` |
| `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-tsconfig-paths` (`projects: ["./tsconfig.json"]`) | Yes (all already direct deps/devDeps) | add as plugins |
| `nitro()` on **build** only, `defaultPreset: "cloudflare-module"` (+ `nodeCompat` in Lovable's sandbox only) | Yes — **host decision** | `nitro({ preset: "<your host>" })`, explicit |
| `@tanstack/devtools-vite` in `development` mode | Optional | drop, or add as devDep |
| `css: { transformer: "lightningcss" }` | Probably | keep: add `lightningcss` as a devDependency (currently only present transitively through the wrapper) or remove the option |
| `resolve.alias["@"]` = `./src`, `resolve.dedupe` (react, react-dom, jsx runtimes, `@tanstack/react-query`, `query-core`), `optimizeDeps.include` (react, react-dom, jsx runtimes) | Yes | copy as written (tsconfig paths already provide `@/*`) |
| `define` of `import.meta.env.VITE_*` from `loadEnv(mode, cwd, "VITE_")` | Redundant — Vite already exposes `VITE_*` | drop |
| `server: { host: "::", port: 8080 }` | Matches current dev URL | keep `port: 8080`, or choose another and update Supabase redirect URLs |
| dev SSR / server-fn error loggers | Debug aids | optional |
| `lovable:assets-proxy` (dev; no-op unless `LOVABLE_PREVIEW_HOST` set), prerender/watchdog/sandbox plugins | **No** (Lovable-sandbox only) | drop |

`VitePWA` stays as a direct plugin (already `vite.config.ts` content).

**Package consequences (all need your approval):** remove `@lovable.dev/vite-tanstack-config`; possibly add `lightningcss` and `@tanstack/devtools-vite` as explicit devDependencies; peers already satisfied (`vite`, `@tailwindcss/vite`, `vite-tsconfig-paths`, `nitro`, `@tanstack/react-start`, `@vitejs/plugin-react`). Lockfiles: both `package-lock.json` and `bun.lock` list `@lovable.dev/*`; choose one package manager (see §9). `bunfig.toml`'s `minimumReleaseAgeExcludes` lists `@lovable.dev/*` and is only relevant to bun.

**Hosting (blocks the preset choice):** the current default is Cloudflare Workers (`.output/server/wrangler.json`, `.wrangler/` exist locally). Tell me the intended host (Cloudflare, Vercel, Netlify, Node server, other) and I'll set the Nitro preset. The server function (`searchScripture`) needs a server runtime, so a static-only host will not work.

**Runtime env (host-specific, must be verified):**
- In `vite dev`, non-`VITE_` variables from `.env.local` are not guaranteed to appear in `process.env` for server functions. `AI_API_KEY` must be loaded for dev (for example via `loadEnv(mode, cwd, "")` in the config); verify with a trivial server-side check before relying on it.
- On Cloudflare Workers, secrets arrive via the env binding; `process.env` requires `nodejs_compat` plus the populate-process-env flag. Other hosts expose `process.env` directly.

**Risks (highest in this phase):** a missing plugin or alias breaks the dev server or SSR build; hot-module/SSR behaviour can change; the `server.ts` error wrapper (`server: { entry: "server" }`) must keep working; PWA service-worker generation (`/sw.js`) must be unchanged; build output location/preset determines deployability. Mitigate by doing it as its own commit, with a before/after build comparison.

**Test plan:**
1. Before: record `npm run build` output file list/size and `tsc` result (note: `.output/` and `dist/` are git-ignored; build into a temp output or accept overwrite with your approval).
2. After: `npm run dev` on the same port; all routes render, SSR and hydration without console errors; HMR works.
3. `npm run build`; `dist/`/`.output` contains `sw.js`, manifest, server bundle; preview run (`npm run preview` or the host's local emulator).
4. Server function check (`searchScripture` responds, with the key present and absent).
5. Service worker registers in a production preview and `?sw=off` still unregisters it; offline reload of a visited verse.
6. `tsc --noEmit` clean; lockfile install from scratch (`npm ci`) succeeds.

---

## 4. Preview auth-storage broker

**Where:** `src/integrations/supabase/previewAuthStorage.ts` (hard-coded Lovable origins, `postMessage` protocol `lovable-preview-auth:*`), consumed by `src/integrations/supabase/client.ts` (`storage: brokeredPreviewStorage()`).
**Behaviour off Lovable:** returns plain `localStorage` — confirmed working in your tests. It is dead weight with a Lovable origin allow-list.
**Replacement:** omit the `storage` option in `client.ts` (supabase-js default is `localStorage` in the browser) and delete the file.
**Risk:** low; only affects Lovable-editor preview embedding. **Test:** sign in, reload, sign out in two tabs; session persists; no console errors.

## 5. Telemetry hooks

- `src/lib/analytics.ts` — `trackEvent` forwards to `window.__lovableEvents?.track` (no-op outside Lovable). 15+ call sites across routes keep working if the function signature is kept.
- `src/lib/lovable-error-reporting.ts` — `reportLovableError` posts to `window.__lovableEvents` / `__lovableReportRuntimeError`; called from the error boundary in `src/routes/__root.tsx` (line 14, 47).
**Replacement:** keep `trackEvent` and rename the reporter to a neutral `reportError`. Back both with either nothing (log in dev) or a provider you choose (PostHog/Plausible for events; Sentry for errors) behind env flags such as `VITE_ANALYTICS_*`. Privacy rule in the file header (no search text, audio, camera frames) must be preserved.
**Risk:** low. **Test:** error-boundary page still renders; events fire to the chosen sink only when configured.

## 6–8. Small items

| Item | Action | Risk |
|---|---|---|
| `cron-auth.ts` (`LOVABLE_CRON_SECRET*`) — no importers | Delete | none |
| `auth-middleware.ts`, `client.server.ts` messages "Connect Supabase in Lovable Cloud." | Reword. Keep `auth-middleware.ts` (generic `requireSupabaseAuth`; useful for protecting search). `client.server.ts` (service-role) is unused: keep only if needed, otherwise delete | none |
| `auth-attacher.ts` (registered globally in `start.ts`) | Keep; generic Supabase code, not Lovable | none |
| `pwa-register.ts`: Lovable preview hostnames in the refusal list | Remove the Lovable hostnames; keep dev/iframe/`?sw=off` rules | low |
| `vite.config.ts`: `!url.pathname.startsWith("/~oauth")` | Remove with §2; consider excluding nothing else (Supabase callbacks land on the app origin as hash fragments) | low |

## 9. Documentation, repo metadata and Git sync

| Item | Action |
|---|---|
| `AGENTS.md` (Lovable block, history-rewrite warning) | Keep the warning until the sync is disconnected; then replace with project guidance |
| `README.md` (original build prompt, "Live app: verse-snap-app.lovable.app", "Build with Lovable" footer) | Replace with a real README (setup, env vars, scripts, Supabase) |
| `.lovable/` (plans, memory, `project.json`) | Archive or delete after disconnect; contains product notes you may want to move to `docs/` first |
| Lockfiles: `package-lock.json` and `bun.lock`; `bunfig.toml`; `helloao-provider.test.js` imports `bun:test` | Pick **npm or bun**; delete the other lockfile and bun config accordingly; the test file needs bun (or conversion to vitest) |
| `.gitattributes` missing (eslint reports ~10,800 CRLF errors on this checkout) | Add `* text=auto eol=lf` |
| Lovable ↔ GitHub sync | **Do not disconnect yet.** The Lovable-hosted app (`verse-snap-app.lovable.app`) is your live fallback and uses the old backend. Disconnect only after the new deployment has run clean (see §10 step 9) |
| `package.json` name `tanstack_start_ts` | Optional rename |

Git/Lovable rules during implementation: commits stay on `migration/independent-supabase`; nothing goes to `main`; no history rewrites; Lovable regenerating `src/integrations/**` is only a risk after something is pushed to the branch it tracks.

---

## 10. Safe implementation order

Each step is one reviewed commit (commits only when you ask), verified before the next.

1. **Housekeeping, zero behaviour change:** `.gitattributes`; reword Lovable error strings; delete `cron-auth.ts`. *Verify:* `tsc`, app runs.
2. **Google sign-in → Supabase** (needs your Google credentials first). *Verify:* §2 tests. Remove `src/integrations/lovable/` and `@lovable.dev/cloud-auth-js` only after it passes.
3. **Preview storage broker removal** (`client.ts` + delete file). *Verify:* session persistence.
4. **AI search → own provider** (key in `.env.local`, dev-env loading verified), `inputValidator`→`validator`, durable limit/auth decision. *Verify:* §1 tests.
5. **Telemetry neutralisation** (`reportError`, `trackEvent` backing). *Verify:* error boundary.
6. **Build config independence** (the riskiest): explicit Vite/Nitro config, remove `@lovable.dev/vite-tanstack-config`, lockfile decision. *Verify:* §3 tests, clean `npm ci` + build.
7. **PWA/hostname cleanup** and `/~oauth` rule removal. *Verify:* service worker install/update/offline.
8. **Docs:** real README, update `AGENTS.md`, move `.lovable/` notes.
9. **Deploy to your chosen host** with the new env vars from a non-`main` branch; run the full app test plan; keep the Lovable app live for ~2 weeks; then disconnect the Lovable GitHub sync, retire the Lovable project, and merge.

Why this order: user-visible features first and one at a time (so any regression has a single suspect), the risky build rewrite after the app code no longer imports anything from Lovable, and the irreversible disconnect last.

## 11. Rollback
Every step is a separate commit on the migration branch, so rollback is `git revert` of that commit (never reset or force-push). The Lovable-hosted app and the old Lovable backend remain untouched throughout. Supabase side changes (Google provider config) can be disabled in the dashboard without code changes.

## 12. What I need from you before implementation
1. **Hosting target** (Cloudflare Workers/Pages, Vercel, Netlify, Node, other) — decides the Nitro preset and env handling.
2. **AI provider choice** (my recommendation: Anthropic Claude Haiku 5.5) and confirmation you will create the key; **search access policy**: guests allowed with a durable rate limit, or sign-in required.
3. **Google OAuth:** whether you want it kept (yes assumed); you create the Google Cloud client and enable the provider in Supabase (secrets stay out of chat and Git).
4. **Package manager decision** (npm vs bun) and permission to add `lightningcss` (and optionally `@tanstack/devtools-vite`) as direct devDependencies and to remove the two Lovable packages when their step comes.
5. **Analytics/error reporting:** none for now, or a named provider.
6. Approval to start with step 1, in the order above.
