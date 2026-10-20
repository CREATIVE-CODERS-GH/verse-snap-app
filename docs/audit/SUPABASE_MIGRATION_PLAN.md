# Verse Snap — Supabase Migration Plan (revised)

**Revision 2 — 2026-10-19.** Supersedes the original plan. *Proposal only; nothing has been executed.*

## Confirmed decision
The Lovable Cloud project has only **two test users**. **No users, password hashes, OAuth identities, saved verses, or history will be migrated.** Both accounts will be recreated by hand in the new project. This is a **fresh, independently owned Supabase backend**, not a data migration.

Consequences, all resolved by this decision:
- No export from Lovable Cloud, no `auth` schema restore, no user-ID preservation or remapping.
- No `KJV`→`KJAV` data backfill or unique-key collision handling. The mismatch is fixed at the schema level only (§3).
- The `handle_new_user` trigger import-order hazard no longer applies.
- Rollback is simple: the Lovable project stays untouched and running; there is no data to reconcile.
- [`DATA_MIGRATION_DISCOVERY.md`](DATA_MIGRATION_DISCOVERY.md) is retained as reference only; its export/auth-user sections are **not part of the plan**. Its §1 (schema/RLS documentation) and §8 (KJV facts) remain accurate.

What still matters from the original plan: correct schema, secure RLS, auth/redirect configuration, replacing Lovable-only integrations, testing, and a clean cutover that doesn't break the current Lovable-hosted app.

## Phases
| Phase | Scope | Status |
|---|---|---|
| 1 | Discovery | Done; simplified by the decision above |
| **2** | **Create own dev Supabase project; apply corrected schema; connect app via env vars only** | **Next (awaiting project creation)** |
| 3 | Replace Google OAuth (Lovable broker → Supabase native) | Later |
| 4 | Replace AI gateway (`LOVABLE_API_KEY`) with own provider; rate limiting | Later |
| 5 | Remove Lovable packages/telemetry/preview storage; explicit Nitro preset and hosting | Later |
| 6 | Production Supabase project, domain, SMTP, cutover, disconnect Lovable sync | Later |

Setup steps for Phase 2 are in [`SUPABASE_SETUP_GUIDE.md`](SUPABASE_SETUP_GUIDE.md).

## 1. Known facts from the repo
- Lovable-managed project ref (to be abandoned): `pnugxqkdelknprbhejur` (`supabase/config.toml`).
- Tables `profiles`, `translations`, `saved_verses`, `history`; trigger `on_auth_user_created`. (`supabase/migrations/20260910*.sql`)
- RLS enabled on all four; `anon` can only `SELECT` from `translations`.
- Browser talks to tables directly under RLS; no Edge Functions, Storage, or service-role usage in the repo.
- No server code uses Supabase today, so `SUPABASE_*` server variables are optional for now.

## 2. Environments
1. **Dev:** new Supabase project in an account/org you own (`verse-snap-dev`). Used for all work until Phase 6.
2. **Prod:** separate project, created in Phase 6. Never reuse dev as prod.
3. Lovable Cloud project: left **unmodified** as the live fallback.

## 3. Schema: corrections required before applying
The three existing migrations are valid SQL for a fresh database, but they encode a stale default and miss some hardening. Because there is no data, the corrections are simple. **Recommended approach: leave the three original files untouched and add one forward migration** (`supabase/migrations/<timestamp>_fresh_backend_corrections.sql`). The originals are synced with Lovable and match the version history of the old project; editing them would create confusing drift. (Alternative: squash into a single clean baseline. It's tidier, but diverges from Lovable's history. Not recommended while Lovable is connected.)

### Required
| # | Correction | Why |
|---|---|---|
| R1 | `profiles.translation`, `saved_verses.translation`, `history.translation`: `SET DEFAULT 'KJAV'` | App catalogue code is `KJAV` (`src/lib/bible/translations.ts`); `'KJV'` default would recreate the mismatch for every new row that omits the column |
| R2 | `translations`: delete the `KJV` seed row; insert the six real editions (`KJAV`, `BSB`, `WEB`, `ASV`, `BBE`, `FBV`) with names and `sort_order` from `translations.ts` | Seed is stale; app currently ignores the table but it must not contradict the code. (Alternative: drop the table, since it is unused. Recommend keep and seed; zero app impact.) |
| R3 | Replace `handle_new_user()` with `SET search_path = ''` and schema-qualified names (`public.profiles`, `auth.users` fields) | Supabase security guidance for `SECURITY DEFINER`; current `search_path = public` is acceptable but weaker. Keep EXECUTE revoked (re-apply the REVOKE after `CREATE OR REPLACE`) |
| R4 | Update RLS policies to `(select auth.uid())` instead of `auth.uid()` | Per-statement caching; performance advisor will flag the current form |

### Recommended
| # | Correction | Why |
|---|---|---|
| S1 | Add `UNIQUE (user_id, translation, book_id, chapter, verse)` to `history` | Prevents duplicate history rows (current code does non-atomic delete-then-insert). Safe on an empty table. Existing `recordView` keeps working; a later app change can use one upsert |
| S2 | `BEFORE UPDATE` trigger setting `profiles.updated_at = now()` | Column exists but never changes |
| S3 | `CHECK` constraints: `chapter > 0`, `verse > 0`, `text_size in ('small','medium','large','xlarge')`, `theme in ('light','dark','system')`, `char_length(verse_text) <= 4000` | Matches `TextSize`/`Theme` types in `preferences.tsx`; limits junk rows |
| S4 | Optional FK `translation → translations(code)` on the three tables | Only after R2; prevents bad codes. Skip if you want new editions without a DB change |
| S5 | Add an explicit `DROP POLICY IF EXISTS` + recreate pattern so the migration is re-runnable on local stacks | Housekeeping |

### Not changing
- Table/column names (the app depends on `book_id`, `book_name`, `verse_text`, `created_at`, `viewed_at`).
- RLS model (own-row only, `authenticated` role). Grants from the third migration are correct.
- `ON DELETE CASCADE` from `auth.users`.

### Rejected
Index changes (existing `(user_id, created_at DESC)` and `(user_id, viewed_at DESC)` match the queries in `library.ts`).

### Applying them
1. First on a **local Supabase stack** (Docker): `supabase db reset` applies the three originals plus the new migration from scratch.
2. Run the Supabase advisors against the **dev project** after applying.
3. Apply to the dev project with `supabase db push` (after `link`). **Not to be done until you confirm the project exists and approve.**

## 4. Authentication configuration (dev)
- Create the two test accounts through the app's normal sign-up after env vars are connected.
- **Site URL:** `http://localhost:8080` (the dev port set by the Lovable Vite wrapper; confirm with `npm run dev` output, otherwise Vite's default `5173`).
- **Redirect allow-list:** `http://localhost:8080/**`, `http://localhost:5173/**`, and later the dev/preview deploy URL. Required for confirm-email links (`emailRedirectTo: window.location.origin`) and `/reset-password` (`resetPasswordForEmail`).
- **Email confirmation:** keep ON (matches the UI "Check your email" flow) unless you want to speed up dev testing; if turned off, `signUp` returns a session immediately and the UI handles that too.
- **SMTP:** the built-in sender is heavily rate-limited and for testing only; with two accounts it is fine for dev. Custom SMTP is required for production (Phase 6).
- **Google:** disabled for now. The current app code still calls the Lovable broker, so the Google button will not work against the new project until Phase 3, when it moves to `supabase.auth.signInWithOAuth`.
- Password policy: raise minimum length; enable leaked-password protection if available on your plan. Enable CAPTCHA before production.

## 5. Backend integrations
| Integration | Plan |
|---|---|
| Supabase client (`client.ts`) | Only env vars change in Phase 2. No code change needed: it already reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`, supports new `sb_publishable_` keys, and falls back to guest-only when unset |
| Google OAuth | Phase 3 (own Google Cloud OAuth client; redirect `https://<ref>.supabase.co/auth/v1/callback`) |
| AI search | Phase 4. Until then, search returns "Scripture search is not configured." locally (expected, graceful) |
| Service-role client / cron auth | Unused; decide in Phase 5 |
| Analytics/errors | Phase 5, optional |

## 6. Security review of the schema
Keep: RLS on all tables; own-row policies; `anon` has no access except reading `translations`; trigger function not executable by API roles.
Check after applying (advisors + tests): another user and `anon` see zero rows; no table is accidentally exposed; no `service_role` key in any `VITE_*` variable. Note `library.ts` relies on RLS alone for `isSaved`/`unsave`/`removeSaved`, which is correct only while RLS stays on, so add a regression test later.

## 7. Testing (dev)
1. Local stack: migrations apply from empty with no errors.
2. RLS: two users + anon (SQL or app-level).
3. App → dev project: sign-up (+confirm), sign-in, sign-out, password reset, save/unsave, history, settings. Guest localStorage data is **not** merged into accounts (existing behaviour; product decision for later).
4. Verify a `KJAV` save shows as saved on re-open, and no `KJV` values appear in new rows.
5. Advisors (security + performance) clean.

## 8. Cutover (Phase 6, later)
1. Build prod project with the same migrations; configure auth, SMTP, redirects, Google.
2. Deploy from a branch Lovable isn't tracking, with prod env vars.
3. Smoke-test; switch the domain.
4. Disconnect Lovable's GitHub sync only after the new stack is stable.

## 9. Rollback
Because no data is migrated, rollback is configuration only: redeploy the previous commit/build with the old env vars (revert; never force-push, per `AGENTS.md`). The Lovable project remains untouched until you decide to retire it. Anything created in the new project after cutover (a few test accounts) is disposable.

## 10. Risks (ranked, revised)
1. **Lovable regenerating `src/integrations/**` or syncing a push to `main`** while still connected: do all work on a branch Lovable isn't tracking, and don't push until you approve.
2. **Redirect/Site URL misconfiguration** breaking confirm and reset emails.
3. **Default SMTP limits** (production only).
4. **Google sign-in unavailable** on the new backend until Phase 3.
5. **AI search unavailable** locally until Phase 4.
6. **Keys leaking:** the `service_role` key must never be put in a `VITE_*` variable or committed.
