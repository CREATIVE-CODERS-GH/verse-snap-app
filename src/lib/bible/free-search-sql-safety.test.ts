import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Static review of the SQL that would be applied to the Supabase project, and of the environment check
// script. Nothing here connects to a database.
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

const NEW_TABLES = ["bible_sources", "bible_verses", "bible_words", "free_search_usage"];
const NEW_FUNCTIONS = ["search_bible", "refresh_bible_words", "consume_free_search_quota"];
const MIGRATIONS = [
  "supabase/migrations/20261023000000_bible_search_index.sql",
  "supabase/migrations/20261023000100_free_search_rate_limit.sql",
];
const ROLLBACKS = [
  "supabase/rollbacks/20261023000000_bible_search_index.down.sql",
  "supabase/rollbacks/20261023000100_free_search_rate_limit.down.sql",
];

/** SQL without comments and string literals, lower case: only statements remain. */
const sqlCode = (file: string) =>
  read(file)
    .replace(/--.*$/gm, "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .toLowerCase();
const targets = (sql: string, pattern: RegExp) =>
  [...sql.matchAll(pattern)].map((m) => (m[1] ?? "").replace(/^public\./, "").replace(/[("]/g, ""));

describe("the migrations are additive (nothing existing can be changed or lost)", () => {
  for (const file of MIGRATIONS) {
    const name = file.split("/").pop();
    const sql = sqlCode(file);

    it(`${name}: no drop, truncate, update or alter of an existing object`, () => {
      expect(sql).not.toMatch(/\bdrop\b/);
      expect(sql).not.toMatch(/\btruncate\b/);
      expect(sql).not.toMatch(/(?<!do )\bupdate\s+(public\.)?\w+\s+set\b/);
      for (const t of targets(sql, /\balter\s+table\s+(?:if exists\s+)?([\w.]+)/g)) {
        expect(NEW_TABLES, `alter table ${t}`).toContain(t);
      }
      expect(sql).not.toMatch(/\balter\s+(?!table\b)\w+/);
    });

    it(`${name}: creates only the new tables, functions, indexes, the schema and one extension`, () => {
      for (const t of targets(sql, /\bcreate\s+table\s+(?:if not exists\s+)?([\w.]+)/g)) {
        expect(NEW_TABLES, `create table ${t}`).toContain(t);
      }
      for (const f of targets(sql, /\bcreate\s+(?:or replace\s+)?function\s+([\w.]+)/g)) {
        expect(NEW_FUNCTIONS, `create function ${f}`).toContain(f);
      }
      for (const e of targets(sql, /\bcreate\s+extension\s+(?:if not exists\s+)?(\w+)/g)) {
        expect(["fuzzystrmatch"], `extension ${e}`).toContain(e);
      }
      for (const s of targets(sql, /\bcreate\s+schema\s+(?:if not exists\s+)?(\w+)/g)) {
        expect(["extensions"], `schema ${s}`).toContain(s);
      }
      expect(sql).not.toMatch(/\bcreate\s+(?:view|trigger|policy|role|user|rule)\b/);
      expect(sql).not.toMatch(/\bcreate\s+table\s+\S+\s+as\b/);
    });

    it(`${name}: deletes only from its own derived or counter tables, inserts only seed and counter rows`, () => {
      for (const t of targets(sql, /\bdelete\s+from\s+([\w.]+)/g)) {
        expect(["bible_words", "free_search_usage"], `delete from ${t}`).toContain(t);
      }
      for (const t of targets(sql, /\binsert\s+into\s+([\w.]+)/g)) {
        expect(["bible_sources", "bible_words", "free_search_usage"], `insert into ${t}`).toContain(
          t,
        );
      }
    });

    it(`${name}: every grant and revoke is about its own objects, and only service_role is granted anything`, () => {
      for (const m of sql.matchAll(
        /\b(?:grant|revoke)\s+[\w, ]+?\s+on\s+(?:function\s+)?([\w.,() [\]]+?)\s+(?:from|to)\b/g,
      )) {
        for (const item of (m[1] ?? "").split(/,(?![^(]*\))/)) {
          const objectName = item
            .trim()
            .replace(/^public\./, "")
            .replace(/\(.*$/s, "");
          expect([...NEW_TABLES, ...NEW_FUNCTIONS], `grant/revoke on ${objectName}`).toContain(
            objectName,
          );
        }
      }
      for (const m of sql.matchAll(/\bgrant\b[^;]*?\bto\s+([\w, ]+);/g)) {
        expect((m[1] ?? "").trim(), "grant target").toBe("service_role");
      }
    });
  }

  it("the rollbacks drop only the new objects, never an extension, schema or user data", () => {
    for (const file of ROLLBACKS) {
      const sql = sqlCode(file);
      for (const t of targets(sql, /\bdrop\s+table\s+(?:if exists\s+)?([\w.]+)/g)) {
        expect(NEW_TABLES, `drop table ${t}`).toContain(t);
      }
      for (const f of targets(sql, /\bdrop\s+function\s+(?:if exists\s+)?([\w.]+)/g)) {
        expect(NEW_FUNCTIONS, `drop function ${f}`).toContain(f);
      }
      expect(sql).not.toMatch(
        /\bdrop\s+(?:extension|schema|role|database|policy|trigger|view|index)\b/,
      );
      expect(sql).not.toMatch(/\bdelete\b|\btruncate\b|\bupdate\b/);
    }
  });

  it("neither the migrations nor the rollbacks touch user-data tables or auth", () => {
    for (const file of [...MIGRATIONS, ...ROLLBACKS]) {
      expect(sqlCode(file), file).not.toMatch(
        /\bauth\.|saved_verses|reading_history|highlights|notebooks|reflections|profiles|\btranslations\b/,
      );
    }
  });

  it("the search functions are not security definer, and the one definer function pins its search path", () => {
    const search = sqlCode(MIGRATIONS[0]!);
    expect(search).not.toMatch(/security\s+definer/);
    const quota = sqlCode(MIGRATIONS[1]!);
    expect(quota).toMatch(/security\s+definer\s+set\s+search_path\s*=\s*''/);
  });

  it("every function pins an empty search path and carries a database-side time limit", () => {
    for (const file of MIGRATIONS) {
      const raw = read(file);
      const functions = raw.split(/create or replace function /i).slice(1);
      for (const body of functions) {
        const header = body.slice(0, body.indexOf("$$"));
        expect(header, header.slice(0, 60)).toMatch(/set search_path = ''/);
        if (!/refresh_bible_words/.test(header)) {
          expect(header, header.slice(0, 60)).toMatch(/set statement_timeout = '\d+s'/);
        }
      }
    }
  });
});

describe("the read-only pre-flight SQL", () => {
  it("is one select statement with no write, DDL, grant, copy or procedural block", () => {
    const sql = sqlCode("supabase/verification/08a_bible_search_preflight.sql");
    expect(sql).not.toMatch(
      /(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze|reindex|set|reset|notify|listen|lock|comment|security|refresh)/,
    );
    expect(sql.match(/;/g) ?? []).toHaveLength(1);
    expect(sql.trim()).toMatch(/^with checks/);
  });
});

describe("environment check script", () => {
  const load = async () =>
    (await import(pathToFileURL(join(root, "scripts/check-free-search-env.mjs")).href)) as {
      checkEnv(
        env: Record<string, string | undefined>,
      ): { name: string; ok: boolean; detail: string }[];
    };
  const good = {
    FREE_SEARCH_ENABLED: "false",
    SUPABASE_URL: "https://shoztcflucpnfenohgcr.supabase.co",
    VITE_SUPABASE_URL: "https://shoztcflucpnfenohgcr.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value-that-is-long-enough",
    RATE_LIMIT_SALT: "a-long-random-salt-value-0123456789",
    VERCEL_ENV: "preview",
  };
  const failing = async (env: Record<string, string | undefined>) =>
    (await load())
      .checkEnv(env)
      .filter((r) => !r.ok)
      .map((r) => r.name);

  it("passes for the intended Preview configuration", async () => {
    expect(await failing({ ...good, FREE_SEARCH_ENABLED: "true" })).toEqual([]);
    expect(await failing(good)).toEqual([]);
  });

  it("refuses the old Lovable project and any other host", async () => {
    const old = "https://pnugxqkdelknprbhejur.supabase.co";
    expect(await failing({ ...good, SUPABASE_URL: old, VITE_SUPABASE_URL: old })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("independent project"),
        expect.stringContaining("old Lovable"),
      ]),
    );
    expect(await failing({ ...good, SUPABASE_URL: "https://example.com" })).toEqual(
      expect.arrayContaining([expect.stringContaining("independent project")]),
    );
  });

  it("refuses a short salt, a missing key, a leaked secret, and AI on", async () => {
    expect(await failing({ ...good, RATE_LIMIT_SALT: "short" })).toEqual([
      expect.stringContaining("RATE_LIMIT_SALT"),
    ]);
    expect(await failing({ ...good, SUPABASE_SERVICE_ROLE_KEY: undefined })).toEqual([
      expect.stringContaining("SERVICE_ROLE"),
    ]);
    expect(await failing({ ...good, VITE_SUPABASE_SERVICE_ROLE_KEY: "x" })).toEqual([
      expect.stringContaining("VITE_"),
    ]);
    expect(await failing({ ...good, AI_SEARCH_ENABLED: "true" })).toEqual([
      expect.stringContaining("Smart Search"),
    ]);
  });

  it("allows a server-only OpenAI key while AI search is off, without reading its value", async () => {
    expect(await failing({ ...good, OPENAI_API_KEY: "sk-secret-openai-value-123" })).toEqual([]);
  });

  it("never prints a secret value", async () => {
    const output = JSON.stringify(
      (await load()).checkEnv({ ...good, OPENAI_API_KEY: "sk-secret-openai-value-123" }),
    );
    for (const secret of [
      good.SUPABASE_SERVICE_ROLE_KEY,
      good.RATE_LIMIT_SALT,
      "sk-secret-openai-value-123",
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
