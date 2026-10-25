# Verse Snap — project instructions

Mobile-first Bible utility: say, scan or type a reference and open the verse fast. Not an AI chatbot.
Read `AGENTS.md` too (translation catalogue rule). Lovable is retired (`docs/DECISIONS.md`). Session state lives in
`docs/` — read `docs/NEXT_TASK.md` first, `docs/PROJECT_STATUS.md` / `docs/DECISIONS.md` only if needed.

## Stack
TanStack Start/Router (file routes) + Nitro, Vite, React 19, TanStack Query, Radix, Tailwind v4,
Supabase (auth + Postgres + RLS), Node 22, **npm**. Hosting: Vercel (Nitro picks the Vercel preset
when `VERCEL=1`; `vercel.json` uses `npm ci`). `routeTree.gen.ts` is generated — never hand-edit.

## Where things are
- `src/routes/` screens · `src/components/` UI parts · `src/lib/` logic (`library`, `highlights`,
  `journal`, `guest-merge`, `bible/`) · `src/integrations/supabase/` client + generated `types.ts`
- `supabase/migrations` (applied in order), `supabase/rollbacks` (never auto-applied),
  `supabase/verification` (SQL checks 01–07) · `scripts/e2e`, `scripts/db` · architecture detail:
  `docs/audit/PROJECT_ARCHITECTURE.md`
- Bible editions live only in `src/lib/bible/translations.ts`; fetch book metadata per edition.

## Conventions
- Data modules follow one pattern: guest → localStorage, signed in → Supabase via RLS; account data is
  never stored on the device; a `*-schema.ts` switch gates each account feature (`ACCOUNT_HISTORY_V2`,
  `ACCOUNT_HIGHLIGHTS_ENABLED`, `ACCOUNT_JOURNAL_ENABLED`).
- Guest data joins an account only through the consent prompt (`guest-merge.ts`): server-verified user,
  insert-or-ignore, remove from device only after server confirms.
- Account writes go through `assertStillSignedInAs` (`session-guard.ts`).
- Theme: `--brand-*` / `--ch-*` tokens only; light #FFFFFF, dark #121212. Reuse approved UI; no redesigns.
- TS is strict (`noPropertyAccessFromIndexSignature`: use `obj["key"]`). Prettier is the formatter.
- Working copy is CRLF, repo is LF (`.gitattributes`). Use Edit/scripts that tolerate CRLF.

## Restrictions (permanent)
- Supabase project is **`shoztcflucpnfenohgcr`**. The old Lovable project `pnugxqkdelknprbhejur` is retired: never use or touch it.
- Never apply a migration, change RLS, or use the service-role key without explicit approval. Apply only
  the approved file (`supabase db push --dry-run` first); verify with `supabase/verification`.
- Never print or commit secrets or `.env*`; don't edit `.env.local`. Keep `AI_SEARCH_ENABLED=false`;
  no live OpenAI calls or paid services.
- Never force-push or rewrite pushed history; never change or push to `main` without explicit approval;
  don't touch `stash@{0}`. `main` becomes the official Production branch only after the approved cutover;
  `testing/vercel-mobile-preview` stays the development and Preview branch. The old Lovable `main`
  (`archive/lovable-main`, tag `legacy/lovable-main-c6caa12`) must never be merged into the app.
- Commit / push / deploy **only when asked** ("push to github"). Stage only the files for that change.
- Don't promote Vercel previews to Production. Don't restore intentionally removed UI sections.
- Open items needing approval: Phase B search-index migration; BBE/FBV licensing and UK KJV review.

## Commands
`npm run dev` (use `-- --port 8091` for e2e) · `npx tsc --noEmit` · `npm test` · `npm run lint` ·
`VERCEL=1 npm run build` + `npm run check:bundle` · browser tests `npm run test:e2e:{library,merge,smoke,
highlights,journal,...}` (need the dev server) · DB harness `DB_TEST_DEPS=<dir> npm run test:db:<name>`
(throwaway local Postgres; setup in `scripts/db/lib.mjs`).

## Working efficiently (saves tokens)
- Start from `docs/NEXT_TASK.md`; open only the files it names. Use Grep/Glob, then read line ranges.
- Run focused tests while working (`npx vitest run <file>`); full suite, build and browser suites once at
  the end. Keep command output short (`| tail`, `grep`).
- After each finished milestone update only the relevant doc (`NEXT_TASK` always; `PROJECT_STATUS` on
  completion; `DECISIONS` when a choice is made). Keep docs short; link instead of copying.
- Suggest `/compact` when a session has grown with finished detail; suggest `/clear` once a task is
  documented. Never compact or clear without the user's approval.
