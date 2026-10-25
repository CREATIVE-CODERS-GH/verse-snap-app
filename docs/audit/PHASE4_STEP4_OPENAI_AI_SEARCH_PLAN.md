# Phase 4, Step 4 (revised) — Independent AI Bible Search with OpenAI

*Revision of the Anthropic-based assessment (`PHASE4_STEP4_AI_SEARCH_ASSESSMENT.md`, now superseded where it names Anthropic; its rate-limiting, privacy, test and rollback reasoning still applies and is restated below). Written 2026-10-19. **Plan only: no application code, dependency, `.env`, remote database, auth record, Git or deploy change.** One draft SQL file was created outside the migrations folder (§5). Facts tagged **[docs]** were read from OpenAI's official documentation (`developers.openai.com/api/docs/…`) during this revision; items I could not confirm are marked **[unverified]**.*

---

## 1. OpenAI facts (official documentation)

### Models and prices **[docs: pricing and models pages]**
Standard text-token prices per 1M tokens (prompts ≤ 272K):

| Model ID | Input | Cached input | Output | Notes |
|---|---|---|---|---|
| **`gpt-6-luna`** | **$0.10** | $0.01 | **$0.50** | Described as OpenAI's most efficient model for focused, high-volume tasks; 1.05M context, 128K max output; reasoning effort `none`/`low`/`medium`(default)/`high`/`xhigh`/`max`; Responses + Chat Completions; structured outputs supported; knowledge cutoff May 18 2026 |
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 | Older generation; cheapest listed |
| `gpt-4.1-nano` | $0.10 | $0.025 | $0.40 | Non-reasoning, older |
| `gpt-5.4-nano` | $0.20 | $0.02 | $1.25 | |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 | |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 | |
| `gpt-6.1-sol` | $2.00 | $0.10 | $10.00 | Larger model; rejects `none`/`minimal` effort; quality reference |
| `gpt-6-astra` | $10.00 | $1.00 | $50.00 | The model the old Lovable gateway code asked for; does not support `none` effort |

Batch/Flex are about half price but not relevant for an interactive feature. Reasoning tokens are billed as output tokens.

### Structured outputs **[docs: structured-outputs guide]**
- Responses API: `text: { format: { type: "json_schema", name, strict: true, schema } }`. Chat Completions uses `response_format`. The guide's full strict-schema rules: every property must be in `required`, every object `additionalProperties: false`, root must be an object; no `allOf`/`not`/`if-then-else`; up to 5,000 properties and 10 nesting levels.
- Refusals and truncation must be checked in code: a `refusal` output item, and `status: "incomplete"` with `incomplete_details.reason` of `max_output_tokens` (truncated JSON) or `content_filter`.
- **Our existing `SCHEMA` already satisfies these rules**, and it is the same Responses-API `json_schema` shape the current Lovable-gateway code already sends. Nothing about the schema or response parsing contract changes.

### Reasoning and output limits **[docs: reasoning guide]**
`reasoning: { effort }` is model-dependent. `max_output_tokens` includes reasoning tokens; a cap that is too small can be spent entirely on reasoning, returning `status: "incomplete"` with no answer while still billing the tokens. OpenAI suggests generous headroom when experimenting; with effort `none`/`low` on this tiny task I propose `max_output_tokens: 2000` (worst case ≈ $0.001 per call) and treat `incomplete` as a failed lookup.

### SDK **[docs: openai-node README; `npm view`]**
Package `openai` (current 7.39.0). `new OpenAI({ apiKey })` reads `OPENAI_API_KEY` by default; `timeout` (default 10 min) and `maxRetries` (default 2: connection errors, 408, 409, 429, 5xx) are configurable; errors subclass `APIError` (`BadRequestError`, `AuthenticationError`, `PermissionDeniedError`, `RateLimitError`, `InternalServerError`, `APIConnectionError`, `APIConnectionTimeoutError`). **Requires Node ≥ 22** (local is 22.22 ✔; the Vercel project must be set to Node 22.x). Browser use is blocked by default (`dangerouslyAllowBrowser`), which we never enable. Peer dependency `zod` is `^3.25 || ^4.0`; our `zod ^3.25.76` fits, but I plan to use the plain `json_schema` format with our own validation rather than the Zod helper (the README page I read doesn't document `responses.parse`).

### Budgets and limits **[docs: rate-limits guide]**
Spend limits can be set at **organization or project** level. A *spend alert* only notifies; a *hard limit* caps monthly spend and affected requests return **HTTP 429**. The page names no specific error code for this and warns that `Retry-After` on a 429 means a temporary rate limit, **not** a fixable quota/billing condition — so the code must not retry budget 429s indefinitely. Usage tiers: Build ($5 total credit purchases) = $500 monthly usage limit, then Launch/Grow. `gpt-6-luna` default rate limits at Build tier: 5,000 RPM, 2M TPM **[docs: model page]** — far above our needs. The exact dashboard clicks for spend limits are not in the pages I read **[unverified]**; see §9.

---

## 2. Model recommendation

**Recommended: `gpt-6-luna` with `reasoning.effort = "low"`, configured by environment variable.**

Why:
- It is the cheapest *current-generation* OpenAI text model ($0.10 / $0.50 per MTok — identical to what the Anthropic option would have cost), with structured outputs, a recent knowledge cutoff and low-effort/no-reasoning modes suited to a short extraction task.
- The task is "name the Bible references a sentence describes" — it needs good recall of well-known scripture and nothing else; **truthfulness of the text is not at stake** because verses are always re-fetched from HelloAO. The failure mode of a weaker model is a wrong or missing reference, not wrong scripture text.
- `gpt-5-nano` / `gpt-4.1-nano` are a little cheaper but older and more likely to mis-recall verse numbers; a 2x saving on a ~$0.0003 request is irrelevant next to quality.
- `gpt-6.1-sol` is the quality ceiling: ~$0.006 per search (20x). Keep it as the escalation option if Luna fails the quality check.

**Decision rule (measured, not assumed):** before enabling for users, run a ~40-query evaluation set (exact quotes, partial quotes, paraphrases, topics, different translations' wording, typos, nonsense) through `gpt-6-luna` (effort `none` and `low`), `gpt-5-nano`, and `gpt-6.1-sol`. Score top-1 and top-3 hit rate, share of proposed references that don't exist (dropped by HelloAO), latency and `usage` cost. **Choose the cheapest configuration whose top-3 hit rate is within ~5 points of `gpt-6.1-sol`.** Model and effort stay switchable via `AI_SEARCH_MODEL` / `AI_SEARCH_EFFORT` without code changes. I have not run this evaluation; the recommendation is a starting hypothesis.

### Cost per search (estimate; confirm from `usage` in testing)
≈ 500 input tokens (system prompt + query) + ≈ 200 visible output tokens + ≈ 0–300 reasoning tokens at low effort → **≈ $0.0003 per search**. **$5 buys roughly 15,000 searches** on Luna.

---

## 3. Updated architecture

### Principles
Provider-neutral core; one small adapter per provider; the UI and `ScriptureSearchResponse` type never change; secrets only on the server; quota enforced before any paid call; fail closed.

```
Browser (UI unchanged: src/routes/search.tsx → searchScripture server fn)
   │  { query, translation }
   ▼
src/lib/bible/search.functions.ts      thin server function (validator, calls orchestrator)
   ▼
src/lib/bible/ai/search-service.server.ts   orchestrator
   1. validate/normalise query (2–200 chars, no control chars)
   2. AI enabled & provider configured?  (else friendly "not configured")
   3. in-memory result cache hit?  → return (no quota used)
   4. identify caller (optional auth → user:<uuid>, else ip:<keyed hash>)
   5. quota.consume(subject)  → denied/unavailable → friendly message
   6. provider.findCandidates(query)  ← the ONLY provider-specific step
   7. existing pipeline, unchanged: parseReference → HelloAO getVerse (verification)
      → score/rank → ScriptureSearchResponse
```

**Planned files** (all new except `search.functions.ts`, which is edited down):
| File | Role |
|---|---|
| `src/lib/bible/ai/types.ts` | `ReferenceProvider` interface, `ReferenceCandidate`, `AiProviderError` (kinds: `not_configured`, `unavailable`, `rate_limited`, `refused`, `invalid_output`) |
| `src/lib/bible/ai/prompt.ts` | Provider-neutral `SYSTEM_PROMPT` and `SCHEMA` moved verbatim from `search.functions.ts` |
| `src/lib/bible/ai/providers/openai.server.ts` | OpenAI adapter (Responses API, strict `json_schema`, error mapping, `usage` logging without content) |
| `src/lib/bible/ai/providers/index.server.ts` | `getProvider(env)` selecting by `AI_PROVIDER` (`openai` now; `disabled`; later `anthropic` etc.) |
| `src/lib/bible/ai/quota.server.ts` | Caller identity (JWT check, IP keyed hash with `RATE_LIMIT_SALT`), Supabase RPC call, limits from env |
| `src/lib/bible/ai/search-service.server.ts` | The orchestration above |
| `src/lib/bible/search.functions.ts` | Keeps types, ranking (`score`, `normalise`, `stem`, `withinOneEdit`), `runSearch` verification; its `askForCandidates`/`readStream`/in-memory limiter go away; `.inputValidator` → `.validator` |

`.server.ts` modules are loaded with a dynamic `import()` inside the server-function handler (the pattern documented in `src/integrations/supabase/client.server.ts`) so nothing secret can enter the client bundle. Provider interface:
```ts
interface ReferenceProvider {
  readonly id: string;
  findCandidates(input: { query: string; maxCandidates: number; signal?: AbortSignal }): Promise<ReferenceCandidate[]>;
}
```
Adding a provider later = one new adapter file + one `case` in `getProvider` + env values. The orchestrator, ranking, verification, quota, server function and UI are untouched.

### OpenAI adapter behaviour
- `new OpenAI({ apiKey: process.env["OPENAI_API_KEY"], timeout: 15_000, maxRetries: 1 })`, created lazily **inside** the handler (TanStack guidance **[docs]**); never `VITE_`-prefixed; never logged.
- `client.responses.create({ model, instructions: SYSTEM_PROMPT, input: query, reasoning: { effort }, max_output_tokens: 2000, text: { format: { type: "json_schema", name: "bible_references", strict: true, schema: SCHEMA } } })`. No `temperature` (reasoning-model parameter support is **[unverified]**, and unnecessary).
- Output handling: `status: "incomplete"` → `unavailable`; refusal item → `refused`; read the output text, `JSON.parse`, validate each item like the current code does; garbage → `invalid_output` (treated as no results with a soft failure, not an exception to the UI).
- Error mapping: 401/403 → `not_configured` (generic message, no provider detail); 429 (rate limit or spend limit — indistinguishable per the docs) and 5xx/timeouts → `unavailable`; the provider's raw message never reaches the browser (the old code did return it).
- Prompt injection: the model can only emit `{book, chapter, verse}` triples, each validated and re-resolved against HelloAO; nothing it writes is displayed.

---

## 4. Rate limiting (unchanged design, restated)

**Identity:** signed-in → `user:<uuid>` from a server-verified JWT (an *optional* variant of the existing `requireSupabaseAuth` logic, since guests send no token; an expired/invalid token is treated as a guest, not an error); guest → `ip:<HMAC-SHA256(ip, RATE_LIMIT_SALT) truncated>`; raw IPs are never stored. The client IP header on Vercel must be confirmed during deployment testing **[unverified]**; locally all requests share one bucket.

**Layers:** per-subject minute and day windows, global day and month windows, then the provider-side project spend limit as the final backstop. Cache hits are free. Quota is not refunded on provider failure (v1). Limiter unreachable → **fail closed** with a friendly message; non-AI search keeps working.

**Initial limits (env-tunable):**

| Limit | Production default | Dev default (for the $5 budget) |
|---|---|---|
| Guest / minute | 3 | 3 |
| Guest / day | 15 | 15 |
| Signed-in / minute | 6 | 6 |
| Signed-in / day | 60 | 60 |
| Global / day | 2,000 | **300** |
| Global / month | 30,000 | **5,000** (≈ $1.50 worst case) |

Prod worst case at defaults ≈ $9/month at Luna prices; dev worst case ≈ $1.50, leaving margin under the $5 target.

**Messages (shown in the existing error area, no UI change):** per-minute → "Too many searches just now. Try again in N seconds."; guest daily → "You've used today's free searches. Sign in for more, or try again tomorrow."; signed-in daily → "You've reached today's search limit."; global caps / limiter down / provider down → "Scripture search is unavailable right now."

---

## 5. Migration 6 design (prepared, not applied)

**Draft file:** [`supabase/migrations/20261019000200_ai_search_rate_limit.sql`](../../supabase/migrations/20261019000200_ai_search_rate_limit.sql). It is deliberately **outside `supabase/migrations/`**, so `supabase db push` cannot apply it. After your review it moves into `supabase/migrations/` (same name), followed by the usual `db push --dry-run` and project-ref confirmation. Nothing has been applied to any database.

What it creates:
- `public.ai_search_usage (subject, window_kind, window_start, used)`, primary key on the first three; index on `window_start`. **Counters only** — no query text, no raw IP, no user agent.
- **RLS enabled with no policies**; `revoke all` from `public, anon, authenticated`; privileges only for `service_role`. API users can neither read nor write it.
- `public.consume_ai_search_quota(subject, minute_limit, day_limit, global_day_limit, global_month_limit)` — `SECURITY DEFINER`, `search_path = ''`, executable by `service_role` only. It validates the subject format (`user:<uuid>` or `ip:<hex>`) and positive limits, upserts each window with `ON CONFLICT … DO UPDATE … WHERE used < limit`, and runs inside a sub-transaction so **if any window is full the whole attempt is rolled back** (a refused request consumes nothing, and an abuser cannot drain the global budget with rejected calls). Returns `(allowed, reason, retry_after_seconds)` with reasons `minute | day | global_day | global_month`. About 1% of calls also delete windows older than 35 days.
- No change to any existing table, policy, trigger or auth record.

**Privacy:** keyed hash of IP only; no search text stored; ~35-day retention. The search text itself **is sent to OpenAI** to identify references — disclose this in your privacy policy and review OpenAI's current API data-retention/training terms before production **[unverified here]**.

**Server credential implication:** calling the function requires `SUPABASE_SERVICE_ROLE_KEY` on the server only (never `VITE_`, never in Git; Sensitive variable on Vercel). It is used solely to call this function through the existing `client.server.ts` admin client. The function is not callable with the public key, so nobody can exhaust the global counters from outside.

**Planned verification (new SQL files, same self-cleaning safeguards as `02`):** `03_rate_limit_structure.sql` (read-only: table exists, RLS on, no policies, anon/authenticated lack privileges and cannot execute the function, `service_role` can) and `04_rate_limit_behavior.sql` (disposable subjects with a fixed test prefix, deleted by exact key: allows up to the limit, denies the next with the right `reason`, refusal rolls back all counters, window rollover, invalid subjects rejected, global caps).

---

## 6. Testing with Vitest

- **Tooling:** add `vitest` (current 5.0.5; peer `vite ^6.4 || ^7 || ^8` — our Vite 8.1.5 is covered **[`npm view`]**; Node ≥ 22.12 ✔) as a devDependency; `vitest.config.ts` (node environment, alias `@` → `src`); `npm test` / `npm run test:watch` scripts. These are the only config/package changes besides `openai`.
- The existing `helloao-provider.test.js` imports `bun:test`; I'll port it to Vitest (`vi.fn`) so one runner covers everything.
- **Unit tests (no network, no key):**
  - Orchestrator with a fake provider: normal query; invalid inputs (empty, 1 char, >200 chars, control characters, non-string); cache hit uses no quota; quota denied for each reason with the exact messages; quota backend error → fail closed; provider errors of each kind → friendly failure; unknown references dropped by verification; ranking unchanged.
  - OpenAI adapter with a mocked client: request shape (model, effort, `strict` schema, no temperature), `incomplete`, refusal, malformed JSON, schema-violating items, 401/429/5xx/timeout mapping; key never appears in logs/errors.
  - Quota module with a mocked Supabase client: subject formats, IP hashing is stable/different and never contains the raw IP, optional-auth handling (valid, expired, absent token), env-tunable limits.
  - Regression: `parseReference`, `classify-query`, `find-references`, HelloAO provider (ported test).
- **Live tests (manual, dev key, dev project spend-limited):** the ~40-query quality set and model comparison from §2; confirm `usage` cost; confirm results' text equals a direct HelloAO lookup.
- **SQL tests:** §5 scripts.
- **Static/build:** `tsc`; `npm run build` must no longer show the `inputValidator` warning; search the built client assets to confirm neither `OPENAI_API_KEY`'s prefix nor `SUPABASE_SERVICE_ROLE_KEY` appears.
- **Manual regression of non-AI paths:** typed references, voice reference, camera/OCR, chapter/verse navigation, translations, saved verses and history.

---

## 7. Rollback plan

| Level | Action | Effect |
|---|---|---|
| Instant (no deploy) | Set `AI_SEARCH_ENABLED=false` (or `AI_PROVIDER=disabled`, or unset `OPENAI_API_KEY`) | AI search returns the existing graceful "not configured" message; every other search method is unaffected |
| Cost emergency | Lower or set the OpenAI **project hard spend limit** to the current spend; or rotate/delete the API key | Calls stop within the provider; app shows "unavailable" |
| Code | `git revert` the Step 4 commits (never reset or force-push) | Restores the previous code path (which, once Lovable is gone, can only be "AI search disabled") |
| Database | Migration 6 is additive and unused when the code is off; leave it. If you ever want it gone, a later migration drops the function and table | No effect on users or existing tables |
| Provider swap | Change `AI_PROVIDER` and/or `AI_SEARCH_MODEL` | No code change |

Because Lovable's gateway disappears when Lovable is disconnected, "restore the old gateway" is possible only while the Lovable project still runs; the practical fallback is the disabled state above.

---

## 8. User-visible changes
- Results may rank slightly differently from the old model (same verification and ranking); the quality set measures this.
- New limit messages (§4) in the existing error area; **no layout or component changes**.
- Reference lookup, voice, camera, HelloAO verification and all other screens are unchanged.

---

## 9. Dev budget: $5 target
1. OpenAI organisation needs credits (Build tier = $5 total purchases **[docs]**).
2. Create a **separate project** (e.g. "verse-snap-dev") with its own API key and a **hard monthly spend limit of $5** (spend limits exist at project and organisation level **[docs]**; use the dashboard's project **Limits/Budget** setting — exact menu names **[unverified]**). Add a spend alert at about $3.
3. App-level dev caps (§4: 300/day, 5,000/month) keep expected spend near $1.50 even if everything is hammered.
4. Prefer restricting the project key's permissions/allowed models to what we use, if the dashboard offers it **[unverified]**.
5. Check the usage page after the first quality run; the 40-query evaluation across four configurations costs well under $0.10 on the small models and roughly $0.25 on `gpt-6.1-sol`.

---

## 10. Implementation sequence (after your review)
1. **Housekeeping approvals:** add `openai` (runtime) and `vitest` (dev) with npm; no other packages.
2. **Tests scaffolding:** `vitest.config.ts`, scripts, port the existing HelloAO test; run; commit nothing.
3. **Migration 6:** move the draft into `supabase/migrations/`; you run `db push --dry-run` and confirm ref `shoztcflucpnfenohgcr`; then (with your explicit "push") apply; then `03`/`04` SQL checks.
4. **AI module:** `types`, `prompt`, `quota.server`, OpenAI adapter, provider registry, orchestrator — each with unit tests first.
5. **Wire-in:** reduce `search.functions.ts` to the thin server function (move prompt/schema, keep ranking/verification), `.validator`, 200-char limit.
6. **Local live test** with your dev key and the quality set; choose model/effort per the §2 rule.
7. **Checks:** `npm test`, `tsc`, `npm run build`, bundle secret scan, non-AI regression.
8. **Docs:** update `ENVIRONMENT_VARIABLES.md`, `LOVABLE_DEPENDENCIES.md`, `.env.example` (names only).
9. Vercel deployment testing happens with Step 6 (build config).

---

## 11. Environment variables (names; values stay in `.env.local` / Vercel Sensitive variables)

| Variable | Scope | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | server secret | OpenAI access (dev project key locally; separate key per Vercel environment) |
| `AI_PROVIDER` | server | `openai` (default) / `disabled` |
| `AI_SEARCH_ENABLED` | server | Kill switch (`false` disables) |
| `AI_SEARCH_MODEL` | server | default `gpt-6-luna` |
| `AI_SEARCH_EFFORT` | server | default `low` |
| `SUPABASE_URL` | server | `https://shoztcflucpnfenohgcr.supabase.co` (needed by the existing server helper) |
| `SUPABASE_SERVICE_ROLE_KEY` | server secret | Call the quota function only |
| `RATE_LIMIT_SALT` | server secret | HMAC key for IP hashing (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `AI_LIMIT_GUEST_MINUTE`, `AI_LIMIT_GUEST_DAY`, `AI_LIMIT_USER_MINUTE`, `AI_LIMIT_USER_DAY`, `AI_LIMIT_GLOBAL_DAY`, `AI_LIMIT_GLOBAL_MONTH` | server | Override §4 defaults (set the dev values locally) |

---

## 12. What I need from you
**Approvals** (any "no" changes the sequence):
1. Add runtime dependency `openai` and dev dependency `vitest` with npm (nothing else).
2. Port the existing `bun:test` file to Vitest.
3. Accept `gpt-6-luna` @ `low` effort as the starting model, subject to the §2 evaluation, with `gpt-6.1-sol` as the escalation.
4. Accept the limits in §4 and fail-closed behaviour; 200-character query cap; the guest "sign in for more" message.
5. Approve moving migration 6 into `supabase/migrations/` and running the dry run when we reach that step.
6. Confirm guest queries may be sent to OpenAI and that you'll disclose it in your privacy policy.

**Setup you perform (never paste secrets in chat):**
1. OpenAI dashboard: ensure credits; create project "verse-snap-dev"; create an API key for it; set the project's monthly hard limit to **$5** and an alert near $3.
2. Supabase dashboard → Project Settings → API Keys: copy the secret/service-role key for `shoztcflucpnfenohgcr` into your password manager.
3. Generate `RATE_LIMIT_SALT` with the command above.
4. Add to `.env.local` (I won't edit it): `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, plus the dev limit overrides from §4; restart `npm run dev`.
5. Later, on Vercel: same names as **Sensitive** variables per environment (Production and Preview with different OpenAI keys), Node.js version 22.x, redeploy after changes **[docs: changes apply only to new deployments]**.

I'll wait for your review before changing any application code.

---

## Sources
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI models and `gpt-6-luna`: https://developers.openai.com/api/docs/models , https://developers.openai.com/api/docs/models/gpt-6-luna
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
- OpenAI rate limits / spend limits: https://developers.openai.com/api/docs/guides/rate-limits
- OpenAI Node SDK: https://github.com/openai/openai-node ; versions via `npm view openai` / `npm view vitest`
- TanStack Start environment variables and hosting; Vercel environment variables (as cited in the earlier assessment)
