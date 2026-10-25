# Phase 4, Step 2 — Native Supabase Google Sign-In (configuration guide and implementation proposal)

*Prepared 2026-10-19. **Proposal only: no code, dependency, database, Git or dashboard change has been made.** Project: `shoztcflucpnfenohgcr`. Dev origin: `http://localhost:8080`. Google Cloud and Supabase dashboard labels change over time; where I describe a menu I say so, and you should follow the on-screen wording if it differs.*

## 1. Current implementation (reviewed)

| Piece | Location | Role |
|---|---|---|
| Button | `src/components/auth-form.tsx` (“Continue with Google”) → `handleGoogle()` lines 52–63 | Calls the Lovable broker with `redirect_uri: window.location.origin`; if `result.redirected` it returns; otherwise `onSignedIn?.()` |
| Broker wrapper | `src/integrations/lovable/index.ts` (auto-generated) | `createLovableAuth()` from `@lovable.dev/cloud-auth-js`; runs OAuth through Lovable's hosted broker and then `supabase.auth.setSession(tokens)` |
| Package | `package.json` → `@lovable.dev/cloud-auth-js ^1.1.2` (locked at 1.2.1) | Used **only** by the wrapper above |
| Where the form renders | `src/routes/auth.tsx` (`onSignedIn` → `/`), `src/routes/settings.tsx:194` (`onSignedIn` → `/saved`) | Two call sites |
| Session consumers | `src/lib/auth.tsx` (`onAuthStateChange`/`getSession`), `AuthSync` in `src/routes/__root.tsx` (invalidates router/queries on `SIGNED_IN`) | Already provider-agnostic: any Supabase session works |
| Other references | `vite.config.ts` line 39: service-worker navigation rule excludes `/~oauth` | Lovable-specific callback path; harmless once unused |

Nothing else imports `@/integrations/lovable` or `OAuthProvider` (searched `src/`). The current button cannot work against our own project: the broker issues Lovable-project tokens, not tokens for `shoztcflucpnfenohgcr`.

## 2. Proposed code changes (exact, small)

Only `src/components/auth-form.tsx` changes in this step.

```diff
-import { lovable } from "@/integrations/lovable/index";
@@
   async function handleGoogle() {
-    const result = await lovable.auth.signInWithOAuth("google", {
-      redirect_uri: window.location.origin,
-    });
-    if (result.error) {
-      toast("Google sign-in did not complete");
-      return;
-    }
-    if (result.redirected) return;
-    onSignedIn?.();
+    try {
+      const { error } = await supabase.auth.signInWithOAuth({
+        provider: "google",
+        options: {
+          redirectTo: window.location.origin,
+          queryParams: { prompt: "select_account" },
+        },
+      });
+      if (error) toast("Google sign-in did not complete");
+      // On success the browser is redirected to Google; nothing more to do here.
+    } catch {
+      toast("Google sign-in did not complete");
+    }
   }
```

Notes on the proposal:
- **Redirect model.** In the browser `signInWithOAuth` navigates away to Google. On return, supabase-js (implicit flow, the existing default) reads the session from the URL hash and emits `SIGNED_IN`; `AuthProvider` and `AuthSync` already handle it, and `AuthPage` already redirects signed-in users to `/`. `onSignedIn` is therefore **not** called on this path (the page unloads); it remains in use for email/password.
- **`prompt: "select_account"`** forces Google's account chooser. It makes testing with several Google accounts possible and avoids silently reusing whichever Google account the browser is in. Costs one extra click for users; easy to remove. **Your call.**
- **`try/catch`** covers the “Supabase not configured” stub client, which has no `signInWithOAuth` method.
- **No `supabase.auth.setSession`, no tokens handled by our code.**
- **Optional (recommended) failure-message handler, same step.** When a user cancels at Google or Google/Supabase rejects the attempt, Supabase redirects back to the app with `error`/`error_description` in the URL (query or hash). Today `supabase-js` swallows it and the user sees a plain signed-out home page. A ~12-line `useEffect` in `AuthProvider` (or the root component) can read `error_description`, show a toast (“Google sign-in was cancelled” / generic), and clean the URL. Without it the app is functional but silent on cancel. **Your call (I recommend including it).**
- Unchanged: UI layout, the button, email/password, reset flow, the Supabase client.
- Optional UX tweak, not proposed unless you want it: from Settings, email sign-in goes to `/saved`, but Google would land on `/` because the redirect is origin-based.

## 3. Configuration guide (you perform; never paste secrets in chat or commit them)

### Values you will need
| Item | Value |
|---|---|
| Supabase **OAuth callback URL** (what Google redirects to) | `https://shoztcflucpnfenohgcr.supabase.co/auth/v1/callback` |
| App **redirect URL** (what Supabase redirects to afterwards; our `redirectTo`) | `http://localhost:8080` (the code sends `window.location.origin`) |
| Google **authorised JavaScript origin** (dev) | `http://localhost:8080` |
| Supabase **Site URL** | `http://localhost:8080` (already set) |
| Supabase **Redirect URLs** allow-list | `http://localhost:8080/**` (already set) **and add** `http://localhost:8080` (exact, no path) to be safe, because the origin-only value might not match a pattern that requires a slash |

The callback URL is shown in the Supabase Google provider panel as well; if it differs from the one above, use the one Supabase shows.

### A. Google Cloud Console (console.cloud.google.com)
1. Create (or pick) a Google Cloud **project**, e.g. “Verse Snap”. Use the Google account you want to own it long-term (not a throwaway).
2. Open **Google Auth Platform** (older UI: *APIs & Services → OAuth consent screen*) and set up the consent screen:
   - User type **External**.
   - App name “Verse Snap”, a support email, a developer contact email.
   - Scopes: only the defaults **`openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`** (non-sensitive; no verification review needed).
   - Publishing status **Testing**: only listed **test users** can sign in. Add your own Google accounts under *Audience/Test users*. Move to **In production** before real users (non-sensitive scopes do not require Google verification, but branding/domain checks may apply).
3. **Clients / Credentials → Create OAuth client ID**:
   - Application type **Web application**, name “Verse Snap (dev)”.
   - **Authorised JavaScript origins:** `http://localhost:8080`
   - **Authorised redirect URIs:** `https://shoztcflucpnfenohgcr.supabase.co/auth/v1/callback`
   - Create, then copy the **Client ID** and **Client secret** into your password manager. Treat the secret like a password.
4. Later, for production: a separate client (or add entries) with the production origin; keep the same Supabase callback URL (or the production project's).

### B. Supabase dashboard (project `shoztcflucpnfenohgcr`)
1. **Authentication → Sign In / Providers → Google**: enable, paste Client ID and Client secret, leave “Skip nonce checks” and “Allow users without an email” **off**, save.
2. Confirm the callback URL shown there equals the one in step A3.
3. **Authentication → URL Configuration:** Site URL `http://localhost:8080`; Redirect URLs contain `http://localhost:8080/**` and `http://localhost:8080`.
4. **Authentication → Sign In / Providers** (or Sign In/Up settings): “Allow new users to sign up” must be **on**; leave identity auto-linking at its default (see §4).
5. No SQL, migration or schema change is needed.

## 4. Interaction with existing accounts, profiles and the trigger

| Scenario | Expected result (Supabase default behaviour; **verify in the tests below**) |
|---|---|
| **Brand-new Google user** | A row is created in `auth.users` (provider `google`, email already verified). The existing `on_auth_user_created` trigger runs `handle_new_user()`, creating the `profiles` row. Google supplies `full_name`/`name`/`avatar_url` in `raw_user_meta_data`; the trigger uses `display_name`, then `full_name`, so the profile gets the Google name. Default translation is `KJAV` (migration 4). RLS works unchanged because `auth.uid()` is the Supabase user id. |
| **Returning Google user** | Matches the existing Google identity; same user id; profile, saved verses and history intact. No new profile row (`ON CONFLICT DO NOTHING` anyway). |
| **Existing email/password user signs in with Google using the *same, verified* email** | Supabase links the Google identity to the existing user (same id), so saved verses/history are shared by both methods. No second profile. `display_name` is *not* overwritten (the trigger runs only on insert). |
| **Existing email/password user whose email was never confirmed** | Behaviour differs (Supabase may replace the unconfirmed identity to prevent pre-registration takeover). Avoid this case in testing unless intended; observe and report. |
| **Google user later wants a password** | “Forgot password” works for any user with that verified email; setting a new password adds email/password sign-in to the same user. |
| **Signing up with email/password after a Google account exists for that email** | `signUp` returns the usual “check your email” response without creating a duplicate; the person should use Google or “Forgot password”. |
| **Different email on Google vs password account** | Two separate users; no automatic merge. |
| **Guest data** | Not merged into any account (existing behaviour, unchanged). |
| **Trigger/security** | Trigger is `SECURITY DEFINER` with empty `search_path` (hardened in migration 4), so Google metadata cannot misdirect it. |

Security notes: Google's `email_verified` is trusted for linking; do not enable “Allow users without an email”. Tokens appear briefly in the URL hash and are removed by supabase-js after processing. PKCE would harden this further and is a possible later change; it is **not** part of this step.

## 5. Test plan

Prerequisites: configuration in §3 done; dev server on `http://localhost:8080`; at least two Google accounts on the Google test-users list (call them **G1**, **G2**); your existing email/password test account **E1** whose email equals G1's email (to test linking), and one email/password account **E2** with a different email. Use a private window per scenario when noted. Never test with real users' data.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| G1 | **First-time Google sign-in** | `/auth` → Continue with Google → choose **G2** (an email with no existing account) → consent | Returns to the app signed in on `/`; Dashboard → Authentication → Users shows a new user, provider Google; `profiles` has one row with the Google display name and `translation = KJAV` |
| G2 | **Data works under Google** | Save a verse, open two verses; check Saved and History | Rows in `saved_verses`/`history` with the Google user's id; persist after refresh |
| G3 | **Returning user** | Sign out; Continue with Google → choose G2 again | Same user id, same saved verses/history; no new row in Users; no second `profiles` row |
| G4 | **Sign-out** | Settings → Sign out | Lands on `/auth`; saved/history pages require sign-in; Continue with Google shows the account chooser again (because of `prompt=select_account`) |
| G5 | **Account linking** | With E1 (password) signed out, Continue with Google using the same email (G1) | Signs in as the *same* user as E1 (same id); Users → that user shows two identities (email, google); E1's saved verses/history visible |
| G6 | **Both methods afterwards** | Sign out; sign in with E1's password; sign out; sign in with Google | Same data both times |
| G7 | **Separate accounts** | Sign in with Google using an email different from E2's | Two distinct users; no cross-visibility (RLS) |
| G8 | **Cancel at Google** | Continue with Google → press Cancel/close at consent | Returns signed-out to the app; (if the failure handler is included) a toast explains; no error screen, no loop |
| G9 | **Provider misconfiguration (negative test)** | Temporarily use a wrong secret or disable the provider in the dashboard | Google/Supabase error page or redirect back with `error_description`; app does not hang. Restore configuration afterwards |
| G10 | **Redirect allow-list** | Remove `http://localhost:8080` exact entry only if the wildcard doesn’t cover it (observe) | Either works or Supabase falls back to Site URL; record result, restore |
| G11 | **Reload / persistence** | After G1, reload; close and reopen the tab | Still signed in (session in localStorage); URL hash gone |
| G12 | **Regression** | Email sign-up, email sign-in, password reset, save/unsave, history, Settings sign-out | Unchanged; run `supabase/verification/01_structure_checks.sql` read-only afterwards (all `true`) |
| G13 | **Build checks** | `tsc --noEmit`, `npm run build` | Pass; no new warnings |
| G14 | **Mobile / installed PWA** | Phone browser, then installed PWA | Sign-in completes and returns to the app; if the installed app opens Google in an external browser and doesn't return, record it as a known limitation for a later fix |

Failure signatures to recognise: `redirect_uri_mismatch` (Google client's redirect URI doesn't match the Supabase callback URL); `Unsupported provider: provider is not enabled` (Supabase panel not saved); “Access blocked: app has not completed verification / not a test user” (account missing from Google test users); landing on the wrong origin (Site URL/Redirect URLs).

## 6. When it is safe to remove the Lovable pieces

Remove, in **one separate follow-up change after approval**, only when **all** hold:
1. G1–G8 and G11–G13 pass (G14 recorded).
2. `grep` finds no remaining import of `@/integrations/lovable` or `@lovable.dev/cloud-auth-js` (currently only `auth-form.tsx`, removed by this step).
3. You have run the app through email/password flows once more after the change.

Then remove:
- `src/integrations/lovable/index.ts` (whole folder),
- `@lovable.dev/cloud-auth-js` from `package.json` and from `package-lock.json` (via an npm uninstall, **needs your approval at that time**),
- the `/~oauth` exclusion in `vite.config.ts` (this belongs to the build-config step; leaving it is harmless).

**Lockfile finding to act on at that point:** `bun.lock` records 380 package tarball URLs on Lovable's private npm cache host (`lovable-core-prod` sandbox cache), while `package-lock.json` has none (it points to the public npm registry). That is a further reason to delete `bun.lock` when you finalise npm as the package manager, since installs from it would depend on a Lovable-hosted mirror.

## 7. Order of work for this step (after your approval)
1. You configure Google Cloud and Supabase (§3). I can't do this for you; send me no secrets, just “done” and any error text.
2. I make the one-file code change (§2), run `tsc`, lint (baseline-compared) and build, and show you the diff. No commit.
3. You run the test plan (§5); I help interpret failures.
4. After approval, a separate small change removes the Lovable OAuth files and package (§6).

## 8. Decisions I need from you
1. Include `prompt: "select_account"`? (recommended: yes)
2. Include the cancel/failure toast handler? (recommended: yes)
3. Confirm the Google Cloud project owner account and that you will add your Google accounts as test users.
4. Any production domain yet? (needed later for Google origins and Supabase redirect URLs; not needed for dev.)
