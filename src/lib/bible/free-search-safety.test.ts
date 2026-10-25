import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static guards for the free-search request path: secrets stay on the server, the query is never
// stored or logged, and the database is reached from one module only.
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");
/** Source without block comments and whole-line comments, so prose cannot trip a check. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "live" || entry.name === "test" ? [] : walk(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [rel] : [];
  });
}
const sources = walk("src");
const browserSide = sources.filter((f) => !/\.server\.ts$/.test(f));
const freeFiles = sources.filter((f) => /free-search/.test(f) || f === "src/routes/search.tsx");

describe("free search: server and browser separation", () => {
  it("the server function is a POST and loads the service with a dynamic import", () => {
    const text = read("src/lib/bible/free-search.functions.ts");
    expect(text).toContain('createServerFn({ method: "POST" })');
    expect(text).toMatch(/await import\(["']\.\/free-search\.server["']\)/);
    expect(text).not.toMatch(/^import[^;]*free-search\.server/m);
  });

  it("no browser-side file touches the index, the quota functions or the service-role client", () => {
    const offenders = browserSide.filter((f) =>
      /search_bible|consume_free_search_quota|refresh_bible_words|bible_verses|bible_sources|client\.server|SERVICE_ROLE|RATE_LIMIT_SALT/.test(
        code(f),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("the protocol and client modules import nothing from a server module", () => {
    for (const file of ["free-search-protocol.ts", "free-search.ts", "free-search-mock.ts"]) {
      expect(code(`src/lib/bible/${file}`), file).not.toMatch(/from\s+["'][^"']*\.server["']/);
    }
  });

  it("only the server module reaches the database, and always by POST (no GET rpc)", () => {
    const text = code("src/lib/bible/free-search.server.ts");
    expect(text).not.toMatch(/\bget\s*:\s*true|method:\s*["']GET/i);
    expect(text).toMatch(/\.rpc\(\s*"search_bible"/);
    expect(text).toMatch(/\.rpc\(\s*"consume_free_search_quota"/);
  });
});

describe("free search: the query is never stored or logged", () => {
  it("none of the free-search files writes to browser storage, history or analytics with the query", () => {
    for (const file of freeFiles) {
      const text = code(file);
      expect(text, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
    const route = code("src/routes/search.tsx");
    // Analytics events on this screen carry the kind or the length of a search, never its text.
    for (const match of route.matchAll(/trackEvent\("[a-z_]+",\s*\{([^}]*)\}/g)) {
      expect((match[1] ?? "").replace(/"[^"]*"/g, "")).not.toMatch(
        /\bquery\b(?!\.length)|description(?!\.length)|trimmedText|\bq\b/,
      );
    }
  });

  it("the server module logs only through its fixed-shape logger and never prints a query", () => {
    const text = code("src/lib/bible/free-search.server.ts");
    const consoleCalls = [...text.matchAll(/console\.(log|info|warn|error)\(([^;]*)\)/g)].map(
      (m) => m[2],
    );
    expect(consoleCalls.length).toBeGreaterThan(0);
    for (const args of consoleCalls) {
      expect(args).not.toMatch(/query|checked|request|rawRequest|\bdata\b|message|stack/i);
    }
  });

  it("error handling reads a code, never an error message", () => {
    const text = read("src/lib/bible/free-search.server.ts");
    expect(text).not.toMatch(
      /error\.message|\.details|\.hint|String\(error\)|JSON\.stringify\(error\)/,
    );
  });

  it("the migrations keep the search function from storing anything", () => {
    const sql = read("supabase/migrations/20261023000000_bible_search_index.sql");
    const body = sql.slice(sql.indexOf("create or replace function public.search_bible"));
    expect(body.slice(0, body.indexOf("revoke execute"))).not.toMatch(
      /\binsert\s+into\b|\bupdate\s+public\b|\bdelete\s+from\b|raise\s+notice|raise\s+log/i,
    );
  });
});
