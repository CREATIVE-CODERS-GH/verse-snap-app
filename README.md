# Verse Snap: Instant Bible

Mobile-first Bible utility: say, scan or type a reference and open the verse fast. Not an AI chatbot.
The original product brief is kept in [docs/ORIGINAL_PRODUCT_BRIEF.md](docs/ORIGINAL_PRODUCT_BRIEF.md).

## Stack
TanStack Start/Router + Nitro, Vite, React 19, TanStack Query, Radix, Tailwind v4, Supabase
(auth + Postgres + RLS), Node 22, npm. Hosted on Vercel.

## Development
```sh
npm ci
npm run dev
```
Checks: `npx tsc --noEmit`, `npm test`, `npm run lint`, `VERCEL=1 npm run build` then `npm run check:bundle`.
Never commit `.env*` files. Project instructions: [CLAUDE.md](CLAUDE.md); session state: [docs/NEXT_TASK.md](docs/NEXT_TASK.md).

## Branches and deployment
- `main` is the Production branch (after the planned cutover; see [docs/DECISIONS.md](docs/DECISIONS.md)).
- `testing/vercel-mobile-preview` is the Preview branch.
- Lovable is no longer used. The old Lovable implementation is preserved as `archive/lovable-main` and the
  tag `legacy/lovable-main-c6caa12`.

## Credits
Bible text from AO Lab (HelloAO); cross-references from OpenBible.info (CC BY 4.0).
