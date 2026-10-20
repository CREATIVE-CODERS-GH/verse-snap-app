# Verse Snap — Phase 3 Verification Runbook (`shoztcflucpnfenohgcr`)

*Prepared after `supabase db push` reported all four migrations applied. **Nothing here has been run by Claude.** No remote SQL executed, Lovable untouched, nothing committed or pushed.*

## 1. Link check (local files only, no network)

| Check | Result |
|---|---|
| `supabase/.temp/project-ref` | `shoztcflucpnfenohgcr` ✔ matches the target and the ref in `.env.local` |
| `supabase/.temp/linked-project.json` | ref `shoztcflucpnfenohgcr`, name **"Bible App"** |
| Old Lovable ref (`pnugxqkdelknprbhejur`) in link state | Absent ✔ |
| `pooler-url` | Host/user only, **no password** in the file |

**Heads-up — project name:** the linked project is named *Bible App*, not `verse-snap-dev`. The ref is what matters and it matches, but in the dashboard confirm that the project with ref `shoztcflucpnfenohgcr` is the one you created for this work (Project Settings → General shows name and ref).

**Hygiene fix made:** `supabase/.temp/` was **not** Git-ignored, so the CLI link state (ref, pooler host) was showing as untracked and could have been committed by accident. I appended `supabase/.temp/` to `.gitignore` (the only change outside docs/verification). The file's existing CRLF line endings are untouched; the two new lines are LF.

To re-check the live link yourself any time: `npx supabase@latest projects list` — only `shoztcflucpnfenohgcr` should carry the linked marker.

## 2. Review of `01_structure_checks.sql` (read-only)

- **Safety:** one `WITH … SELECT` statement. No DDL, no DML, no function creation, no role changes. Reads only catalog views (`pg_class`, `pg_policies`, `pg_proc`, `pg_trigger`, `pg_indexes`, `information_schema`), `has_*_privilege()`, and `public.translations`. Safe on any project.
- **Correctness notes:** checks match the migrations (index names, 4 policies, `search_path=""` storage format, six-edition seed order). If the migration were not applied, a query would error (e.g. missing function) rather than silently pass.
- **Predicted finding — check 63 may fail.** Supabase creates tables in `public` with default privileges that give `authenticated` (and `anon`) full rights. Migration 3 revoked `anon` and re-granted `SELECT` on `translations`, but **never revoked anything from `authenticated`**, so `authenticated` probably still holds INSERT/UPDATE/DELETE on `translations`. RLS still blocks writes (the table has no write policy), so this is **defence-in-depth, not an exploitable hole**. If row `authenticated cannot write translations` is `false`, the recommended fix is a fifth migration (to be created only after you approve):
  ```sql
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.translations FROM authenticated, anon;
  ```
  Other user-table privileges (`TRUNCATE`, `REFERENCES`, `TRIGGER` for `authenticated`) are default Supabase behaviour, are not reachable through the API, and are not checked.

## 3. How to run `01_structure_checks.sql`

1. Supabase dashboard → select the project with ref `shoztcflucpnfenohgcr` (check the URL contains it: `supabase.com/dashboard/project/shoztcflucpnfenohgcr`).
2. **SQL Editor → New query**.
3. Paste the full contents of `supabase/verification/01_structure_checks.sql` and click **Run**.
4. Read the result grid. The last row is the verdict.

**Successful result:** about 30 rows, sorted by section; every `pass` is `true`, including the last row `OVERALL: all checks pass | true`.

Expected rows (summary): 4× table exists + RLS; 3× default is KJAV; seed matches; 4 policy rows OK + count = 4; trigger exists; function SECURITY DEFINER with empty search_path; function not executable by anon/authenticated; anon no access to 3 tables; anon read-only on translations; authenticated CRUD on 3 tables; authenticated cannot write translations (**see prediction above**); `saved_verses` unique key; `history` has no unique constraint; 3 indexes present; no legacy KJV row.

If anything is `false`: send me the failing `check_name` rows (no secrets) and I'll propose the correction. Do not hand-edit the database.

## 4. Review of `02_behavior_checks.sql` before recommending execution

| Aspect | Finding | Risk |
|---|---|---|
| **Privileged operations** | Runs as the SQL-editor owner role (`postgres`). Directly `INSERT`s and `DELETE`s rows in `auth.users`; switches role with `SET LOCAL ROLE authenticated/anon` to mimic the API; creates a function in `pg_temp` (session-local, never stored in a schema, gone when the session ends). | Medium — it writes to the auth schema, but only to two fixed IDs and `*@example.invalid` emails |
| **Auth side effects** | Bypasses Supabase Auth (GoTrue): **no email is sent**, no `auth.identities` / sessions rows are created, no password is set, nobody can sign in as these users. The `on_auth_user_created` trigger fires (that is the point). | Low |
| **Scope of deletes** | `delete from auth.users where email like 'phase3-verify-%@example.invalid'` (twice: start and end) plus `where id in (a, b)`. Pattern cannot match a real account (`.invalid` is a reserved TLD). The cascade removes only those users' `profiles`/`saved_verses`/`history` rows. `translations` is read, never written (the anon write attempt is expected to be rejected). | Low |
| **Cleanup risk** | Normal path: accounts deleted at the end and cascade verified (last test row). If the run is interrupted (browser closed, connection lost): the SQL editor sends the script as one multi-statement request, so Postgres normally rolls back everything; if not, leftovers carry the `phase3-verify-` email and are removed automatically at the start of the next run or by hand with `delete from auth.users where email like 'phase3-verify-%@example.invalid';` | Low |
| **Data exposure** | None. Synthetic text only. | None |
| **Caveat** | If the editor reports `function pg_temp.vs_behavior_checks() does not exist`, it ran the two statements on different connections; tell me and I'll provide a variant that doesn't use `pg_temp`. | Low |
| **What it can't prove** | It exercises RLS through role switching, not through the real API/JWT path. The app-level test (§6) covers that. | — |

**Recommendation:** safe to run once, on this dev project only, after `01` passes. It deletes only its own disposable rows. It meets your "no destructive SQL without approval" rule only with your explicit go-ahead, because it contains `DELETE` statements; **run it only after you reply approving it.**

### How to run it (after approval)
1. Same project, **SQL Editor → New query**.
2. Paste the whole of `supabase/verification/02_behavior_checks.sql` and **Run** (run everything; don't use "run selected").
3. Read the last row.

**Successful result:** 10 rows — nine tests plus `OVERALL: all tests pass | true`, each with `passed = true` and an empty `detail`:
1. registration trigger creates profile (display name, KJAV default)
2. A can save a verse; default translation is KJAV
3. duplicate saved verse rejected by unique key
4. A cannot insert saved verse or history as B
5. history: duplicates tolerated; delete-then-insert leaves one row
6. profiles: A sees and updates only their own row
7. B cannot read or delete A's saved verses and history
8. anon: reads 6 translations only; no access to user tables
9. clean-up: accounts deleted, data cascaded, nothing left behind

Afterwards confirm in **Authentication → Users** that no `phase3-verify-…` users remain (there should be none).

**Failure triage**

| Failing test | Likely cause | Correction (needs your approval) |
|---|---|---|
| 1 | trigger missing or function broken after hardening | new migration restoring trigger / fixing function body |
| 2 or 3 | default not KJAV, or unique key missing | `ALTER … SET DEFAULT`, restore constraint |
| 4, 6, 7 | RLS policy missing or `WITH CHECK` absent | recreate policy as in migration 4 |
| 5 | unexpected unique constraint or trigger on `history` | drop it; app depends on duplicates being tolerated |
| 8 | anon granted privileges (default privileges) | `REVOKE ALL … FROM anon` on the affected table |
| 9 | an extra FK or trigger blocks the cascade | inspect and fix |

## 5. Diagnosing auth / RLS failures later
- **"new row violates row-level security policy"** in the app: the request is missing a user session (not signed in, or the token expired) or `user_id` ≠ `auth.uid()`. `library.ts` sets `user_id` from the session user; check the user is actually signed in (account email shown in Settings) and that `.env.local` points at this project.
- **Sign-up works but no session:** email confirmation is ON; confirm via email first (expected).
- **Confirm/reset email link opens the wrong place:** Authentication → URL Configuration; Site URL and Redirect URLs must include your dev origin (the port `npm run dev` prints, plus `/reset-password`).
- **"Email rate limit exceeded":** the built-in sender allows only a few emails per hour; wait, or use two different disposable inboxes sparingly, or turn confirmation off for dev.
- **Everything is empty after sign-in:** you may be reading the guest localStorage list, not the cloud; sign out/in and reload.
- **Cannot fetch / network errors:** `.env.local` changed but dev server not restarted.

## 6. Application-level test plan (after §3 and §4 pass)

Prerequisites: restart `npm run dev` so Vite re-reads `.env.local`; open the URL it prints; use a private/incognito window to start with a clean guest state. Use a real inbox you control for the test account (not the synthetic SQL ones).

| # | Step | Expected |
|---|---|---|
| A1 | Open the app signed out; open John 3:16 and save it | Saved as a guest (browser storage only); nothing in the database |
| A2 | Settings/Auth → **Create an account** with your test email + password | "Check your email" screen (if confirmation is ON) |
| A3 | Open the confirmation email → click link | Lands on your dev origin, signed in. Dashboard → Authentication → Users shows the user, Email provider |
| A4 | Dashboard → Table Editor → `profiles` | One row for that user id; `translation = KJAV` |
| A5 | In the app: open Romans 8:28 and save it | Verse shows as saved |
| A6 | Table Editor → `saved_verses` | Row with your `user_id`, `translation = KJAV`, `book_id`/`chapter`/`verse` correct, `verse_text` filled |
| A7 | Open 3 different verses | **History** lists them, newest first |
| A8 | Re-open the first one | It moves to the top; no duplicate (`history` table has one row per verse) |
| A9 | Reload the page (F5) | Still signed in; saved list and history unchanged |
| A10 | Unsave Romans 8:28 | Disappears from Saved; row gone from `saved_verses` |
| A11 | Sign out, sign in again with email + password | Same saved verses and history |
| A12 | Open the app in a second browser or device, sign in | Same data (cloud, not local) |
| A13 | Change translation to BSB, open and save a verse | `saved_verses.translation = BSB`; unsaved/saved state is per translation |
| A14 | Forgot password → email → link → set new password → sign in | Works; old password rejected |
| A15 | Clear history | `history` rows for the user removed; saved verses unaffected |
| A16 | Create the second test account the same way | Separate data; neither account sees the other's verses |
| A17 | Sign out and confirm saved/history pages ask you to sign in or show only guest data | No cloud data visible when signed out |

**Expected failures right now (not defects):** Google sign-in (Lovable broker) and "describe a verse" AI search (needs `LOVABLE_API_KEY`).

**Spot-check queries** (read-only; SQL Editor):
```sql
select count(*) from public.profiles;
select user_id, translation, book_id, chapter, verse, created_at from public.saved_verses order by created_at desc limit 20;
select user_id, translation, book_id, chapter, verse, viewed_at from public.history order by viewed_at desc limit 20;
select translation, count(*) from public.saved_verses group by 1;   -- expect only KJAV/BSB/etc, never KJV
```

## 7. Exactly what to run, in order
1. **Dashboard check:** confirm ref `shoztcflucpnfenohgcr` is your intended project (name shows "Bible App").
2. **Run `01_structure_checks.sql`** in the SQL Editor; send me the result (any `false` rows, plus the last row). Expect all `true`; row 63 may be `false` (see §2).
3. **Reply approving `02_behavior_checks.sql`**, then run it; send me the result table. Expect nine passes plus `OVERALL … true`.
4. **Advisors:** Dashboard → Advisors → run Security and Performance; send findings.
5. **App test plan §6**, reporting the step number of anything that differs.

Nothing in this runbook needs changes to application code, authentication or AI integrations.
