> **Historical (2026-10-23).** Written while the app was still connected to Lovable. Lovable is retired; the current workflow is in `CLAUDE.md` and `docs/DECISIONS.md`. Kept for the record; details may be outdated.

# Verse Snap — Environment Variables, Runtime and Deployment Audit

**No secret values were read.** Only variable *names* referenced in code are listed. No `.env` file exists in the working tree (`.gitignore` ignores `.env` and `*.local`), so how values reach the app today (Lovable-injected) is **unverified**.

## 1. Variables referenced in code
| Variable | Scope | Used in | Required? | Notes |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Browser (public) | `integrations/supabase/client.ts` | Yes for accounts | Falls back to `SUPABASE_URL`. Absent → app runs **guest-only**, logs a warning |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser (public) | `client.ts` | Yes for accounts | Publishable/anon key; safe to expose |
| `SUPABASE_URL` | Server | `client.ts` fallback, `auth-middleware.ts`, `client.server.ts` | Server fns using Supabase | |
| `SUPABASE_PUBLISHABLE_KEY` | Server | `client.ts` fallback, `auth-middleware.ts` | Only if `requireSupabaseAuth` is used (currently unused) | |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, **secret** | `client.server.ts` | Only if `supabaseAdmin` is used (currently unused) | Bypasses RLS. Never `VITE_`-prefix; never ship to client |
| `LOVABLE_API_KEY` | Server, **secret** | `lib/bible/search.functions.ts:156` | For AI search | Lovable-issued; to be replaced |
| `LOVABLE_CRON_SECRET` / `_PREVIOUS` | Server, secret | `integrations/supabase/cron-auth.ts` | No (unused) | Remove with Lovable |

Built-ins: `import.meta.env.PROD` (`pwa-register.ts`).

## 2. Proposed variable set after migration
```
# Public (browser)
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

# Server
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # only if admin code is kept; secret
AI_API_KEY=                        # replaces LOVABLE_API_KEY; secret
AI_MODEL=                          # replaces hard-coded "openai/gpt-6-astra"
AI_BASE_URL=                       # optional
# optional: ANALYTICS_*, SENTRY_DSN
```
Keep one `.env.example` (names only) in the repo, one set per environment (local / dev / prod), and store prod secrets in the host's secret manager. Cloudflare local secrets go in `.dev.vars` (already git-ignored).

## 3. Gotchas
- `client.ts` reads **both** `import.meta.env` and `process.env`; on the server the second wins when the first is empty, so a missing `VITE_*` var on a build host can silently produce guest-only mode. Add a build-time check.
- `VITE_*` values are **baked in at build time** — changing them requires a rebuild. The old Lovable values will be baked into any existing `dist/` / `.output/` (both are on disk locally and git-ignored). Rebuild before any deploy.
- New-style keys (`sb_publishable_`, `sb_secret_`) are handled by the custom fetch wrapper in the Supabase files.

## 4. Server-side runtime requirements
- Server functions (`searchScripture`) need a **server runtime**, not a static host. Current build is Nitro `cloudflare-module` (Workers). `node:crypto` is imported in `cron-auth.ts` (needs `nodejs_compat` on Workers if kept).
- Outbound HTTPS to: Supabase, `bible.helloao.org`, the AI provider, Google Fonts (`fonts.googleapis.com`/`gstatic`, loaded in `routes/__root.tsx:110–114`).
- In-memory cache/rate-limit state is per instance (see FEATURE_AUDIT #4).

## 5. Build and code-quality results (non-destructive checks run)
| Check | Result |
|---|---|
| `tsc --noEmit` | **Pass** (exit 0), strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `eslint .` | **~10,781 problems**, 10,771 of them Prettier `Delete ␍` (CRLF line endings: `core.autocrlf=true` on this Windows checkout vs LF in the repo's Prettier config), plus 9 `react-refresh` warnings. Real lint issues beyond line endings: none found. Fix: add a `.gitattributes` (`* text=auto eol=lf`) in a later commit — do not run `format`/`--fix` now |
| `npm audit --omit=dev` | **1 high**: `source-map-js` 1.0.0–1.2.1 (event-loop DoS via source-map offsets, GHSA-68fv-2mgg-jv7q); transitive, build-time tooling, low runtime exposure. Fix path: `npm audit fix` (not run) |
| `vite build` | **Not run** (would overwrite `.output/` and `dist/`) |
| Tests | `helloao-provider.test.js` (bun:test) exists; not run; no `test` script |

## 6. Dependency and supply-chain concerns
- **Two lockfiles** (`package-lock.json` 7.9k lines, `bun.lock`) can diverge; pick one. The working tree has a stash modifying `package-lock.json` (~12.7k line diff), which suggests the lockfiles are already inconsistent.
- **Pre-release / pinned-exotic versions:** `nitro@3.0.260603-beta`, `vite@8.1.5`, `@tanstack/react-start@1.168.60`, `rolldown` override `1.2.1`, `vite-plugin-pwa@^2.0.0`. Expect churn; pin and test upgrades.
- `@lovable.dev/*` packages are the only vendor-lock dependencies (see LOVABLE_DEPENDENCIES).
- `bunfig.toml` enforces a 24 h release-age guard for bun installs only; npm has no equivalent here.
- ~25 Radix packages plus unused shadcn components, `recharts`, `react-day-picker`, `embla`, `vaul`, `input-otp`, `cmdk` — likely unused weight in `node_modules` (tree-shaken from the bundle; verify with a bundle analyzer).

## 7. PWA and offline caching (`vite.config.ts`, `src/lib/pwa-register.ts`, `public/manifest.webmanifest`)
| Risk | Detail |
|---|---|
| MEDIUM | `globPatterns` precache includes `html`, but `navigateFallback: null` and pages are `NetworkFirst` with `networkTimeoutSeconds: 8` and `maxEntries: 32`: offline deep links work only for pages already visited. SSR output is not a static shell. |
| MEDIUM | `registerType: "autoUpdate"` with `NetworkFirst` is a good stale-HTML mitigation. After switching hosts, the **old service worker on existing users' devices** will keep serving from its scope on the same origin; if the production domain changes, nothing to clean up, but if the *same* domain moves hosts, verify the new `/sw.js` is served with `Cache-Control: no-cache`. |
| MEDIUM | Runtime cache for `bible.helloao.org` requires CORS-OK responses; opaque responses would be cached with padding. Not verified. |
| LOW | The OAuth path guard excludes `/~oauth` (a Lovable path); after removing Lovable OAuth, Supabase redirects land on your own origin, so also exclude `/auth/*` and any callback route from caching. |
| LOW | Manifest: `theme_color`/`background_color` `#f8f6f0` vs the runtime `<meta name="theme-color">` values `#fcfaf6` / `#161310` (`preferences.tsx`) — minor mismatch. Orientation locked to portrait. No screenshots/shortcuts. |
| LOW | `public/robots.txt` allows all crawlers; there is no sitemap. |

## 8. Deployment checklist (not to be executed yet)
1. Choose host + explicit Nitro preset.
2. Provision dev Supabase project; set env vars for dev.
3. Rebuild (`vite build`) — never reuse existing `dist/`/`.output/`.
4. Verify CSP/headers: Google Fonts, Supabase, HelloAO, AI provider, camera/microphone `Permissions-Policy`.
5. Serve `/sw.js` and `/manifest.webmanifest` with short cache lifetimes.
6. Add CI: `tsc`, lint (after line-ending fix), tests.
