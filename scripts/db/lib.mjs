// Shared helpers for the database tests in scripts/db: a THROWAWAY local PostgreSQL 17 (never
// Supabase) with a minimal stand-in for Supabase's auth schema and API roles.
//
// One-time setup (installs outside the repo; package.json and node_modules are not touched):
//   npm install --prefix <folder> embedded-postgres@17.10.0-beta.17 pg@8.23.1
// and run a test with DB_TEST_DEPS=<folder>.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export const MIGRATIONS = "supabase/migrations";
export const read = (file) => fs.readFileSync(file, "utf8");

export async function startDatabase({ port = Number(process.env.DB_TEST_PORT ?? 54330) } = {}) {
  const depsDir = process.env.DB_TEST_DEPS;
  if (!depsDir) {
    console.error(
      "Set DB_TEST_DEPS to the folder with embedded-postgres and pg (see scripts/db/lib.mjs).",
    );
    process.exit(2);
  }
  const requireDep = createRequire(path.join(path.resolve(depsDir), "package.json"));
  const { default: EmbeddedPostgres } = await import(
    "file://" + requireDep.resolve("embedded-postgres").replace(/\\/g, "/")
  );
  const { Client } = requireDep("pg");

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "versesnap-pg-"));
  const password = Math.random().toString(36).slice(2);
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password,
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("versesnap");

  const connect = async () => {
    const client = new Client({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password,
      database: "versesnap",
    });
    await client.connect();
    return client;
  };
  const db = await connect();
  const q = async (sql, params) => (await db.query(sql, params)).rows;

  let passed = 0;
  let failed = 0;
  const check = (name, ok, detail = "") => {
    if (ok) passed += 1;
    else failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
  };
  const shutdown = async () => {
    console.log(`\n${passed} passed, ${failed} failed`);
    await db.end().catch(() => {});
    await server.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  };
  process.on("unhandledRejection", async (error) => {
    check(`test stopped: ${error?.message ?? error}`, false);
    await shutdown();
  });

  // Supabase stand-ins: the parts the migrations and RLS use.
  await q(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key, aud text, role text, email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz default now()
    );
    create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
    -- Same definition as Supabase: the JWT subject passed in by the API.
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                             (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    -- Supabase's default privileges: new public tables are granted to the API roles.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);

  /** Applies the repo's migrations in order, stopping before `stopBefore` (a version prefix). */
  const applyMigrations = async (stopBefore) => {
    for (const file of fs.readdirSync(MIGRATIONS).sort()) {
      if (stopBefore && file >= stopBefore) break;
      await q(read(path.join(MIGRATIONS, file)));
    }
  };

  /** Runs one statement as the API does for a signed-in person (role + JWT subject). */
  const asUser = async (client, userId, sql, params) => {
    await client.query("begin");
    try {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const result = await client.query(sql, params);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  };

  const expectError = async (fn, pattern) => {
    try {
      await fn();
      return "no error";
    } catch (error) {
      return pattern.test(error.message) ? true : error.message;
    }
  };

  /** The last result set of a multi-statement query. */
  const lastRows = (result) => (Array.isArray(result) ? result[result.length - 1] : result).rows;

  return { db, q, connect, check, shutdown, applyMigrations, asUser, expectError, lastRows };
}
