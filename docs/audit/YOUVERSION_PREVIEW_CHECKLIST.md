# YouVersion editions (NIV, AMP): controlled Preview checklist

*Plan only. Nothing here has been run on Vercel; no environment variable has been changed and nothing is deployed.
No secret values appear in this document. Licensing status and open questions: `YOUVERSION_YV1.md` (YV-3).*

## Branch and base (YV-4)
- Branch: `feature/youversion-editions` (local only, not committed or pushed), created from `origin/main` at
  `55e4d796d487337e3962657b8cca05f635120ab2`. That commit contains all of `origin/testing/vercel-mobile-preview`
  (`3969bbf`) plus the Voice & Audio merge (#14). The local `testing/vercel-mobile-preview` is stale (`5bf0d61`) and
  must not be used as a base.
- Before relying on it, confirm which branch Vercel builds Previews from. Vercel makes a Preview for any non-Production
  branch push, so this branch gets its own Preview URL; `main` stays Production.
- Contains only YouVersion work. Study Together stays on `feature/study-together-s1` (`4b713d0`).

## 0. Decisions needed from the owner first
1. Approve a controlled Preview of NIV and AMP, knowing the "Open" rows in the YV-3 matrix are unresolved.
2. Choose the branch to carry the work (section 3) and approve the commit/push when ready (not authorised yet).
3. Confirm whether Production uses the same Supabase project as Preview (section 6). The repository documents only
   one project (`shoztcflucpnfenohgcr`) and does not say whether Production uses it. Treat it as shared until confirmed.
4. Nominate a test account (section 6) and a short list of testers.
5. Lockman items (annual report, URL notification, SDK wording) are not blockers for a closed test but should be
   raised with YouVersion before any wider use.

## 1. Environment variables (Preview scope only)
| Name | Where it is read | Scope | Notes |
|---|---|---|---|
| `YOUVERSION_APP_KEY` | server only, `youversion.server.ts` | **Preview only** | Secret. Mark it Sensitive. Never `VITE_`-prefixed. |
| `VITE_YOUVERSION_TRANSLATIONS` | browser and server, `youversion-schema.ts` | **Preview only**, value `true` | A public boolean, **baked in at build time**: change it and the Preview must be rebuilt. |

Production keeps both **unset** (the flag is then off by default, so NIV and AMP never appear). Do not add either to
the Production or Development environments. If a Git-branch-specific Preview variable is available in Vercel,
scope both to the chosen Preview branch only.

## 2. Server-side credential handling (already built, verify on the deployment)
- Only `src/lib/bible/youversion.server.ts` reads the key, loaded by dynamic import inside a server function.
- The browser calls Verse Snap's own server function (POST); it never calls `api.youversion.com` and never sends the key.
- Before approving the Preview: run `npm run build` with the Preview values on a trusted machine and `npm run
  check:bundle` (browser assets: 0 problems), and confirm the key value is absent from `.output/public` (done locally
  in YV-1 to YV-3). Do not paste the key into chat, logs, tickets or this repository.
- The app server never logs the key or YouVersion's error text.

## 3. Identifying the Preview branch and deployment
- `testing/vercel-mobile-preview` is documented as the development and Preview branch; Production is `main`.
- The YouVersion work currently sits uncommitted on the local branch `feature/study-together-s1`, next to the Study
  Together foundation. **Recommendation:** commit it on its own branch (for example `feature/youversion-editions`) with
  only the YouVersion files, so it cannot ride along with Study Together. Which branch to use is the owner's call.
- Vercel makes a Preview for any non-Production branch. Confirm you are looking at a **Preview** deployment (the URL is
  not the Production domain) and that the NIV and AMP entries appear in the translation selector. They must not appear
  on the Production domain.
- Do not promote a Preview to Production.

## 4. Pre-deployment local gate (all passed on the YV-3 build)
`npx tsc --noEmit` · `npm test` · `npm run lint` (changed files) · `VITE_YOUVERSION_TRANSLATIONS=true npm run build` +
`npm run check:bundle` · with the dev server on port 8091 and the flag on: `npm run test:e2e:youversion`,
`test:e2e:youversion-stability`, `smoke`, `library`, `offline`, `cross-references`, `saved-hubs`, `highlights`,
`journal`, `reader-batch1d`; with the flag off: `smoke`, `saved-hubs`.

## 5. Preview smoke test (manual, on the Preview URL, with the test account)
1. The selector lists KJAV, BSB, WEB, ASV, BBE, FBV, NIV, AMP; KJAV is still the default.
2. John 3 in NIV and in AMP: 36 verses each; the publisher notice and its link appear under the chapter and open in a new tab.
3. Switch translations repeatedly; open Genesis 1, Psalm 23, John 4. Open Mark 9:44 in NIV (shown as not in this edition) and AMP (shown).
4. Compare on John 3:16: NIV and AMP cards each carry their own notice.
5. Verse page, NIV: Share opens a sheet that explains sharing and copying are unavailable and offers no actions; the Copy button is disabled here, in the chapter selection toolbar, in Compare and in Card Studio. AMP Copy includes the Lockman notice.
6. Verse page, AMP: Share offers all targets; Card Studio exports a card whose notice is legible; Card Studio NIV is disabled with a message.
7. Save an NIV verse and an AMP verse: the Saved list shows live previews with notices; the stored entry has no text.
8. Cross-references on a NIV verse list references only, with a note.
9. Existing six translations: read, search (free search), download one for offline, share one as an image: unchanged.
10. Rapid chapter flicking (about 10 chapters in 10 seconds) never shows a rate-limit message; sustained 60+ requests in a minute shows the friendly "moving quickly" message.
11. Browser dev tools: no request to `api.youversion.com`; no NIV/AMP text in Local Storage, IndexedDB or Cache Storage.

## 6. Shared Supabase database considerations
- NIV/AMP needs **no schema change and no migration**: saved verses, history, highlights and reflections store the
  translation code as free text (no check constraint on it, confirmed in `supabase/migrations`).
- Do not assume Preview and Production use different databases. If they share one, rows a tester creates in Preview with
  translation `NIV` or `AMP` (saved verses, history, highlights, reflections) belong to that account and are visible in
  Production for the same signed-in user. Production (flag off) lists them but cannot show their text and shows the normal
  "not available" state when one is opened; it does not crash (tested with the flag off).
- Reflections are the user's own words, but a note's reference line names NIV/AMP; the quote button inserts references only.
- Use a dedicated test account, not a real user's. Afterwards remove the test saves/highlights/notes through the app.
- No SQL is run, no RLS is changed, no service-role key is used for this feature.

## 7. Rollback
| Situation | Action | Effect |
|---|---|---|
| Stop the feature everywhere on Preview | Set `VITE_YOUVERSION_TRANSLATIONS` to `false` or delete it in the Preview environment, then **redeploy** the Preview | NIV/AMP vanish from the selector and routes; devices whose default was NIV/AMP fall back to KJAV automatically (stored choice kept) |
| Fastest stop | Redeploy the previous (flag-off) Preview commit, or delete both variables and redeploy. **Environment changes on Vercel only reach new deployments**, so every rollback is a redeploy; there is no instant runtime switch | Same as above. Removing only `YOUVERSION_APP_KEY` (and redeploying) leaves NIV/AMP listed but makes every chapter return the "translation isn't available" state; nothing leaks |
| YouVersion rate-limits or revokes the key | None needed | The server pauses upstream calls after a 429 (bounded) and maps 401/403 to the unavailable state without retrying |
| Code problem | Redeploy the previous Preview commit | The default-off build never had NIV/AMP |
| Leftover data | None required | Reference-only rows are harmless; testers can remove them in the app |

Production is never touched by any of these steps because the flag and key are not set there.

## 8. Not authorised yet
Commits and pushes, any Vercel change (including environment variables), a Preview deployment, any Supabase change,
production activation, paid services.
