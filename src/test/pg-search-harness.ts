import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  StoreError,
  readFreeSearchConfig,
  type FreeSearchDeps,
  type FreeSearchLog,
  type FreeSearchStore,
  type SearchRow,
} from "@/lib/bible/free-search.server";

/*
 * Test-only helper (never shipped: src/test is excluded from the bundle checks). Starts a DISPOSABLE
 * local PostgreSQL 17 (never Supabase), applies the repo's migrations and loads the approved editions
 * from the import pipeline's output, then offers a `FreeSearchStore` that calls the same SQL functions
 * PostgREST would call, as service_role, with bound parameters.
 *
 *   DB_TEST_DEPS=<folder with embedded-postgres and pg>  BIBLE_IMPORT_DIR=<prepare-bible-import output>
 */

export const harnessEnabled = Boolean(
  process.env["DB_TEST_DEPS"] &&
  process.env["BIBLE_IMPORT_DIR"] &&
  existsSync(join(process.env["BIBLE_IMPORT_DIR"], "manifest.json")),
);

export interface PgClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
export interface Harness {
  q(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  connect(): Promise<PgClient>;
  stop(): Promise<void>;
  applyMigrations(): Promise<void>;
}

/** Starts the database, applies the migrations, imports and promotes WEB, BSB and ASV. */
export async function startLoadedDatabase(port: number): Promise<Harness> {
  const lib = (await import(pathToFileURL(join(process.cwd(), "scripts/db/lib.mjs")).href)) as {
    startDatabase(o: { port: number; initdbFlags: string[] }): Promise<Harness>;
  };
  const h = await lib.startDatabase({ port, initdbFlags: ["--encoding=UTF8", "--locale=en-US"] });
  await h.q(`create schema extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  await h.applyMigrations();
  const dir = process.env["BIBLE_IMPORT_DIR"]!;
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    editions: Record<string, { files: { name: string }[] }>;
  };
  for (const code of ["WEB", "BSB", "ASV"]) {
    for (const file of manifest.editions[code]!.files) {
      await h.q(readFileSync(join(dir, code, file.name), "utf8"));
    }
  }
  await h.q("analyze public.bible_verses; analyze public.bible_words");
  return h;
}

/** A small connection pool, so load tests measure the search and not connection set-up. */
export async function createPool(h: Harness, size: number) {
  const clients = await Promise.all(Array.from({ length: size }, () => h.connect()));
  const free = [...clients];
  const waiting: ((c: PgClient) => void)[] = [];
  return {
    acquire: () =>
      free.length > 0
        ? Promise.resolve(free.pop()!)
        : new Promise<PgClient>((resolve) => waiting.push(resolve)),
    release(c: PgClient) {
      const next = waiting.shift();
      if (next) next(c);
      else free.push(c);
    },
    async end() {
      await Promise.all(clients.map((c) => c.end().catch(() => {})));
    },
  };
}
export type Pool = Awaited<ReturnType<typeof createPool>>;

export function pgStore(
  h: Harness,
  options: { statementTimeoutMs?: number; role?: string; pool?: Pool } = {},
): FreeSearchStore {
  const run = async (sql: string, values: unknown[], signal: AbortSignal, timeoutMs = 5000) => {
    if (signal.aborted) throw new StoreError("timeout");
    const client = options.pool ? await options.pool.acquire() : await h.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${options.role ?? "service_role"}`);
      await client.query(`set local statement_timeout = ${timeoutMs}`);
      const result = await client.query(sql, values);
      await client.query("commit");
      return result.rows;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      const code = (error as { code?: string }).code;
      throw new StoreError(code === "57014" ? "timeout" : "unavailable", code);
    } finally {
      if (options.pool) options.pool.release(client);
      else await client.end().catch(() => {});
    }
  };
  return {
    async listActiveEditions(signal) {
      const rows = await run(
        "select edition_code from public.bible_sources where status = 'active' and license_status = 'approved'",
        [],
        signal,
      );
      return rows.map((r) => String(r["edition_code"]));
    },
    async consumeQuota(args, signal) {
      try {
        const rows = await run(
          "select * from public.consume_free_search_quota($1, $2, $3, $4)",
          [args.subject, args.minuteLimit, args.dayLimit, args.globalMinuteLimit],
          signal,
        );
        const r = rows[0];
        if (!r) return null;
        return {
          allowed: r["allowed"] === true,
          reason: (r["reason"] as string | null) ?? null,
          retryAfterSeconds: Number(r["retry_after_seconds"]),
        };
      } catch {
        return null;
      }
    },
    async search(args, signal) {
      const rows = await run(
        "select * from public.search_bible($1, $2::text[], $3, $4, $5)",
        [args.query, [...args.editions], args.limit, args.offset, args.repair],
        signal,
        options.statementTimeoutMs ?? 5000,
      );
      return rows as unknown as SearchRow[];
    },
  };
}

/** Server-module dependencies with generous limits (tests that need limits override them). */
export function makeDeps(over: {
  env?: Record<string, string | undefined>;
  store: FreeSearchStore;
}) {
  const logs: FreeSearchLog[] = [];
  const env = {
    FREE_SEARCH_ENABLED: "true",
    RATE_LIMIT_SALT: "harness-salt",
    FREE_LIMIT_GUEST_MINUTE: "10000000",
    FREE_LIMIT_GUEST_DAY: "10000000",
    FREE_LIMIT_GLOBAL_MINUTE: "10000000",
    ...over.env,
  };
  const deps: FreeSearchDeps = {
    readConfig: () => readFreeSearchConfig(env),
    env,
    onVercel: false,
    verifyToken: async () => null,
    store: over.store,
    now: () => Date.now(),
    log: (entry) => logs.push(entry),
    editionsCache: { value: null, at: 0 },
  };
  return { deps, logs };
}
