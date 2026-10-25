import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static guard for "secrets cannot reach the browser". It needs no build, so it runs in
// `npm test`. The built output is checked separately by `npm run check:bundle`.

const SRC = path.resolve(__dirname, "../../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "test" || entry.name === "live" ? [] : walk(full); // dev-only tooling is not shipped
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(SRC);
const isServerOnly = (file: string) => /\.server\.ts$/.test(file);
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, "/");

const LIVE_DIR = path.join(SRC, "lib/bible/ai/live");

describe("browser bundle safety", () => {
  it("finds the source files (sanity check)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("keeps every secret environment variable inside *.server.ts files", () => {
    const secrets = /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|RATE_LIMIT_SALT|ANTHROPIC_API_KEY/;
    const offenders = files.filter(
      (f) => !isServerOnly(f) && secrets.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never imports the OpenAI SDK or the service-role client from a non-server file", () => {
    const risky = /from\s+["'](openai|[^"']*client\.server)["']/;
    const offenders = files.filter(
      (f) => !isServerOnly(f) && risky.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never statically imports a *.server module from a non-server file (dynamic import only)", () => {
    const staticImport = /^\s*import[^;]*from\s+["'][^"']*\.server["']/m;
    const offenders = files.filter(
      (f) => !isServerOnly(f) && staticImport.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("loads the search service with a dynamic import inside the server function", () => {
    const text = fs.readFileSync(path.join(SRC, "lib/bible/search.functions.ts"), "utf8");
    expect(text).toMatch(/await import\(["']\.\/ai\/search-service\.server["']\)/);
  });

  it("exposes only the public Supabase values through VITE_ variables in source", () => {
    const viteNames = new Set<string>();
    for (const file of files) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/VITE_[A-Z0-9_]+/g))
        viteNames.add(match[0]);
    }
    for (const name of viteNames) {
      expect(name).not.toMatch(/OPENAI|SECRET|SERVICE|SALT|PRIVATE|TOKEN|PASSWORD/);
    }
  });

  it("lets nothing in the app import the manual live-test tooling", () => {
    expect(fs.existsSync(LIVE_DIR)).toBe(true);
    const importsLive = /from\s+["'][^"']*\/live\/[^"']*["']/;
    const offenders = files.filter((f) => importsLive.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("keeps the AI modules free of forwarding-header trust shortcuts", () => {
    const text = files
      .filter((f) => rel(f).startsWith("lib/bible"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(text).not.toMatch(/xForwardedFor:\s*true/);
    expect(text).not.toMatch(/getRequestHeader\(["']cf-connecting-ip/);
  });
});
