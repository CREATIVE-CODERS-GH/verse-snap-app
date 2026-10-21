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
- **Service worker off** until offline support is designed (VitePWA removed).
- **Theme:** monochrome light/dark with brand accents; drop-cap chapter number on verse 1.
- **Workflow:** commit/push only on request and only the relevant files; previews are not promoted;
  `docs/` carries session state to keep context small.
