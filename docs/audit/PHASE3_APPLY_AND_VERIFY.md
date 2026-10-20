# Verse Snap — Phase 3: Apply and Verify the Schema on `verse-snap-dev`

*Prepared 2026-10-19. **Nothing in this document has been executed.** No SQL has run against Supabase, Lovable Cloud was not touched, nothing was committed or pushed. SQL syntax has not been machine-validated (no `psql`, Docker or Supabase CLI on this machine); the first real run on the dev project is the validation, which is why the dev project is used as the rehearsal.*

## 1. Repository findings

| Check | Result |
|---|---|
| Fourth corrective migration existed? | **No.** Only the three Lovable originals were present. |
| Created | `supabase/migrations/20261019000000_fresh_backend_corrections.sql` (originals untouched) |
| `.env.local` Git-ignored? | **Yes** — matched by `.gitignore:17` (`*.local`); not tracked by Git. |
| `.env.local` contents (values not shown) | Two keys only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. URL is a well-formed `https://<ref>.supabase.co`; it is **not** the Lovable ref; key has the `sb_publishable_` prefix; **no service-role key** in the file. |
| App configured for the new project? | **Yes, by inspection.** `src/integrations/supabase/client.ts` reads `import.meta.env.VITE_SUPABASE_URL` / `..._PUBLISHABLE_KEY`; the Lovable Vite wrapper loads `VITE_*` values from `.env*` files (`loadEnv(mode, cwd, "VITE_")`) and injects them. The old Lovable ref appears in no build output (`dist/`, `.output/`) and in no source file except `supabase/config.toml`. Not run-tested against the new backend yet. |
| Server-side Supabase use | None. No server function uses Supabase, so `SUPABASE_URL` etc. are not needed yet. |
| Remaining Lovable ref | `supabase/config.toml` `project_id` still holds the Lovable ref. It only names the local CLI stack and is not used by the app. Left unchanged (not requested); to be updated with the CLI link step. |

Restart `npm run dev` after any `.env.local` change (Vite reads it at start-up).

## 2. Review of the original migrations

| File | Verdict |
|---|---|
| `…193800` schema | Valid for a fresh database. Defects: `'KJV'` defaults on three tables; `translations` seeded with `KJV` only; `handle_new_user` uses `search_path = public`; policies call `auth.uid()` per row. |
| `…193809` | Revokes EXECUTE on `handle_new_user()` from PUBLIC, anon, authenticated. Correct. |
| `…220243` | Re-asserts grants (revoke anon on user tables, authenticated CRUD, service_role ALL). Correct and idempotent. |

Observations that are **not** changed (and why): `translation` columns are not FKs to `translations(code)` (keeps new editions a code-only change); `history` has no unique key (see below); all three tables keep `ON DELETE CASCADE` from `auth.users`.

## 3. The corrective migration

`supabase/migrations/20261019000000_fresh_backend_corrections.sql` does, in order:
1. **KJV→KJAV:** `SET DEFAULT 'KJAV'` on `profiles`, `saved_verses`, `history`.
2. **Seed:** deletes the `KJV` row, upserts exactly the six editions in `src/lib/bible/translations.ts` (`KJAV, BSB, WEB, ASV, BBE, FBV`, same names, `sort_order` 1–6).
3. **Trigger hardening:** `handle_new_user()` rebuilt with `SET search_path = ''` and `public.`-qualified names; EXECUTE re-revoked.
4. **RLS:** the three own-row policies recreated with `(SELECT auth.uid())`. Same rules; `authenticated` only.
5. **History:** *no unique constraint.* `library.recordView` deletes then inserts as two separate requests, so two concurrent views of the same verse (two tabs, or a double navigation) could make a unique constraint reject the insert and throw in the UI. A non-unique index `history_user_verse_idx` is added instead to speed that delete.

No data backfill (fresh database). If you ever apply it to a database with `KJV` rows, check collisions first (see `DATA_MIGRATION_DISCOVERY.md` §8).

## 4. How to apply — Supabase CLI only (approved)

The dashboard SQL bundle has been **deleted**; the CLI migration workflow is the only route, so migration history is recorded properly. Docker is not needed for `link` / `db push`.

**Target project:** ref `shoztcflucpnfenohgcr` (taken from the URL in `.env.local`; a ref is an identifier, not a secret). It must equal the ref the dashboard shows for `verse-snap-dev`. The old Lovable ref (`pnugxqkdelknprbhejur`) must never appear in any CLI output below.

Step by step; confirm each result before the next:
1. **CLI available:** Node 22 / npm 10 are present. Run `npx supabase@latest --version` (downloads the CLI to npm's cache; nothing is added to `package.json`).
2. **Login:** `npx supabase@latest login` (a browser opens; the token stays on your machine).
3. **List projects:** `npx supabase@latest projects list`. Confirm `verse-snap-dev` shows ref `shoztcflucpnfenohgcr`.
4. **Link:** `npx supabase@latest link --project-ref shoztcflucpnfenohgcr` (type the database password in the terminal when prompted).
5. **Confirm the link:** `projects list` again; the LINKED column must mark only `shoztcflucpnfenohgcr`.
6. **Dry run:** `npx supabase@latest db push --dry-run`. It must list exactly four migrations (`20260910193800`, `20260910193809`, `20260910220243`, `20261019000000`) and change nothing.
7. **Stop.** Send me the dry-run output (no secrets). Only after I confirm and you reply "push" do you run `npx supabase@latest db push`.

### After applying
1. `supabase/verification/01_structure_checks.sql` (read-only), in the SQL editor. Last row **`OVERALL: all checks pass`** must be `true`.
2. `supabase/verification/02_behavior_checks.sql` (creates and deletes two disposable test accounts). It ends with a normal result table; last row **`OVERALL: all tests pass`** must be `true`. Run the whole file at once.
3. Dashboard → **Advisors**: run Security and Performance; send me the findings.
4. Dashboard → **Table Editor**: 4 tables, RLS on each, `translations` has 6 rows, and no `phase3-verify-…` users remain in `auth.users`.

## 5. Verification coverage (`supabase/verification/`)

| Area | `01` structure (read-only) | `02` behaviour (disposable accounts, cleaned up) |
|---|---|---|
| Tables exist, RLS on | ✔ | |
| KJAV defaults | ✔ | ✔ (inserts without translation get `KJAV`) |
| Six seeded translations | ✔ | ✔ (anon reads exactly 6) |
| Policies (count, roles, `select auth.uid()`) | ✔ | |
| Trigger present; function hardened; not executable by API roles | ✔ | |
| Grants (anon none except translations read) | ✔ | ✔ |
| User registration → profile created with display name + default | | ✔ |
| Saved verses: save, duplicate rejected, cannot save as another user | | ✔ |
| History: duplicates tolerated; app's delete-then-insert leaves one row | ✔ (no unique key) | ✔ |
| RLS isolation (user B sees/deletes nothing of A; own profile only) | | ✔ |
| Anon blocked from user tables and from writing translations | | ✔ |
| Cascade delete of a user | | ✔ |

**Not covered by these scripts** (needs the running app, after approval): real sign-up email delivery and confirm link, password reset link, browser session persistence, `library.ts` end-to-end from the UI.

### App smoke test (after the schema is applied)
1. `npm run dev` (restart if it was running), open the app.
2. Sign up with your first account → confirm via email → you land back signed in. (Built-in email sender is rate-limited: a few per hour.)
3. Open a verse, tap save; reload; it still shows as saved. In Table Editor: `saved_verses` row has `translation = KJAV`.
4. Open two verses; check **History** lists them; re-open one and confirm no duplicate row.
5. Sign out, sign in again; saved verse and history are still there.
6. Forgot-password → email link → `/reset-password` works.
7. Create the second account the same way.
8. Expected failures at this stage: **Google sign-in** (still Lovable broker, Phase 3b) and **AI "describe a verse" search** (needs `LOVABLE_API_KEY`, Phase 4).

## 6. Remaining blockers and open items

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| 1 | **Your explicit "push" after reviewing the dry run** | You | Yes |
| 2 | Auth settings in dashboard: Site URL `http://localhost:8080`, redirect URLs `http://localhost:8080/**` and `http://localhost:5173/**`, email provider on, confirmation on/off decision — confirm done | You | Yes for sign-up testing, not for schema |
| 3 | Dev-server port: 8080 is inferred from the Lovable wrapper; check the actual URL `npm run dev` prints and tell me if different | You | Minor |
| 4 | Supabase CLI login and link on your machine (§4 steps 1-6) | You | Yes |
| 5 | `supabase/config.toml` `project_id` still the Lovable ref: change to the new ref when linking | Me, with approval | No |
| 6 | Google sign-in and AI search will not work until later phases | — | No (expected) |
| 7 | Branch hygiene: new files are untracked on `migration/independent-supabase`; nothing committed. A push must target a branch Lovable isn't tracking | You decide when | No |
| 8 | SQL not machine-validated locally | Dev-project run is the validation | Low |
| 9 | `src/routeTree.gen.ts` has an uncommitted change that was already there before this work (cause not investigated) — untouched | — | No |

## 7. Rollback
Dev project is empty and disposable: if anything is wrong, delete the project's tables via a fresh project, or write a further corrective migration. No production or Lovable data is involved, and the Lovable project is untouched.
