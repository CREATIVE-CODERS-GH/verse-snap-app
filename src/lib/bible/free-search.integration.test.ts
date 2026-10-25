import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findBook, fromApiBookId } from "./books";
import {
  StoreError,
  readFreeSearchConfig,
  runFreeSearch,
  type FreeSearchDeps,
  type FreeSearchLog,
  type FreeSearchStore,
  type SearchRow,
} from "./free-search.server";
import type { FreeSearchRequest } from "./free-search-protocol";

/*
 * Integration test: the REAL server module against a DISPOSABLE local PostgreSQL 17 (never Supabase)
 * loaded with the approved editions (WEB, BSB, ASV) from the import pipeline's output.
 *
 *   DB_TEST_DEPS=<folder with embedded-postgres and pg>  BIBLE_IMPORT_DIR=<prepare-bible-import output>
 *   [BIBLE_SOURCE_DIR=<folder with the complete.json files>]  npx vitest run src/lib/bible/free-search.integration.test.ts
 *
 * The store is a pg adapter that calls the same SQL functions PostgREST would, as service_role, one
 * transaction per call, with bound parameters. Skipped when the folders are not set.
 */

const DEPS = process.env["DB_TEST_DEPS"];
const IMPORT_DIR = process.env["BIBLE_IMPORT_DIR"];
const SOURCE_DIR = process.env["BIBLE_SOURCE_DIR"];
const enabled = Boolean(DEPS && IMPORT_DIR && existsSync(join(IMPORT_DIR, "manifest.json")));

interface PgClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
interface Harness {
  q(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  connect(): Promise<PgClient>;
  stop(): Promise<void>;
  applyMigrations(): Promise<void>;
}

let h: Harness;
const statements: { text: string; values: unknown[] }[] = [];

function pgStore(options: { statementTimeoutMs?: number; role?: string } = {}): FreeSearchStore {
  const run = async (sql: string, values: unknown[], signal: AbortSignal, timeoutMs = 5000) => {
    if (signal.aborted) throw new StoreError("timeout");
    const client = await h.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${options.role ?? "service_role"}`);
      await client.query(`set local statement_timeout = ${timeoutMs}`);
      statements.push({ text: sql, values });
      const result = await client.query(sql, values);
      await client.query("commit");
      return result.rows;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      const code = (error as { code?: string }).code;
      throw new StoreError(code === "57014" ? "timeout" : "unavailable", code);
    } finally {
      await client.end().catch(() => {});
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

function deps(
  over: {
    env?: Record<string, string | undefined>;
    store?: FreeSearchStore;
  } = {},
) {
  const logs: FreeSearchLog[] = [];
  // Generous limits by default so tests do not use each other's allowance; limit tests override them.
  const env = {
    FREE_SEARCH_ENABLED: "true",
    RATE_LIMIT_SALT: "integration-salt",
    FREE_LIMIT_GUEST_MINUTE: "100000",
    FREE_LIMIT_GUEST_DAY: "100000",
    FREE_LIMIT_GLOBAL_MINUTE: "100000",
    ...over.env,
  };
  const d: FreeSearchDeps = {
    readConfig: () => readFreeSearchConfig(env),
    env,
    onVercel: false,
    verifyToken: async () => null,
    store: over.store ?? pgStore(),
    now: () => Date.now(),
    log: (entry) => logs.push(entry),
    editionsCache: { value: null, at: 0 },
  };
  return { d, logs };
}
/** Rate-limit windows are whole minutes: start those tests early in a minute so one never straddles two. */
async function earlyInMinute() {
  const seconds = new Date().getSeconds();
  if (seconds >= 40) await new Promise((resolve) => setTimeout(resolve, (61 - seconds) * 1000));
}
const ctx = (ip = "198.51.100.7") => ({ headers: new Headers(), socketIp: ip });
const search = async (request: FreeSearchRequest, d: FreeSearchDeps, ip?: string) => {
  const result = await runFreeSearch(request, ctx(ip), d);
  if (!result.ok) throw new Error(`search failed: ${result.error}`);
  return result.response;
};
const refs = (r: { results: { translation: string; reference: string }[] }) =>
  r.results.map((x) => `${x.translation} ${x.reference}`);

describe.skipIf(!enabled)("free search against a real database with the approved editions", () => {
  beforeAll(async () => {
    const lib = (await import(pathToFileURL(join(process.cwd(), "scripts/db/lib.mjs")).href)) as {
      startDatabase(o: { port: number; initdbFlags: string[] }): Promise<Harness>;
    };
    h = await lib.startDatabase({
      port: Number(process.env["DB_TEST_PORT"] ?? 54334),
      initdbFlags: ["--encoding=UTF8", "--locale=en-US"],
    });
    await h.q(`create schema extensions;
      grant usage on schema extensions to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
    await h.applyMigrations();
    const manifest = JSON.parse(readFileSync(join(IMPORT_DIR!, "manifest.json"), "utf8")) as {
      editions: Record<string, { files: { name: string }[] }>;
    };
    for (const code of ["WEB", "BSB", "ASV"]) {
      for (const file of manifest.editions[code]!.files) {
        if (/_99_promote\.sql$/.test(file.name)) continue; // promoted below, after the staging checks
        await h.q(readFileSync(join(IMPORT_DIR!, code, file.name), "utf8"));
      }
    }
  }, 600_000);

  afterAll(async () => {
    await h?.stop();
  }, 60_000);

  it("is 'preparing' until an edition is promoted, and spends no quota meanwhile", async () => {
    const { d } = deps();
    const response = await search({ query: "Jesus wept" }, d);
    expect(response).toMatchObject({ status: "preparing", results: [], searchedEditions: [] });
    expect((await h.q("select count(*)::int n from public.free_search_usage"))[0]?.["n"]).toBe(0);
    for (const code of ["WEB", "BSB", "ASV"]) {
      await h.q(readFileSync(join(IMPORT_DIR!, code, `${code}_99_promote.sql`), "utf8"));
    }
    await h.q("analyze public.bible_verses; analyze public.bible_words");
  }, 120_000);

  it("finds a famous phrase in every approved edition, with canonical codes and Reader book ids", async () => {
    const { d } = deps();
    const response = await search({ query: "for God so loved the world" }, d);
    expect(response.status).toBe("ready");
    expect(response.searchedEditions).toEqual(["WEB", "BSB", "ASV"]);
    const top = response.results.slice(0, 3);
    expect(top.map((r) => r.translation).sort()).toEqual(["ASV", "BSB", "WEB"]);
    for (const hit of top) {
      expect(hit).toMatchObject({
        bookId: "john",
        bookName: "John",
        chapter: 3,
        verse: 16,
        reference: "John 3:16",
      });
      expect(hit.text).toMatch(/God so loved the world/i);
    }
  }, 60_000);

  it("keeps editions apart: older wording only in ASV, and an edition filter is honoured", async () => {
    const { d } = deps();
    const kill = await search({ query: "thou shalt not kill" }, d);
    expect(kill.results.length).toBeGreaterThan(0);
    expect(kill.results.every((r) => r.translation === "ASV")).toBe(true);
    const onlyWeb = await search({ query: "thou shalt not kill", editions: ["WEB"] }, d);
    expect(onlyWeb.results.every((r) => r.translation === "WEB")).toBe(true);
    expect(onlyWeb.searchedEditions).toEqual(["WEB"]);
    const begotten = await search({ query: "only begotten Son" }, d);
    expect(
      begotten.results.some((r) => r.translation === "WEB" && r.reference === "John 3:16"),
    ).toBe(false);
    expect(
      begotten.results.some((r) => r.translation === "ASV" && r.reference === "John 3:16"),
    ).toBe(true);
  }, 60_000);

  it("ranks a phrase above looser matches, and reports the exact total", async () => {
    const { d } = deps();
    const response = await search({ query: "Jesus wept" }, d);
    expect(refs(response).slice(0, 3).sort()).toEqual([
      "ASV John 11:35",
      "BSB John 11:35",
      "WEB John 11:35",
    ]);
    expect(response.total).toBeGreaterThanOrEqual(3);
    const independent = Number(
      (
        await h.q(
          "select count(*)::int n from public.bible_verses where tsv @@ plainto_tsquery('english', 'grace')",
        )
      )[0]?.["n"],
    );
    const grace = await search({ query: "grace" }, d);
    expect(grace.total).toBe(independent);
  }, 60_000);

  it("repairs typos and says so", async () => {
    const { d } = deps();
    const response = await search({ query: "sheperd" }, d);
    expect(response.correctedQuery).toBe("shepherd");
    expect(response.results.length).toBeGreaterThan(0);
    const begotten = await search({ query: "begoten Son" }, d);
    expect(begotten.correctedQuery).toBe("begotten Son");
    expect(begotten.results.some((r) => r.reference === "John 3:16")).toBe(true);
    expect((await search({ query: "shepherd" }, d)).correctedQuery).toBeUndefined();
  }, 60_000);

  it("searching the original wording: no repair, no corrected wording, and the corrected search is unchanged", async () => {
    const { d } = deps();
    const original = await search({ query: "sheperd", repair: false }, d);
    expect(original.results).toEqual([]);
    expect(original.correctedQuery).toBeUndefined();
    const repaired = await search({ query: "sheperd" }, d);
    expect(repaired.correctedQuery).toBe("shepherd");
    expect(repaired.results.length).toBeGreaterThan(0);
    // A word that is in the text is never rewritten, with or without the option.
    const plain = await search({ query: "shepherd", repair: false }, d);
    expect(plain.total).toBe((await search({ query: "shepherd" }, d)).total);
  }, 60_000);

  it("pages through every result of a search by the server's own offsets, with a stable total", async () => {
    const { d } = deps();
    const seen: string[] = [];
    let offset: number | undefined = 0;
    let total = -1;
    let pages = 0;
    while (offset !== undefined) {
      const page = await search({ query: "grace", offset, limit: 25 }, d);
      if (total < 0) total = page.total;
      expect(page.total).toBe(total);
      seen.push(...refs(page));
      pages += 1;
      offset = page.hasMore ? page.offset + page.results.length : undefined;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(pages).toBe(Math.ceil(total / 25));
  }, 120_000);

  it("a very common word reports the retrieval limit instead of paging forever", async () => {
    const { d } = deps();
    const first = await search({ query: "God" }, d);
    expect(first.total).toBeGreaterThan(1025);
    expect(first).toMatchObject({ hasMore: true, limitReached: false });
    const last = await search({ query: "God", offset: 1000 }, d);
    expect(last.results).toHaveLength(25);
    expect(last).toMatchObject({ hasMore: false, limitReached: true });
    // The server never asks the database beyond the maximum offset.
    expect(await runFreeSearch({ query: "God", offset: 1001 }, ctx(), d)).toEqual({
      ok: false,
      error: "invalid",
    });
    // And the database itself returns nothing there rather than repeating a page.
    const rows = await d.store.search(
      { query: "God", editions: ["WEB"], limit: 25, offset: 1001, repair: true },
      AbortSignal.timeout(5000),
    );
    expect(rows).toEqual([]);
  }, 60_000);

  it("never claims an unindexed edition was searched", async () => {
    const { d } = deps();
    const response = await search({ query: "shepherd" }, d);
    expect(response.searchedEditions).toEqual(["WEB", "BSB", "ASV"]);
    expect(response.searchedEditions).not.toContain("KJAV");
    const rows = await d.store.search(
      { query: "shepherd", editions: ["KJAV", "BBE", "FBV"], limit: 10, offset: 0, repair: true },
      AbortSignal.timeout(5000),
    );
    expect(rows).toEqual([]);
  }, 60_000);

  it("every result opens a real Reader verse in its own edition", async () => {
    const { d } = deps();
    const sample = [
      ...(await search({ query: "grace" }, d)).results,
      ...(await search({ query: "God", offset: 500 }, d)).results,
      ...(await search({ query: "Jesus wept" }, d)).results,
    ];
    expect(sample.length).toBeGreaterThan(40);
    const bookCache = new Map<string, unknown>();
    const sourceFor = (translation: string) => {
      const id = { WEB: "ENGWEBP", BSB: "BSB", ASV: "eng_asv" }[translation]!;
      if (!bookCache.has(id) && SOURCE_DIR && existsSync(join(SOURCE_DIR, `${id}.complete.json`))) {
        bookCache.set(
          id,
          JSON.parse(readFileSync(join(SOURCE_DIR, `${id}.complete.json`), "utf8")),
        );
      }
      return bookCache.get(id) as
        | {
            books: {
              id: string;
              chapters: {
                chapter: { number: number; content: { type: string; number?: number }[] };
              }[];
            }[];
          }
        | undefined;
    };
    for (const hit of sample) {
      expect(["WEB", "BSB", "ASV"]).toContain(hit.translation);
      expect(findBook(hit.bookId), hit.reference).toBeDefined();
      expect(`/verse/${hit.translation}/${hit.bookId}/${hit.chapter}/${hit.verse}`).toMatch(
        /^\/verse\/(WEB|BSB|ASV)\/[a-z0-9]+\/\d+\/\d+$/,
      );
      const source = sourceFor(hit.translation);
      if (source) {
        const book = source.books.find((b) => fromApiBookId(b.id)?.id === hit.bookId);
        const chapter = book?.chapters.find((c) => c.chapter.number === hit.chapter);
        expect(
          chapter?.chapter.content.some((b) => b.type === "verse" && b.number === hit.verse),
          `${hit.translation} ${hit.reference}`,
        ).toBe(true);
      }
    }
  }, 120_000);

  it("rate limit: refused before the search runs, per person, with a shared ceiling", async () => {
    await earlyInMinute();
    await h.q("delete from public.free_search_usage");
    const searches: string[] = [];
    const store = pgStore();
    const counting: FreeSearchStore = {
      ...store,
      search: async (args, signal) => {
        searches.push("search");
        return store.search(args, signal);
      },
    };
    const { d } = deps({
      env: { FREE_LIMIT_GUEST_MINUTE: "3", FREE_LIMIT_GLOBAL_MINUTE: "1000" },
      store: counting,
    });
    for (let i = 0; i < 3; i += 1) await search({ query: "shepherd" }, d, "192.0.2.1");
    expect(searches).toHaveLength(3);
    const refused = await runFreeSearch({ query: "shepherd" }, ctx("192.0.2.1"), d);
    expect(refused).toMatchObject({ ok: false, error: "limit" });
    expect((refused as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(searches).toHaveLength(3); // the refused request never reached the search
    // Another person is unaffected.
    await search({ query: "shepherd" }, d, "192.0.2.2");
    expect(searches).toHaveLength(4);
    const used = await h.q(
      "select subject, used from public.free_search_usage where window_kind = 'minute' and subject <> 'global' order by used desc",
    );
    expect(used[0]?.["used"]).toBe(3);
    expect(String(used[0]?.["subject"])).toMatch(/^ip:[0-9a-f]{32}$/);
  }, 60_000);

  it("rate limit: the shared per-minute ceiling stops everyone, and 12 simultaneous requests get exactly the allowance", async () => {
    await earlyInMinute();
    await h.q("delete from public.free_search_usage");
    const ceiling = deps({
      env: { FREE_LIMIT_GUEST_MINUTE: "100", FREE_LIMIT_GLOBAL_MINUTE: "2" },
    });
    await search({ query: "shepherd" }, ceiling.d, "192.0.2.10");
    await search({ query: "shepherd" }, ceiling.d, "192.0.2.11");
    expect(await runFreeSearch({ query: "shepherd" }, ctx("192.0.2.12"), ceiling.d)).toMatchObject({
      ok: false,
      error: "limit",
    });
    await h.q("delete from public.free_search_usage");
    const race = deps({ env: { FREE_LIMIT_GUEST_MINUTE: "5", FREE_LIMIT_GLOBAL_MINUTE: "1000" } });
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        runFreeSearch({ query: "shepherd" }, ctx("192.0.2.20"), race.d),
      ),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(5);
    expect(outcomes.filter((o) => !o.ok && o.error === "limit")).toHaveLength(7);
  }, 120_000);

  it("fails closed when the counter cannot be read", async () => {
    await h.q("delete from public.free_search_usage");
    const store = pgStore();
    let searched = false;
    const { d } = deps({
      store: {
        ...store,
        consumeQuota: async () => null,
        search: async (a, s) => {
          searched = true;
          return store.search(a, s);
        },
      },
    });
    expect(await runFreeSearch({ query: "shepherd" }, ctx(), d)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(searched).toBe(false);
  }, 60_000);

  it("SQL access control: the API roles cannot use the search or quota functions or read the tables", async () => {
    for (const role of ["anon", "authenticated"]) {
      const store = pgStore({ role });
      const signal = AbortSignal.timeout(5000);
      await expect(
        store.search(
          { query: "shepherd", editions: ["WEB"], limit: 10, offset: 0, repair: true },
          signal,
        ),
        role,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(store.listActiveEditions(signal), role).rejects.toMatchObject({ code: "42501" });
      expect(
        await store.consumeQuota(
          {
            subject: "ip:0123456789abcdef0123456789abcdef",
            minuteLimit: 1,
            dayLimit: 1,
            globalMinuteLimit: 1,
          },
          signal,
        ),
        role,
      ).toBeNull();
    }
  }, 60_000);

  it("a database timeout becomes a plain 'timeout' answer, and the next search works", async () => {
    await h.q("delete from public.free_search_usage");
    const slow = deps({ store: pgStore({ statementTimeoutMs: 1 }) });
    expect(await runFreeSearch({ query: "God" }, ctx("192.0.2.30"), slow.d)).toEqual({
      ok: false,
      error: "timeout",
    });
    expect(JSON.stringify(slow.logs)).not.toMatch(/God/);
    const normal = deps();
    expect((await search({ query: "God" }, normal.d, "192.0.2.31")).results.length).toBeGreaterThan(
      0,
    );
  }, 60_000);

  it("privacy: the query is a bound parameter only, and is stored nowhere in the database", async () => {
    await h.q("delete from public.free_search_usage");
    statements.length = 0;
    const marker = "zzqmarker unrepeatable wording";
    const { d, logs } = deps();
    await runFreeSearch({ query: marker }, ctx("192.0.2.40"), d);
    await runFreeSearch({ query: marker, offset: 25 }, ctx("192.0.2.40"), d);
    // 1. never part of any SQL text, only of the bound values
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) expect(s.text).not.toContain("zzqmarker");
    expect(statements.some((s) => s.values.includes(marker))).toBe(true);
    // 2. not in any log line
    expect(JSON.stringify(logs)).not.toContain("zzqmarker");
    // 3. not in any table (search the text of every row of every table in public)
    const tables = (await h.q("select tablename from pg_tables where schemaname = 'public'")).map(
      (r) => String(r["tablename"]),
    );
    for (const table of tables) {
      if (table === "bible_verses") continue; // Bible text, not user input
      const hit = await h.q(
        `select count(*)::int n from public."${table}" t where t::text ilike '%zzqmarker%'`,
      );
      expect(hit[0]?.["n"], table).toBe(0);
    }
    // 4. the usage table holds counters only
    const columns = await h.q(
      "select column_name from information_schema.columns where table_name = 'free_search_usage' order by 1",
    );
    expect(columns.map((c) => c["column_name"])).toEqual([
      "subject",
      "used",
      "window_kind",
      "window_start",
    ]);
  }, 60_000);

  it("the function itself writes nothing: a search leaves every table unchanged", async () => {
    const before = await h.q(
      "select (select count(*) from public.bible_verses)::int v, (select count(*) from public.bible_words)::int w, (select count(*) from public.bible_sources)::int s",
    );
    await h.q("select * from public.search_bible('shepherd')");
    const after = await h.q(
      "select (select count(*) from public.bible_verses)::int v, (select count(*) from public.bible_words)::int w, (select count(*) from public.bible_sources)::int s",
    );
    expect(after).toEqual(before);
  }, 60_000);
});
