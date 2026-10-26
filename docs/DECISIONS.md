# Decisions

Short records of choices worth not re-litigating. Newest last. Longer write-ups: `docs/audit/`.

- **Independent Supabase project** (`shoztcflucpnfenohgcr`) replaces the Lovable one; old project is
  never touched. Migrations are applied by file, after a dry run, with explicit approval.
- **Guest vs account storage:** guests use localStorage; signed-in data is RLS tables only, never cached
  on the device (sign-out removes cached queries). Each account feature sits behind a `*-schema.ts` switch
  so code can ship before its migration.
- **Guest merge needs consent** (shared devices): verified user, per-batch session re-check,
  insert-or-ignore (account data wins), device copies removed only after server confirms.
- **History:** one table, `kind` verse|chapter, `NULLS NOT DISTINCT` unique key so upserts are atomic;
  chapter counted after 4 s on the page.
- **Highlights:** one per user, translation and verse; 5 stored colours ("clear" deletes).
- **Journal:** one reflection per verse + translation; notebooks live in existing screens (notebook
  sheet + Saved "Show → Reflections"); deleting a notebook moves notes to undeletable "General
  Reflections"; new users start with General only; explicit Save (no autosave); saves compare the loaded
  `updated_at` so an older copy never overwrites a newer one.
- **Hebrews** is grouped with the General Epistles. Books page reveals a group's remaining books on
  scroll (no "more below" button).
- **Offline:** service worker and IndexedDB downloads shipped in Batch 1F (Production on by `OFFLINE_IN_PRODUCTION`).
- **Theme:** monochrome light/dark with brand accents; drop-cap chapter number on verse 1.
- **Workflow:** commit/push only on request and only the relevant files; previews are not promoted;
  `docs/` carries session state to keep context small.
- **Lovable retired (2026-10-23):** `testing/vercel-mobile-preview` is authoritative. Old `origin/main` (`c6caa12`) is
  preserved as `archive/lovable-main` and tag `legacy/lovable-main-c6caa12` and is never merged. `main` will become
  Production by a keep-our-tree merge (`-s ours`) then a plain fast-forward (no force-push); the testing branch stays
  the Preview branch. `@lovable.dev/vite-tanstack-config` is kept for now; replacing it is a separate task. The old
  Supabase project guard (`scripts/check-free-search-env.mjs`) stays.
- **Production cutover done (2026-10-25):** PR #2 (`a9f8908`) replaced the Lovable `main` with the Verse Snap app via a
  keep-our-tree merge (both histories kept, no force-push). `main` = Production, GitHub default and Vercel Production Branch (first Production deployment succeeded);
  `testing/vercel-mobile-preview` = development and Preview. Branch protection on `main` is still to be configured. Lovable code and `.lovable/` stay out; the archive branch and tag are the only copies.
- **Repository cleanup, phase 1 (2026-10-25):** design exports (Stitch HTML/CSS/screenshots) never go in the repo: they are
  git-ignored and only images the app uses live in `public/`. "Stitch" in code names (`stitch-icons`, `font-stitch`,
  `variant="stitch"`) is live app code, not a prototype; do not rename it for its own sake. `@lovable.dev/vite-tanstack-config`
  stays until a separate, approved task replaces it.
- **Lovable build wrapper removed (2026-10-26):** `vite.config.ts` lists the plugins directly (Tailwind, tsconfig paths,
  TanStack Start with client import protection and the `server` entry, Nitro on build only, React) with `lightningcss`, the
  `@` alias, dedupe, and dev server `host "::"` / port **8080** kept (8080 is on the Supabase and Google OAuth redirect
  lists). Nitro now picks its target from the environment only: Vercel (`VERCEL=1`) output is byte-identical to before;
  a local build with no environment variables is a Node server instead of the old Cloudflare default. Lovable-only
  extras (sandbox detection, error loggers, assets proxy, devtools injection) are gone. The retired-project guards stay.
