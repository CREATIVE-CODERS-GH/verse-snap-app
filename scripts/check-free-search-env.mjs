// Read-only check of the environment before free Bible search is switched on. It looks at
// process.env only, prints PASS/FAIL lines with booleans, lengths and the Supabase host, and NEVER
// prints a secret value. It changes nothing and contacts nothing.
//
//   node scripts/check-free-search-env.mjs
//   node --env-file=.env.local scripts/check-free-search-env.mjs      (checks the local file's values)
//
// On Vercel, run it against a Preview deployment's variables (for example `vercel env pull` into a
// temporary file) or read the same list in the dashboard.
import { pathToFileURL } from "node:url";

export const APPROVED_PROJECT_REF = "shoztcflucpnfenohgcr";
export const OLD_LOVABLE_PROJECT_REF = "pnugxqkdelknprbhejur";

const hostOf = (value) => {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

/** Returns [{ name, ok, detail }] for the given environment. Details never contain secret values. */
export function checkEnv(env) {
  const results = [];
  const add = (name, ok, detail = "") => results.push({ name, ok, detail });

  const flag = (env.FREE_SEARCH_ENABLED ?? "").trim().toLowerCase();
  add(
    "FREE_SEARCH_ENABLED is unset (off, the default), false or true",
    flag === "" || flag === "true" || flag === "false",
    flag ? `value: ${flag}` : "not set: free search is off",
  );

  const url = env.SUPABASE_URL ?? "";
  const host = hostOf(url);
  add(
    "SUPABASE_URL points at the independent project",
    host === `${APPROVED_PROJECT_REF}.supabase.co`,
    host ? `host: ${host}` : "missing or not a URL",
  );
  add(
    "SUPABASE_URL is not the old Lovable project",
    !url.includes(OLD_LOVABLE_PROJECT_REF),
    url.includes(OLD_LOVABLE_PROJECT_REF) ? "it names the old project" : "",
  );
  const viteHost = hostOf(env.VITE_SUPABASE_URL ?? "");
  add(
    "browser URL (VITE_SUPABASE_URL) is the same project",
    viteHost === host && host !== null,
    viteHost ? `host: ${viteHost}` : "missing",
  );
  add(
    "SUPABASE_SERVICE_ROLE_KEY is set (server only)",
    (env.SUPABASE_SERVICE_ROLE_KEY ?? "").length >= 20,
    `length: ${(env.SUPABASE_SERVICE_ROLE_KEY ?? "").length}`,
  );
  add(
    "RATE_LIMIT_SALT is set and long enough (24+ characters)",
    (env.RATE_LIMIT_SALT ?? "").trim().length >= 24,
    `length: ${(env.RATE_LIMIT_SALT ?? "").trim().length}`,
  );

  const leaked = Object.keys(env).filter(
    (name) => /^VITE_/.test(name) && /SERVICE|SECRET|SALT|PRIVATE|PASSWORD|OPENAI/i.test(name),
  );
  add(
    "no secret is exposed through a VITE_ variable",
    leaked.length === 0,
    leaked.length ? `found: ${leaked.join(", ")}` : "",
  );

  add(
    "Smart Search (AI) stays off: AI_SEARCH_ENABLED is not true",
    (env.AI_SEARCH_ENABLED ?? "").trim().toLowerCase() !== "true",
  );
  // A server-only OpenAI key may be present while AI is off: it is never read or printed here. It is a
  // problem only if AI search is switched on (checked above) or the key leaks through a VITE_ variable.
  const hasKey = Boolean((env.OPENAI_API_KEY ?? "").trim());
  add(
    "a server-only OpenAI key is allowed while AI search is off",
    !hasKey || (env.AI_SEARCH_ENABLED ?? "").trim().toLowerCase() !== "true",
    hasKey ? "a key is present (value not read); AI search is off" : "no key present",
  );
  add(
    "the Smart Search button flag is off",
    (env.VITE_SMART_SEARCH_OFFERED ?? "").trim().toLowerCase() !== "true",
  );

  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = checkEnv(process.env);
  for (const r of results)
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
