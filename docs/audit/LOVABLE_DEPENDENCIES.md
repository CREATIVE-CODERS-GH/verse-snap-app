> **Historical (2026-10-23).** Written while the app was still connected to Lovable. Lovable is retired; the current workflow is in `CLAUDE.md` and `docs/DECISIONS.md`. Kept for the record; details may be outdated.

# Verse Snap — Lovable Dependencies

Every coupling found, ordered by risk. "Safe replacement" assumes the Supabase migration in `SUPABASE_MIGRATION_PLAN.md`.

| # | Dependency | Risk | Where |
|---|---|---|---|
| 1 | Lovable AI Gateway (scripture search) | HIGH | `src/lib/bible/search.functions.ts:156,163–168` |
| 2 | Lovable Cloud OAuth (Google sign-in) | HIGH | `src/integrations/lovable/index.ts`, `src/components/auth-form.tsx:7,53`, `package.json` (`@lovable.dev/cloud-auth-js`) |
| 3 | Supabase project owned by Lovable Cloud | HIGH | `supabase/config.toml` (`project_id = "pnugxqkdelknprbhejur"`), env vars |
| 4 | Build config package | HIGH | `vite.config.ts:7`, `package.json` devDep `@lovable.dev/vite-tanstack-config@2.26.5` |
| 5 | Preview auth storage broker | MEDIUM | `src/integrations/supabase/previewAuthStorage.ts`, used by `client.ts` |
| 6 | Cron secret auth (`LOVABLE_CRON_SECRET*`) | LOW (unused) | `src/integrations/supabase/cron-auth.ts` |
| 7 | Telemetry hooks | LOW | `src/lib/analytics.ts`, `src/lib/lovable-error-reporting.ts`, `src/routes/__root.tsx:14,47` |
| 8 | Service-worker preview-host refusal list | LOW | `src/lib/pwa-register.ts:16–21` |
| 9 | Error messages telling users to "Connect Supabase in Lovable Cloud" | LOW | `auth-middleware.ts`, `client.server.ts` |
| 10 | Bun config whitelisting `@lovable.dev/*` packages | LOW | `bunfig.toml` |
| 11 | Git sync with Lovable | HIGH (process) | `AGENTS.md`, `.lovable/`, `README.md:629+` |
| 12 | Hosting preset implied by wrapper (Cloudflare) | MEDIUM | `.output/nitro.json`, `.output/server/wrangler.json` |

## 1. AI Gateway — HIGH
- **What:** `askForCandidates()` POSTs to `https://ai.gateway.lovable.dev/v1/responses` with headers `Lovable-API-Key` and `X-Lovable-AIG-SDK`, model `openai/gpt-6-astra`, using the OpenAI Responses-API shape with a strict JSON schema and SSE streaming (`readStream`).
- **Key:** `LOVABLE_API_KEY`, read from `process.env`, server-only. It is Lovable-issued and will not be portable.
- **Replace:** pick a provider you own a key for (the request shape is already Responses-style; Anthropic or OpenAI both work). Put base URL, model and key in env vars (`AI_API_KEY`, `AI_MODEL`, optional `AI_BASE_URL`) and rewrite only `askForCandidates` + `readStream`. The rest of the pipeline is provider-neutral: the model returns references only, and text is re-fetched from HelloAO. Because this is a **client-visible cost** endpoint, add auth or a durable rate limit at the same time.
- **Safe rollout:** keep the existing graceful `failed: true` path; deploy with the new key in dev first and test with the prompts in `.lovable/plan/phase-6-natural-scripture-search-2026-09-10.md`. Rollback = unset `AI_API_KEY` (feature disables itself).

## 2. Lovable Cloud OAuth — HIGH
- **What:** `lovable.auth.signInWithOAuth("google")` uses Lovable's hosted broker (`/~oauth` path is also special-cased in the service worker `vite.config.ts`), then hands tokens to `supabase.auth.setSession`.
- **Replace:** configure the Google provider in your own Supabase project (your Google Cloud OAuth client ID/secret; authorised redirect URI = `https://<ref>.supabase.co/auth/v1/callback`), then call `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`. Delete `src/integrations/lovable/` and the package.
- **Caveat — account linking:** users who signed in with Google via Lovable have identities in the *old* project. See the migration plan: Google users can't be password-exported; they re-link by matching **verified email** on first sign-in to the new project. Make sure "Link accounts with same email" behaviour is understood before cutover.

## 3. Lovable-owned Supabase backend — HIGH
- The repo contains only `project_id` and migrations. The live DB, users, auth settings, and any secrets live in Lovable Cloud. **Do not assume the repo has them.** See the migration plan for how to obtain a dump (Lovable provides project export / you can request database access; confirm in the Lovable dashboard).
- Env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` currently point at it (values not inspected).

## 4. `@lovable.dev/vite-tanstack-config` — HIGH
- **What it injects** (per the comment in `vite.config.ts`): TanStack devtools, `tanstackStart`, `viteReact`, Tailwind, tsconfig-paths, nitro (Cloudflare default), `VITE_*` env injection, `@` alias, React/TanStack dedupe, Lovable error-logger plugins, sandbox detection.
- **Replace:** write a plain `vite.config.ts` with `tanstackStart()`, `@vitejs/plugin-react` (already a devDep), `@tailwindcss/vite` (dep), `vite-tsconfig-paths` (dep), `nitro()` with an **explicit** preset, plus `VitePWA`. Verify with `vite build` and diff `.output`. Do this as a separate, reviewed commit after the DB cutover, not at the same time.
- Bun's `minimumReleaseAgeExcludes` lists `@lovable.dev/mcp-js`, `email-js`, `webhooks-js` too; those aren't dependencies today (only a hint of Lovable features that could be added).

## 5. Preview auth storage broker — MEDIUM
- `previewAuthStorage.ts` posts the Supabase session to `lovable.dev` ancestors when embedded in the Lovable editor preview; otherwise it returns `localStorage`. It is *inert* on your own domain, but it is generated code with a hard-coded Lovable origin allow-list. Replace with plain `localStorage` (the Supabase default) and remove the import when you detach.

## 6–10. Low-risk items
- **Cron auth** unused; delete with `client.server.ts` only if you confirm no server code will need the service-role client. If you add scheduled jobs later, use Supabase `pg_cron` / Edge Functions or your host's cron.
- **Telemetry:** `window.__lovableEvents` / `__lovableReportRuntimeError` only exist inside Lovable preview. Replace with a thin `trackEvent` adapter (PostHog/Plausible) and an error reporter (Sentry) behind env flags.
- **Service-worker refusals:** keep the `?sw=off` kill switch; prune the Lovable hostnames afterwards.
- Update error strings that say "Connect Supabase in Lovable Cloud".

## 11. GitHub ↔ Lovable synchronization — HIGH (process)
`AGENTS.md` states commits on the connected branch sync into Lovable and history rewrites are destructive. This audit found:
- Remote is `https://github.com/CREATIVE-CODERS-GH/verse-snap-app.git`, default branch `main`; you are on local branch `migration/independent-supabase` (not yet verified pushed).
- Lovable syncs the branch it is connected to (assumed `main`). **Pushing to `main` changes the running Lovable app** and, because backend config is Lovable-managed, may break the *current* production app if env vars/auth are changed in the same commit.
- Hand-edited "auto-generated by Lovable" files (`src/integrations/**`) can be **overwritten** if Lovable regenerates them while the project is still connected.
- **Plan:** (a) do all migration work on a branch Lovable is not tracking; (b) cut over with a final merge to `main`; (c) afterwards disconnect Lovable (project settings → GitHub) so it can no longer regenerate files; (d) never force-push or rebase pushed commits.

## 12. Hosting
- The wrapper defaults Nitro to the `cloudflare-module` preset, and `.wrangler/` / `.output/server/wrangler.json` exist locally. If you deploy elsewhere (Vercel, Netlify, Node), set the preset explicitly. Cloudflare Workers also constrains Node APIs (`node:crypto` is used in `cron-auth.ts`).
