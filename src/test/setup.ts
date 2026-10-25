// Vitest setup for every automated test run.
//
// Guarantees that `npm test` can never make a paid (or any) network request:
//  - real network access is replaced by a function that throws, so a test that forgets to mock
//    fails loudly instead of spending money; tests that need fetch stub it with vi.stubGlobal;
//  - provider and database credentials are removed from the environment, so nothing in a test can
//    authenticate even if it tried. Tests that need a value set a fake one explicitly.
import { afterEach, beforeEach } from "vitest";

const SECRET_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RATE_LIMIT_SALT",
  "AI_SEARCH_ENABLED",
  "AI_PROVIDER",
  "AI_SEARCH_MODEL",
  "AI_SEARCH_EFFORT",
  "AI_LIMIT_GUEST_MINUTE",
  "AI_LIMIT_GUEST_DAY",
  "AI_LIMIT_USER_MINUTE",
  "AI_LIMIT_USER_DAY",
  "AI_LIMIT_GLOBAL_DAY",
  "AI_LIMIT_GLOBAL_MONTH",
  "VERCEL",
];

const realFetch = globalThis.fetch;

function blockedFetch(): never {
  throw new Error("Network access is blocked in automated tests. Mock it with vi.stubGlobal.");
}

beforeEach(() => {
  for (const name of SECRET_NAMES) delete process.env[name];
  globalThis.fetch = blockedFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});
