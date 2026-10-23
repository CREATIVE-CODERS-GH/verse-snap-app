> **Historical (2026-10-23).** Written while the app was still connected to Lovable. Lovable is retired; the current workflow is in `CLAUDE.md` and `docs/DECISIONS.md`. Kept for the record; details may be outdated.

# Verse Snap — Phase 1: Data Migration Discovery

*Date: 2026-10-19 · Status: discovery only. No production connection, no export, no SQL executed, no code or packages changed. Repo facts come from `supabase/migrations/*.sql` and `src/`. Lovable and Supabase process claims come from web research and are marked **[verify]** where I could not confirm them against Lovable's own documentation.*

---

## 1. Schema, RLS, relationships and auth dependencies (from the repo)

Three migrations, all generated 2026-09-10: `20260910193800_…` (schema), `20260910193809_…` (revoke on trigger function), `20260910220243_…` (grant clean-up).

### Tables
| Table | Columns (key ones) | Keys / constraints | Indexes |
|---|---|---|---|
| `public.profiles` | `id` uuid PK → `auth.users(id)` ON DELETE CASCADE; `display_name`; `translation` default `'KJV'`; `text_size` default `'medium'`; `theme` default `'system'`; `created_at`, `updated_at` | PK = FK to auth user | PK only |
| `public.translations` | `code` text PK, `name`, `language` default `'English'`, `sort_order` | seeded with one row: `KJV` | PK only |
| `public.saved_verses` | `id` uuid PK default `gen_random_uuid()`; `user_id` → `auth.users(id)` CASCADE; `translation` default `'KJV'`; `book_id`, `book_name`, `chapter`, `verse`, `verse_text`; `created_at` | `UNIQUE (user_id, translation, book_id, chapter, verse)` | `(user_id, created_at DESC)` |
| `public.history` | same shape as saved_verses but `viewed_at`; **no unique constraint** | PK on `id` | `(user_id, viewed_at DESC)` |

### Relationships
`auth.users` 1—1 `profiles`; `auth.users` 1—N `saved_verses`; `auth.users` 1—N `history`. All three are `ON DELETE CASCADE`, so deleting a user deletes their rows. `translations` has no relationships. Note that `translation` columns are free text and are **not** foreign keys to `translations.code`.

### Trigger / function
`on_auth_user_created` (AFTER INSERT on `auth.users`) → `public.handle_new_user()`, `SECURITY DEFINER`, `search_path = public`, inserts a `profiles` row (`ON CONFLICT DO NOTHING`), EXECUTE revoked from PUBLIC/anon/authenticated.
**Migration consequence:** when users are restored into `auth.users`, this trigger fires and creates empty profile rows, which can collide with, or be overwritten by, the imported `profiles` data. Import order and trigger handling must be planned (see §7).

### RLS and grants
| Table | RLS | Policy | Grants |
|---|---|---|---|
| `profiles` | on | "Users can manage their own profile": ALL, `authenticated`, `auth.uid() = id` (USING + WITH CHECK) | `authenticated`: S/I/U/D; `service_role`: ALL; `anon`: none |
| `saved_verses` | on | ALL, `authenticated`, `auth.uid() = user_id` | same |
| `history` | on | ALL, `authenticated`, `auth.uid() = user_id` | same |
| `translations` | on | SELECT for `anon, authenticated`, `true` | `anon`/`authenticated`: SELECT; `service_role`: ALL |

### Auth dependencies in app code
- Client uses the publishable key with `persistSession` and `autoRefreshToken` (`src/integrations/supabase/client.ts`).
- Email+password sign-up/in, `resetPasswordForEmail` → `/reset-password`, `updateUser({password})` (`auth-form.tsx`, `reset-password.tsx`).
- Google via Lovable broker then `supabase.auth.setSession(tokens)` (`src/integrations/lovable/index.ts`). This is the **only** Lovable-specific identity path.
- `library.ts` reads and writes `saved_verses` / `history` straight from the browser, relying on RLS. Row IDs are never referenced elsewhere (no other tables point at them), so UUIDs of saved/history rows are free to change; **only `auth.users.id` must be preserved**.
- Nothing in the repo uses Storage, Edge Functions, Realtime, or custom auth hooks. **Verify** none exist live (§5).

### Observed repo issues relevant to migration
1. `KJV` vs `KJAV` mismatch (§8).
2. `profiles` and `translations` are never read by the app. Data in them is low value but should still be preserved.
3. `history` has no unique key, and `recordView` does delete-then-insert, so duplicates are possible in live data.
4. `profiles.updated_at` has no update trigger.

---

## 2. How the Lovable Cloud database can be exported

Lovable Cloud is a managed Supabase backend. I found conflicting information, so **which route is available to you must be confirmed in your dashboard first**.

| Route | What it gives | Status |
|---|---|---|
| **A. Native Cloud export / migration in the Lovable UI** (Cloud tab → export/transfer) | Reportedly an export that includes auth users with password hashes and identities **[verify]**. A third-party guide (v4.0.2, July 2026) says Lovable added Export/Pause/Remove buttons; an older guide says passwords could not be exported. I could not confirm either against Lovable docs. | Check dashboard |
| **B. Open-source exporter (Dreamlit "Lovable Cloud to Supabase exporter")** | Moves tables, users and storage into a new Supabase project using `pg_dump`/`psql`; needs a destination connection string, a temporary key, and a helper edge function deployed on the Lovable side **[verify]** | Third-party; treat with caution, read the code first, never paste secrets into a hosted tool you do not trust |
| **C. Manual: table export + Auth Admin API** | `saved_verses`, `history`, `profiles` as CSV/JSON via the Cloud database viewer; users re-created through `auth.admin.createUser` | Fallback; can't carry password hashes unless you can read `auth.users.encrypted_password` |
| **D. Direct Postgres connection string** | Full `pg_dump` of `public` + `auth` | Only if Lovable exposes the DB password/connection info for this project **[verify]**. Lovable Cloud may not expose it. |

Sources: [Dreamlit exporter](https://dreamlit.ai/tools/lovable-cloud-to-supabase-exporter), [Dreamlit blog](https://dreamlit.ai/blog/why-we-built-an-open-source-lovable-cloud-exporter), [community migration guide](https://cdn.jsdelivr.net/gh/CarolMonroe22/lovable-cloud-to-supabase-migration@main/SKILL.md), [Supabase: migrating auth users](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects). These are third-party except the Supabase page.

**Recommendation:** try A first. If A exports a full Postgres dump that includes the `auth` schema, we can restore it into our own project and keep users, hashes, identities and UUIDs. If only B or C is available, the options in §4 apply.

### Dataset to export (whichever route)
`auth.users`, `auth.identities`, `public.profiles`, `public.saved_verses`, `public.history`, `public.translations`, plus a schema-only dump (§5).
Expect the `auth.users` metadata to include `raw_user_meta_data`, `raw_app_meta_data`, `email_confirmed_at`, `created_at`, `last_sign_in_at`, and provider info.

---

## 3. Access and credentials needed (without sharing them in chat)

You'd need, depending on route:
1. **Lovable account** with owner/admin rights on the project (the project ID in the Lovable URL; the repo's `supabase/config.toml` ref is `pnugxqkdelknprbhejur`).
2. **Lovable Cloud tab access** (to see Database, Users, Settings, Secrets, and any Export button).
3. For route D only: the **database connection string / password** of the Lovable Cloud project, if exposed.
4. **A new Supabase account/organisation you own**, with a dev project created (project ref, DB password, URL, keys). I need only the project **ref and URL**, never keys.
5. **Local tools** on your machine (to be installed by you, not me, at an approved later phase): Supabase CLI, PostgreSQL client tools (`pg_dump`, `psql`; versions must match or exceed the source server's), Docker for a local rehearsal stack.
6. A secure place for dumps: encrypted disk or password-manager attachment; **never the Git repo**, never chat.

**Safe-handling rules**
- Secrets and connection strings: keep them in environment variables or a password manager, and never paste them here. I will ask you to run commands locally and share only sanitised output (row counts, schema diffs without data).
- Export files contain emails and password hashes: treat as production secrets. Do not commit (`.gitignore` ignores `.env` and `*.local`; add a `backups/` ignore before creating any dump folder).
- Use a **read-only** role where possible for the dump.
- Take the export from a **quiet window**; consider pausing sign-ups during the final export.

---

## 4. Auth user migration: limitations and options

### What Supabase supports
Supabase documents that the whole `auth` schema, including hashed passwords, can be moved between projects so users **do not need to reset passwords**, either from a full `.backup` file or via `pg_dump`/`psql`. ([Supabase guide](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)). Password hashes (bcrypt) are portable between Supabase projects.

### Option matrix
| Option | Passwords | OAuth (Google) | User IDs | Sessions | Needs |
|---|---|---|---|---|---|
| **1. Full `auth` + `public` restore from a Lovable-provided dump** | Preserved | Preserved (rows in `auth.identities`) | Preserved | Invalidated unless JWT secret reused | Native export (A) or DB access (D) |
| **2. Admin API re-creation with exported `auth.users` incl. hashes** | Preserved if `encrypted_password` is included; the admin API accepts a `password_hash` **[verify against current docs]** | Must re-create identities, or users sign in with Google and link by verified email | Preserved (`id` can be supplied) | Invalidated | Export containing hashes |
| **3. Export without hashes (emails only)** | **Not preserved**: send password-reset emails to everyone; Google users unaffected | Link by email | Preserved if you supply `id`, else mapping table | Invalidated | User list only |
| **4. Fresh start** | Lost | Lost | New | n/a | Nothing. Last resort only. |

### Per-identity-type analysis
- **Email+password users:** Option 1 or 2 keeps their passwords. Without hashes (Option 3) they stay recoverable through "forgot password" (the reset flow already exists), which is a **soft re-activation, not re-registration**. Their data stays attached if the UUID is preserved.
- **Google users (via Lovable's managed OAuth):** there's no password. Their `auth.identities` row stores Google's account ID (`provider_id`). Google's account identifier (`sub`) is, as far as I know, the same across OAuth clients for one Google account, so a preserved identity row should keep working after we switch to our own Google OAuth client. **[verify in rehearsal with a real test account.]** If identities can't be moved, the fallback is first-sign-in linking by **verified email**, which creates a user with a **new UUID** and therefore needs the `old_user_id → new_user_id` remap of their rows.
- **User IDs:** preserving `auth.users.id` is the single most valuable property: `saved_verses.user_id`, `history.user_id` and `profiles.id` all depend on it and need no rewriting. If IDs change, a mapping table and an `UPDATE … FROM mapping` run (in a transaction, rehearsed) is needed.
- **Sessions/JWT secret:** every project has its own JWT secret, so existing sessions stop working after cutover and users sign in again. Reusing the old secret keeps tokens valid but regenerates keys and isn't available/advisable for a Lovable-managed secret; I recommend accepting a one-time sign-out ([Supabase guide](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)).
- **Unconfirmed emails, banned users, MFA factors:** check whether any exist (`auth.mfa_factors`, `banned_until`, `email_confirmed_at IS NULL`); the app has no MFA UI, so MFA is likely none.
- **Provider `app_metadata`:** `raw_app_meta_data.provider(s)` must remain consistent with `auth.identities`.

### Decision rule
1. Native export contains `auth` with hashes → Option 1.
2. Else if any route yields `auth.users` with `encrypted_password` + `auth.identities` → Option 2.
3. Else Option 3 (password reset mails + email-linked Google), still preserving UUIDs by supplying `id` in `createUser`.
4. Option 4 is not recommended.

I have **not** concluded users must re-register; at worst they need a password reset.

---

## 5. Does the live schema differ from the repo migrations?

The repo is evidence only of what Lovable *generated*; the live DB may have drifted (manual SQL, later Lovable edits, un-committed changes). Read-only checks for **you** to run, or for me to review the output of:

1. **Migration history:** `select * from supabase_migrations.schema_migrations order by version;` and compare versions with the three files. Missing or extra versions mean drift.
2. **Schema-only dump of live** (`pg_dump --schema-only --schema=public --no-owner --no-privileges`) vs. a schema-only dump of a **local** database built from the three migrations; compare with `diff` or `supabase db diff`. Review differences in tables, columns, defaults, constraints, indexes.
3. **Policies:** `select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public';`
4. **Grants:** `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' order by 1,2,3;`
5. **Functions/triggers:** `pg_proc` for `public` functions and `pg_trigger` for non-internal triggers (including on `auth.users`).
6. **Extensions and jobs:** `select * from pg_extension;`, `cron.job` if `pg_cron` exists.
7. **Extra objects:** storage buckets (`storage.buckets`), edge functions, secrets list (names only), realtime publications, views.
8. **Auth config:** screenshot of Site URL, redirect URLs, providers, email-confirmation setting, SMTP, templates.
9. **Row counts and distributions** (§8 queries).

All are `SELECT`-only or `--schema-only`. I did **not** run any of these. Expected result if there is no drift: the 4 tables, 3 policies + 1 translations policy, 1 function, 1 trigger, nothing else beyond Supabase defaults.

---

## 6. Backup, verification, rehearsal and rollback strategy

### 6.1 Backups (before anything else)
1. **Two independent copies** of the final export (route-native file + `pg_dump`/CSV where possible), stored encrypted, one off-machine.
2. Record **checksums** (SHA-256) of each file and the date/time and source.
3. Schema-only dump kept separately and compared to the repo.
4. **Never operate on the only copy.** Rehearse on a copy.
5. Keep the Lovable project, its data and the live app **unchanged and running** throughout.

### 6.2 Source baseline (the numbers to match later)
Total and per-user counts for `auth.users`, `auth.identities` (by provider), `profiles`, `saved_verses`, `history`, `translations`; min/max timestamps; `count(distinct user_id)` per table; orphan checks (`saved_verses.user_id` not in `auth.users`); number of users with `email_confirmed_at is null`; duplicates in `history` by (user, translation, book, chapter, verse); distinct `translation` values (§8).

### 6.3 Rehearsal
1. **Local Supabase stack** (Docker): apply the three migrations from scratch → proves the repo schema is self-consistent.
2. **Restore the export into the local stack or a throwaway dev project**, not production. Handle the trigger issue (§7).
3. Compare against the baseline; run RLS tests (two users, anon).
4. Point a **dev build** of the app at the dev project; sign in with a migrated password user, a migrated Google user, a new sign-up, a reset email; save/unsave and view history.
5. Record problems; fix scripts; **repeat until a rehearsal is clean twice**.
6. Rehearse the **KJV→KJAV** update and the rollback (§6.5).

### 6.4 Verification checklist after any import
- [ ] Row counts equal the baseline in every table.
- [ ] Per-user counts equal for a sample (≥20 users, including heaviest users and all Google users).
- [ ] `auth.identities` count by provider equal.
- [ ] No orphan `user_id`s; FKs valid.
- [ ] A password user can log in with the *old* password (Option 1/2).
- [ ] A Google user can log in and sees their old saved verses (same UUID).
- [ ] RLS: user A cannot read user B (use two real test accounts); `anon` gets nothing.
- [ ] `profiles` row exists for every user; no duplicate or default overwrites.
- [ ] `translation` values all resolve through `resolveTranslation`.
- [ ] Supabase advisors (security/performance) clean or accepted.

### 6.5 Rollback
- **Before cutover:** nothing to roll back; the old stack is untouched.
- **Cutover design:** the app's Supabase URL/keys are env vars. Rolling back = redeploy the previous build / env vars pointing at the Lovable project, and restore DNS. Revert via a new commit; **never force-push or rewrite pushed history** (AGENTS.md).
- **Data written after cutover** exists only in the new DB: before rolling back, export the delta (rows with `created_at`/`viewed_at` after cutover time) so it can be replayed.
- Keep the Lovable project for at least ~2 weeks after cutover.
- Users are signed out in either direction (different JWT secrets), which is expected.
- **Go/no-go gates:** rehearsal clean twice; baseline matches; test users succeed; backups verified restorable (actually restore one).

---

## 7. Import-order hazards to design for
1. **`handle_new_user` trigger** fires on inserting into `auth.users` and will create default `profiles` rows. Plan either to disable the trigger during the restore and re-enable after, or restore `profiles` afterwards with an upsert (`ON CONFLICT (id) DO UPDATE`). Decide in the rehearsal.
2. `saved_verses` / `history` have FKs to `auth.users`, so users must be loaded first.
3. If a native/`pg_dump` restore includes the `auth` schema, expect permission issues on a hosted project (restoring `auth` needs elevated roles); the Supabase guide covers this. **Rehearse.**
4. Fix `translation` codes **after** import and verification of counts, in a separate, reversible step (§8).
5. Do not apply the repo migrations on top of a restore that already contains the tables (use one or the other).

---

## 8. `KJV` vs `KJAV` mismatch

**Facts**
- Migrations: `saved_verses.translation`, `history.translation`, `profiles.translation` default `'KJV'`; `translations` seeds `KJV`.
- App: catalogue code is `KJAV` (`src/lib/bible/translations.ts`); `resolveTranslation("KJV")` maps to `KJAV`; `preferences.tsx` maps stored `KJV` → `KJAV` for local settings. A unit test asserts "preserves existing KJV links".
- Writes since the rename use `verse.translation` (the app's code, probably `KJAV`); `library.isSaved` and `unsave` filter with exact `.eq("translation", translation)`.
- **So the live DB likely contains both `KJV` and `KJAV` rows.** A user who saved John 3:16 as `KJV` and views it as `KJAV` sees "not saved", cannot unsave it, and can save a second copy. Records in `history` can show duplicate verses.

**Discovery query (read-only, yours to run):**
```sql
select 'saved_verses' t, translation, count(*) from public.saved_verses group by 2
union all select 'history', translation, count(*) from public.history group by 2
union all select 'profiles', translation, count(*) from public.profiles group by 2;
```
Collision check (would a `KJV→KJAV` update violate the unique key?):
```sql
select a.user_id, a.book_id, a.chapter, a.verse
from public.saved_verses a join public.saved_verses b
  on a.user_id=b.user_id and a.book_id=b.book_id and a.chapter=b.chapter and a.verse=b.verse
 and a.translation='KJV' and b.translation='KJAV';
```
**Proposed fix (a later phase, in a forward migration, rehearsed first, not now):**
1. For `saved_verses`: delete the `KJV` row where a `KJAV` twin exists (keep earliest `created_at`), then `UPDATE … SET translation='KJAV' WHERE translation='KJV'`.
2. For `history`: de-duplicate (keep latest `viewed_at`) then update.
3. For `profiles`: update to `KJAV`; change column defaults to `'KJAV'`.
4. Update/replace the `translations` seed with the six real editions (or remove the table).
5. Optionally add a `CHECK` or FK to `translations(code)` once data is clean.
6. Keep the app's `KJV→KJAV` alias for old shared links.
Do the update on the **new** database after import verification, so the source dump stays pristine and the change is reversible by restoring the verified import.

---

## 9. Practical checklist for you

### A. In the Lovable dashboard (read-only, nothing to change)
- [ ] Open the project → **Cloud** tab. Note which of these exist: **Export**, **Database** (table viewer), **Users**, **Secrets**, **Settings**; any "Transfer/Migrate to Supabase" option.
- [ ] If an **Export** button exists, **don't click it yet.** Take a screenshot of what it says it includes (auth users? password hashes? storage?).
- [ ] Open **Users**: note the user count and how many sign in with Google vs email (no emails in the screenshot you share).
- [ ] Open **Database → Tables**: confirm the tables are only `profiles`, `translations`, `saved_verses`, `history`. List any others and any storage buckets or edge functions.
- [ ] Open **Auth settings**: screenshot Site URL, redirect URLs, providers, email confirmation, and SMTP/email template customisation.
- [ ] Check whether Lovable offers a **database connection string or SQL editor** for this project.
- [ ] Check plan/billing limits that might affect export.
- [ ] Confirm which **GitHub branch** Lovable is connected to, and the published URL(s).

### B. On your side
- [ ] Create a **Supabase account/org you own** and a dev project (`verse-snap-dev`). Share only the **project ref and URL**.
- [ ] Decide a maintenance window and whether sign-ups can be paused briefly at final export.
- [ ] Plan secure storage for the export (encrypted folder + password manager).
- [ ] When we reach the rehearsal phase: install Supabase CLI, PostgreSQL client tools and Docker yourself (I won't install anything without approval).

### C. What I need from you (no secrets)
1. Which export route(s) the dashboard actually offers (screenshot or description from A).
2. Whether the export includes auth users and password hashes, as stated by Lovable's UI/docs.
3. Approximate user count, and the Google vs email split.
4. Whether a SQL editor / read-only query access exists, and, if so, the **output** (not data) of §5 checks 1–7 and the §8 translation-count query.
5. List of tables/buckets/functions beyond the four known.
6. Auth settings summary (Site URL, redirects, providers, confirmation on/off, SMTP).
7. The new dev project ref and URL once created.
8. Your tolerance for **forced re-sign-in** (expected) and for a **password reset email** if hashes can't be exported.
9. Production domain plans (same domain, or new one?) and the Lovable-connected branch name.
10. Approval for the next phase: building the local rehearsal environment and writing (not running) the forward migration scripts.

### Never share in chat
Database passwords, connection strings, service-role keys, JWT secrets, API keys, or any export file or its contents.

---

## 10. Open questions and unverified claims
- Whether Lovable Cloud currently provides a native export including auth hashes **[unverified; conflicting third-party sources]**.
- Whether Lovable exposes direct Postgres credentials **[unverified]**.
- Whether Google `sub` carries across to a new OAuth client in practice **[verify in rehearsal]**.
- Whether the Auth Admin `createUser` accepts password hashes in your Supabase version **[verify in current docs]**.
- Live schema drift **[unknown until §5 checks run]**.
