# Phase 4, Step 4, Stage 3 — Independent OpenAI Bible search: implementation notes

*2026-10-19. Implemented with mocked tests only. **No live OpenAI request was made during this stage** (the only paid requests so far are the two preflight probes, about $0.00019 in total, recorded in the local ledger). Nothing was committed, pushed or deployed; no migration was added; the Lovable project and the database were not touched.*

## How it works

```
Browser  →  searchScripture (server function, src/lib/bible/search.functions.ts)   [unchanged contract]
              └─ dynamic import, server only → ai/search-service.server.ts
   1. AI_SEARCH_ENABLED must be exactly "true"            (default OFF → "Scripture search is not configured.")
   2. query rules: 2–200 chars, trimmed, no control chars  (friendly message, before anything is spent)
   3. translation must be supported (KJV → KJAV)
   4. provider built from OPENAI_API_KEY, RATE_LIMIT_SALT present   (else "not configured")
   5. identity: verified Supabase user → "user:<uuid>"; otherwise guest → "ip:<HMAC of client address>"
   6. consume_ai_search_quota (service-role, server only). Any doubt → denied (FAIL CLOSED)
   7. result cache — read AFTER the quota is consumed, so repeating a query cannot dodge limits
   8. provider.findCandidates → OpenAI Responses API, strict JSON schema, ONE request, no retries, no fallback
   9. HelloAO verification and ranking (unchanged logic, moved to ai/rank.ts)
```

- **Provider modularity:** `ReferenceProvider` interface (`ai/types.ts`); OpenAI adapter in `ai/providers/openai.server.ts`; chosen by `AI_PROVIDER` in `ai/providers/index.server.ts`. A new provider is one adapter file plus one `case`. Unknown/disabled provider → "not configured". There is deliberately **no fallback chain**.
- **Cost controls built in:** `maxRetries: 0` on the SDK client, 15 s timeout, `max_output_tokens: 2000`, one request per search, `gpt-6-luna` with reasoning effort `none` as default (`AI_SEARCH_MODEL`, `AI_SEARCH_EFFORT` override), dev limits as code defaults (guest 3/min & 15/day, signed-in 6/min & 60/day, global 300/day & 5,000/month; `AI_LIMIT_*` override).
- **Client address:** on Vercel (`VERCEL=1`) the platform-set `x-vercel-forwarded-for` / `x-real-ip` / `x-forwarded-for` are used; everywhere else (local, unknown host) only the socket peer address; `cf-connecting-ip` is never read; IPv6 is reduced to /64; the address is HMAC-SHA256'd with `RATE_LIMIT_SALT` (128 bits) — raw addresses and queries are never stored.
- **Errors:** provider failures become a coarse kind (`not_configured` / `unavailable` / `refused` / `invalid_output`); the provider's message is never kept. The browser only ever sees fixed strings. Logs contain outcome and token/cost numbers, never the query, the caller, or any key.
- **Deprecation:** `inputValidator` replaced by `validator`; the build warning is gone.
- **Removed:** the old Lovable gateway call, SSE parser and in-memory limiter. No `LOVABLE_API_KEY` reference remains in `src`.

## Files

**Changed:** `src/lib/bible/search.functions.ts` (now a thin shell that keeps the exported types and `searchScripture`), `package.json` / `package-lock.json` (scripts), `tsconfig.json`, `vitest.config.ts`, `.gitignore`.
**New (application):** `src/lib/bible/ai/` — `types.ts`, `input.ts`, `prompt.ts`, `rank.ts`, `config.server.ts`, `client-ip.server.ts`, `identity.server.ts`, `quota.server.ts`, `search-service.server.ts`, `providers/openai.server.ts`, `providers/index.server.ts`.
**New (tests, all mocked):** `*.test.ts` beside each module, `src/test/setup.ts`.
**New (manual, OFF by default):** `src/lib/bible/ai/live/` (`spend-guard.ts`, `eval-queries.ts`, `eval-score.ts`, `smoke.live.ts`, `eval.live.ts` + tests), `vitest.live.config.ts`, `scripts/check-bundle-secrets.mjs`.

## Turning it on for practical testing

`AI_SEARCH_ENABLED` is **off unless set**. Add one line to `.env.local` and restart `npm run dev`:
```
AI_SEARCH_ENABLED=true
```
Every other value already in `.env.local` is used as-is (`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`). Set it back to `false` (or remove it) to disable paid search instantly. Each search costs about $0.0001, so the dev limits cap practical testing well under $1.50/month even if hammered.

## Safeguards against accidental spending

- `npm test` blocks all network access (`src/test/setup.ts` replaces `fetch` with a function that throws) and removes credentials from the environment. Verified: five deliberate bugs (retries enabled, headers trusted everywhere, fail-open on database error, kill switch ignored, query limit raised) each made tests fail.
- Live tests live only in `*.live.ts`, run only through `vitest.live.config.ts`, and do nothing unless an exact approval phrase is set in the launching shell. Verified: both skip with no approval, and an approved-but-oversized request count (6) is refused before any request.
- A local ledger (`.ai-spend-ledger.json`, git-ignored; seeded with the two preflight probes, $0.000187) records tokens and cost per request, and every run is refused if its worst case would push the total past **$0.50**.

## Planned (NOT run) manual live tests

| Test | Command (after approval) | Requests | Worst case per request | Worst case total | Expected actual |
|---|---|---|---|---|---|
| Smoke | `$env:AI_LIVE_SMOKE_APPROVED="I-APPROVE-LIVE-OPENAI-SPEND"; $env:AI_LIVE_SMOKE_REQUESTS="3"; npm run live:smoke` (1–5) | 3 (max 5) | ≈ $0.00107 | ≈ $0.0032 (≈ $0.0053 for 5) | ≈ $0.0004 |
| Full evaluation (none vs low) | `$env:AI_LIVE_EVAL_APPROVED="I-APPROVE-FULL-EVALUATION"; npm run live:eval` | 80 (40 × 2) | ≈ $0.00107 | ≈ $0.086 | ≈ $0.01 |

The worst case assumes every request uses a generous input estimate plus the full 2,000-token output cap. Both are far below the $0.50 allowance; the evaluation is **not approved and not scheduled**.

## Remaining risks

1. **Not exercised end to end.** The server-function shell (`getRequest`, `getRequestIP`, dynamic import) and the real Supabase quota/auth path have been verified by type-checking, the production build, and unit tests with fakes — not by a real request. The first practical test in the browser is the real check (with `AI_SEARCH_ENABLED=true`).
2. **Quality unmeasured.** The 40-query evaluation has not been run. Earlier single probes suggested `effort: low` may return only one candidate; `none` is the default for that reason.
3. **Latency** looked like about 3–4 s per search in the probes; the UI already shows a searching state.
4. **Vercel behaviour** (client-IP headers, `VERCEL=1`, Node 22, environment variables) is documented but unverified until the deployment step.
5. **Generated Supabase types** predate migration 6, so the RPC is called through a narrow cast; regenerate the types later.
6. **Privacy:** guest queries are sent to OpenAI — disclose in the privacy policy and review OpenAI's current data terms.
7. **Hot global counters** (every search touches two shared rows) are fine at this scale.
8. **Tooling:** the `shell-quote` / `source-map-js` audit findings are unchanged (see `SECURITY_TRACKING.md`).
