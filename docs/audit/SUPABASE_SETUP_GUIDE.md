> **Historical (2026-10-23).** Written while the app was still connected to Lovable. Lovable is retired; the current workflow is in `CLAUDE.md` and `docs/DECISIONS.md`. Kept for the record; details may be outdated.

# Verse Snap — New Supabase Dev Project: Setup Instructions

*Phase 2 preparation · nothing here has been run. Do the dashboard steps yourself; tell me when done and I'll take the next steps after you approve.*

## Before you start
- Use a Supabase account/organisation **you own** (not anything tied to Lovable).
- Have a password manager open. Never paste keys, passwords, or connection strings into chat.
- You do **not** need to touch Lovable Cloud at all.

## Part A — Create the project (Supabase dashboard)
1. Go to supabase.com/dashboard → **New project** in your organisation.
2. **Name:** `verse-snap-dev`.
3. **Database password:** use "Generate a password", save it in your password manager. (Needed later for CLI `link`/`db push`.)
4. **Region:** pick the one closest to your users/you.
5. **Security options (if shown):** keep the **Data API** enabled (the app uses it) and turn on **automatic RLS for new tables** if offered. Our migrations enable RLS explicitly regardless.
6. Click create and wait until the project status is healthy (a few minutes).
7. Record, in the password manager:
   - **Project ref** (the `abcdefghij` part of `https://abcdefghij.supabase.co`)
   - **Project URL**
   - **Publishable key** (Project Settings → API Keys; starts with `sb_publishable_`)
   - Keep the **secret / service_role key** in the password manager only. **Not needed in the app for Phase 2. Never put it in a `VITE_` variable or in Git.**

## Part B — Auth settings (Dashboard → Authentication)
1. **URL Configuration → Site URL:** `http://localhost:8080`
2. **Redirect URLs** (add all): `http://localhost:8080/**`, `http://localhost:5173/**`
   *(8080 is the dev port the Lovable Vite wrapper sets; if `npm run dev` later prints a different port, we'll add it.)*
3. **Sign In / Providers → Email:** enabled. Keep **Confirm email** ON (the UI supports it). If you'd rather skip email confirmation while developing, turn it OFF; tell me which.
4. **Password:** set the minimum length to at least 8–10; enable leaked-password protection if your plan offers it.
5. **Google:** leave disabled for now (Phase 3).
6. Don't customise SMTP yet; the built-in sender is enough for two dev accounts but is rate-limited (a few emails per hour). Be aware of this when testing sign-up and reset emails.

## Part C — What I will do after you confirm (not yet done)
These need your explicit go-ahead after you tell me the project exists.

1. **Write the corrected migration** `supabase/migrations/<timestamp>_fresh_backend_corrections.sql` per `SUPABASE_MIGRATION_PLAN.md` §3 (R1–R4 required, S1–S3 recommended). The three original migration files stay untouched.
2. **Test it on a local Supabase stack** first. This needs Docker + the Supabase CLI on your machine (I'll ask before installing anything; you may prefer to install them yourself).
3. **Apply to the dev project:** `supabase login` → `supabase link --project-ref <ref>` (asks for the DB password interactively; type it in your own terminal, not chat) → `supabase db push`.
4. **Run advisors** (security + performance) and fix anything flagged.
5. **Connect the app via env vars only** (no app-code change). Create a git-ignored `.env.local` in the project root:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   (`*.local` and `.env` are already in `.gitignore`.) You'd paste the values yourself; I will not ask for them in chat. Server-side `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` are only needed if a server function uses Supabase; none does today, so I'll leave them out.
6. **Update `supabase/config.toml`** `project_id` to the new ref (this is a config change, done when you approve the implementation step).
7. **Smoke test:** run `npm run dev`, create your two accounts, confirm email, sign in, save a verse, check history, reset password. Check the saved verse shows as saved on reload and the rows have `translation = 'KJAV'`.

## Known limitations while on the new backend (expected)
- **Google sign-in:** will fail until Phase 3 (code currently calls Lovable's broker).
- **"Describe a verse" AI search:** will say it isn't configured until Phase 4 (`LOVABLE_API_KEY` is Lovable-only).
- Everything else (reference lookup, voice, camera, reading, saved verses, history, settings) does not depend on Lovable.
- Nothing is pushed to GitHub, and the Lovable project is not modified, at any step above. A push (when you eventually approve one) must go to a branch Lovable isn't tracking, since `main` syncs into Lovable.

## Your checklist
- [ ] Supabase project `verse-snap-dev` created, status healthy
- [ ] Ref, URL, publishable key saved in password manager; DB password saved
- [ ] Auth Site URL and Redirect URLs set
- [ ] Email provider on; decision made on email confirmation (on/off)
- [ ] Docker Desktop + Supabase CLI: you install them, or tell me to proceed with instructions for installing them
- [ ] Reply with: **project ref**, **project URL**, email-confirmation choice, whether you prefer the forward-migration approach (recommended) or a squashed baseline, and whether to keep the `translations` table (seed the six editions: recommended) or drop it. Do **not** send keys or passwords.
