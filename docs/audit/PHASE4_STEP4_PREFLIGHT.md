# Phase 4, Step 4 — Pre-implementation preflight results

*2026-10-19. No secret value was printed or logged; checks printed booleans, formats and counts only. No database row, auth record, UI or Git state was changed. One tiny paid OpenAI test was made (≈ $0.0002 total).*

| # | Check | Result |
|---|---|---|
| 1 | Required variable names present in `.env.local` | **All 6 set:** `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Optional `AI_*` variables are unset, so code defaults will apply (model `gpt-6-luna`, dev limits to be set by default in code or added to the file). No other names in the file. Shape checks all pass: OpenAI key format, `SUPABASE_URL` is the dev project, service-role key is the new `sb_secret_` format and differs from the publishable key, salt ≥ 32 chars and distinct from the other secrets, no secret-looking `VITE_` name, no `VITE_` value equals a secret. |
| 2 | `.env.local` ignored by Git | **Yes** — `.gitignore:17` (`*.local`); not tracked; never in any commit. |
| 3 | Server-only admin client → `consume_ai_search_quota` | **Works.** Loading the project's real `src/integrations/supabase/client.server.ts` with the service-role key, a call with a deliberately invalid subject returned `P0001 invalid subject` — i.e. the key authenticated and reached the function body (a permission error would have been `42501`). Because the function validates the subject before writing, this proved access **without changing data**. The service key can also read the table (count 0, no rows written). The publishable key is refused: function → `42501 permission denied for function consume_ai_search_quota`; table read → refused. |
| 4 | Secrets cannot enter browser bundles | **Confirmed for the current code.** Fresh build scanned: 45 browser files in `.output/public` and 81 server files — none contains the OpenAI key, service-role key or salt value; no key-shaped strings; no secret variable names. (An earlier `sk-` hit was the CSS text `mask-i…`, a false positive; the scanner now requires a word boundary.) Source: the only references to `SUPABASE_SERVICE_ROLE_KEY` are in `client.server.ts`; the only `import.meta.env` reads are `VITE_SUPABASE_*` and `PROD`. This is a baseline: the same scan must be re-run after the AI module is wired in (planned in the test steps). |
| 5 | Trustworthy client IP | See §A below. |
| 6 | OpenAI model access | **Yes.** `models.retrieve("gpt-6-luna")` succeeded, and two live Responses calls using the app's real system prompt and strict `json_schema` succeeded. See §B. |

## A. Client IP: what is trustworthy, locally and on Vercel

**Problem in the current code** (`search.functions.ts`): `getRequestHeader("cf-connecting-ip") ?? getRequestIP({ xForwardedFor: true })`. I read the installed h3 source: `getRequestIP({ xForwardedFor: true })` returns the **first value of the incoming `x-forwarded-for` header**, which any client can set unless a trusted proxy overwrites it; `cf-connecting-ip` is only meaningful behind Cloudflare. Used as a rate-limit key, either lets a caller choose their own bucket. Both will be removed.

**Rules for the new `resolveClientIp`:**
| Environment | Source used | Why |
|---|---|---|
| **Vercel** (detected by the platform variable `VERCEL=1`) | `x-vercel-forwarded-for` (fallback `x-real-ip`, then `x-forwarded-for`) | Vercel documents `x-forwarded-for` as the requester's public IP, says it **overwrites** the header and does not forward external values "to prevent IP spoofing" (custom values only via an Enterprise trusted-proxy plan); `x-vercel-forwarded-for` and `x-real-ip` are identical to it. Vercel never sets `cf-connecting-ip`, so it is never read. |
| **Local dev / any other host** | The **socket peer address only** (h3 `getRequestIP()` without the `xForwardedFor` option → the server's own connection address); every forwarding header is ignored | On a developer machine there is no trusted proxy. All local requests share one bucket (`::1`/`127.0.0.1`), which is fine and is not spoofable. |
| Another host behind a known proxy later | An explicit opt-in setting naming the single trusted header | Never auto-trusted |
| No address available | A shared, strict "unknown" bucket | Fail safe |

Extras: IPv6 addresses are reduced to their /64 prefix before hashing (otherwise one user can rotate through a /64 for free); the address is then HMAC-SHA256'd with `RATE_LIMIT_SALT` and truncated — only the hash ever reaches the database. Unit tests will prove that a spoofed `x-forwarded-for`/`cf-connecting-ip` does not change the bucket when not on Vercel. **Still to verify on a real Vercel deployment** (preview): a single probe request echoing which header values arrive, run during deployment testing (Step 6).

## B. Live OpenAI test (model `gpt-6-luna`, real prompt/schema, query "love is patient")

| Setting | Outcome | Tokens (in / out / reasoning) | Est. cost | Latency |
|---|---|---|---|---|
| `reasoning.effort = "low"` | completed, valid strict JSON, **1** reference (1 Corinthians 13:4) | 299 / 82 / 52 | ≈ $0.000071 | ≈ 3.7 s |
| `reasoning.effort = "none"` | completed, valid strict JSON, **12** references (first: 1 Corinthians 13:4) | 299 / 172 / 0 | ≈ $0.000116 | ≈ 3.0 s |

What this confirms: the model ID is accessible to our account; the Responses API accepts `reasoning.effort` of both `low` and `none` on this model, `max_output_tokens`, and strict `json_schema` output with our existing `SCHEMA`; no refusal, no incomplete status; usage fields include reasoning tokens as documented.

Observations that update the plan (single-query samples, not conclusions):
1. **Cost is lower than estimated:** ≈ $0.0001 per search (299 input tokens, not ~500), so $5 ≈ 40,000+ searches.
2. **Latency is ≈ 3–4 s**, higher than the ~1 s assumed. The UI already shows a searching state, but the evaluation should record latency; this favours `none`/`low` effort and may influence the model choice.
3. **`low` returned a single reference while `none` returned the full 12.** The ranking pipeline is designed around a candidate list, so a model that stops at the one famous verse could hurt recall on ambiguous queries. The ~40-query evaluation should compare candidate counts as well as top-3 accuracy, and `none` may become the default effort.
4. `temperature` was not sent and is not needed.

## C. Decisions and requirements carried into implementation
- Remove `cf-connecting-ip`/`xForwardedFor` trust (§A).
- The quota function is called only through the server-only admin client, with a validated subject.
- The scan script will be run again after wiring; the scratch scripts used here live outside the repo and are not committed.
- Defaults to set in code until `AI_*` variables are added: guest 3/min & 15/day, signed-in 6/min & 60/day, dev global 300/day & 5,000/month.
