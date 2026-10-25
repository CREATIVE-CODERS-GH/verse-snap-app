# Root-cause analysis: second (denied) AI search replaced the first successful result

*2026-10-19. Investigation only: **no application code changed, no live OpenAI call, no quota reset, `.env.local` untouched, nothing committed.** The reproduction used mocks (the real orchestrator with fake provider and quota, plus TanStack Query's real cache logic) in a temporary test file that was deleted afterwards.*

## What happened
Log line reported: `{"outcome":"denied_global_day","subjectKind":"guest"}`. With `AI_LIMIT_GLOBAL_DAY=1`, exactly one paid search was allowed; a second request reached the server, was **correctly refused before any OpenAI call** (so the cap did its job and only one paid request happened), and the browser then displayed that refusal as "Scripture search is unavailable right now", in place of the good result.

## Findings

| # | Question | Answer |
|---|---|---|
| 1 | Did the browser/React Query submit twice? | **Yes — at least one extra request reached the server** (the denied one). A plain submit does **not** double-fire (reproduction S1, and S2 for the `navigate(replace)` remount, both: exactly 1 call). The extra request needs one of the triggers in §Triggers. |
| 2 | Vite restart after `.env.local` changes? | **A confirmed trigger.** Vite restarts its dev server when `.env*` files change. The Vite client then polls, sees the server return, and runs `location.reload()` (`vite/dist/client/client.mjs`, lines ~993–998). The page URL is `/search?q=love%20is%20patient` (the search page rewrites the URL on submit), and `search.tsx` starts a search whenever `q` is present at mount. So a reload re-submits the search with no user action (S5). The same happens if you stop and restart `npm run dev` while the tab stays open on a `?q=` URL, or on F5. |
| 3 | How are quota denials turned into messages? | `search-service.server.ts` returns a **normal** response `{ results: [], failed: true, errorMessage }` (not an exception). Global-cap and "could not check quota" denials deliberately use the generic "Scripture search is unavailable right now." (no detail leaks). The browser treats it as a *successful* fetch whose data happens to say `failed`, so React Query **replaces** the previous good data with it. |
| 4 | Was the first result lost in navigation/hydration/restart? | **Not lost by the server — lost by the client cache being replaced or discarded.** The good result lives only in React Query memory. It is gone after any full reload (S5), and it is overwritten by a later failed response for the same key (S3). The server's own result cache is in-process memory, so a dev-server restart empties it too. Hydration itself does not run the query (the search runs from an effect/observer on the client). |
| 5 | Reproduced with mocks? | Yes — table below. |
| 6 | Fix | See §Recommended fix. |

### Mock reproduction (cap = 1, identical to the live setup)
| Scenario | Server calls | What the user sees afterwards |
|---|---|---|
| S1 plain submit | 1 | result |
| S2 `navigate(replace)` remount (same query key), in flight and afterwards | 1 | result — **navigation is not the cause** |
| S3 `AuthSync` calls `queryClient.invalidateQueries()` | 2 | result → **"unavailable"** (good result overwritten) |
| S4 saved translation loads after the page mounts (`KJAV` → e.g. `BSB`) | 2 (`KJAV:…`, `BSB:…`) | latest key shows **"unavailable"** |
| S5 full reload with `?q=` in the URL (Vite restart, F5, HMR reload) | 2 | result → **"unavailable"** |
| S6 server: identical repeat of a query whose answer is cached | 2 (provider called once) | second call **denied**, although the answer is cached |

## Triggers that send a second paid request (code evidence)
1. **Reload / Vite restart with `?q=` in the URL** (`search.tsx`: `useState(q)` → `submitted` → query enabled at mount; Vite client reload). Needs no user action. Confirmed mechanism.
2. **`AuthSync` over-invalidation** (`src/routes/__root.tsx`): on `SIGNED_IN`, `USER_UPDATED` it calls `queryClient.invalidateQueries()` for **every** active query. supabase-js emits `SIGNED_IN` each time a tab with a session becomes visible again (`_onVisibilityChanged` → `_recoverAndRefresh`, auth-js lines ~4744–4766 and ~4076+). `invalidateQueries` ignores `staleTime`, so it re-runs the paid search whenever a signed-in user alt-tabs back (for example after reading the terminal). *Only applies when signed in; the denied request was logged as `guest`, so this may not be what happened here, but it is a real defect for signed-in users.* One more possibility: a signed-in user whose token failed server verification is treated as a guest, which would also log "guest" — the current log cannot tell these apart.
3. **Translation preference loads after mount** (`PreferencesProvider` starts with `KJAV`, then an effect applies the stored value). On a `?q=` page load the query fires with `KJAV`, then a *new* query with the stored translation (S4).
4. **Design interaction:** the server consumes quota *before* reading its cache (a deliberate rule: cached results must not bypass limits). So even a harmless duplicate of an already-answered query is charged and, at a cap, refused (S6).

Because the UI can only show one result and a refused duplicate is returned as ordinary data, any of the triggers above ends with the same visible symptom.

## Root cause (one sentence)
The search page lets **non-user events** (page reload from a `?q=` URL, auth-event invalidation, a late translation change) fire additional paid requests, and when one of them is refused or fails, the failed response **overwrites the successful result** that existed only in browser memory.

## Recommended fix (not yet implemented)
1. **Never auto-pay twice.** Put the paid search behind one tiny, testable module (query options + persistence), and:
   - persist each *successful* result for (description, translation) in `sessionStorage` (about 1 hour) and seed the query from it, so a reload, Vite restart or remount shows the saved result with **no request**;
   - `staleTime: Infinity`, `refetchOnMount/Reconnect/WindowFocus: false`, `retry: false` for this query only;
   - wait until preferences have loaded (`ready` flag on `PreferencesProvider`) before enabling the query, so the translation cannot flip after the first request.
2. **Failures never replace success.** In the query function, if the server returns `failed` and a good result already exists for that key, keep the good result (and surface the failure only when there is nothing to show).
3. **Stop `AuthSync` from refetching paid queries.** Invalidate only user-data queries (`saved`, `history`, …), or at least exclude `scripture-search`; also ignore `SIGNED_IN` when the user id has not changed (this also stops needless refetches on every tab focus).
4. **Keep the server policy** (quota before cache). Optional later: a short "same query, same caller, last 60 s" replay that returns the cached answer without charging; I do **not** recommend it now because it weakens the rule you asked for.
5. **Diagnostics:** add `translation` and `tokenPresent` to the usage log line (no secrets, no query) so the next occurrence is identifiable at a glance; show a clearer message for a *daily limit reached* case if you want one.
6. **Regression tests (mocks, free):** reload with a saved result → 0 requests; `invalidateQueries()` → no search request and result kept; translation flip before preferences are ready → 1 request; failed refetch keeps prior data; submit twice → 1 request. These reuse the reproduction above.

## Zero-cost way to confirm the actual trigger on your machine
The global cap is already used up (do **not** reset it), so every extra attempt is refused before OpenAI and costs nothing. With `AI_SEARCH_ENABLED=true` still set, open DevTools → Network, filter `_serverFn`, and try each action separately, noting how many requests appear:
1. Load `http://localhost:8080/search?q=love%20is%20patient` (a reload-style load) → count requests; **two** requests means the translation flip.
2. Type a brand-new description and press Enter once → should be exactly **one**.
3. Switch to another window and come back (signed in only) → an extra request means `AuthSync`.
4. Save `.env.local` without changes while `npm run dev` runs → the server restarts, the tab reloads, and a request appears → the Vite reload.

Also useful: how many `[ai-search]` lines your terminal printed, and whether a `[vite] server restarted` / `.env.local changed` line appeared between the first and the denied request.

---

## Status: corrections implemented (2026-10-19, mocks only)

| Fix | Where |
|---|---|
| Successful results saved in `sessionStorage` (1 hour, validated on read, failures never saved, no tokens or account data) and restored after reload / Vite restart with no request | `src/lib/bible/ai/search-session.ts` |
| A search present in the URL but with no valid saved result does **not** run; it shows a "Press Search" prompt. The person's Enter or button press (or a spoken search from the voice page) is the only trigger, and that intent lives in memory only, so a reload clears it | `search-session.ts` (`allowPaidSearch`), `src/routes/search.tsx`, `src/routes/voice.tsx` |
| No refetch on mount, focus or reconnect; results never go stale on their own; no retries | `src/lib/bible/ai/search-query.ts` |
| Nothing runs until preferences have loaded (new `ready` flag), so the translation cannot change after the first request | `src/lib/preferences.tsx`, `search-query.ts` |
| Identical requests share one in-flight request (covers double submit, repeated "Search again", remounts) | `search-query.ts` (`fetchPaidSearch`) |
| A failed, refused or thrown refetch never replaces a successful result; the page shows an error only when it has nothing better | `search-query.ts`, `src/routes/search.tsx` |
| `AuthSync` ignores repeated `SIGNED_IN` for the same person and never invalidates AI search queries (saved verses, history and other user data still refresh) | `src/lib/auth-events.ts`, `src/routes/__root.tsx` |
| Server usage log now also records the edition and whether a token was sent (no text, address or token) and the page emits development-only diagnostics with event names and lengths only | `search-service.server.ts`, `search-query.ts` |
| Server rule "quota is consumed before the cache" and all Supabase limits: **unchanged** | — |
