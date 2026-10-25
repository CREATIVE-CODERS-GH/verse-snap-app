import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFreeSearch } from "./free-search.server";
import {
  createPool,
  harnessEnabled,
  makeDeps,
  pgStore,
  startLoadedDatabase,
  type Harness,
  type Pool,
} from "../../test/pg-search-harness";

/*
 * Local load and latency measurements on the REAL WEB, BSB and ASV text (93,270 verses) in a
 * disposable PostgreSQL 17. Two things are measured separately:
 *   - database only: the SQL function called straight through a connection pool;
 *   - service path:  runFreeSearch (validation, identity, active-editions cache, rate-limit write,
 *                    search, mapping) in-process, same pool. No HTTP, no Supabase/PostgREST hop.
 * Neither includes the network or the hosting platform; see docs/audit/BATCH_1D_D4.md for what that
 * leaves out. Run with BIBLE_PERF=1 (and DB_TEST_DEPS, BIBLE_IMPORT_DIR); writes docs/audit/search-perf-results.json.
 */

const enabled = harnessEnabled && process.env["BIBLE_PERF"] === "1";

const SHAPES: { shape: string; weight: number; query: string }[] = [
  ...[
    "for God so loved the world",
    "the LORD is my shepherd",
    "be still and know that I am God",
    "Jesus wept",
    "faith, hope, and love",
  ].map((query) => ({ shape: "phrase", weight: 4, query })),
  ...[
    "peace understanding hearts",
    "faith works dead",
    "water wine wedding",
    "camel needle eye",
  ].map((query) => ({ shape: "several words", weight: 3, query })),
  ...["grace", "shepherd", "Melchizedek", "Selah", "manna"].map((query) => ({
    shape: "single keyword",
    weight: 3,
    query,
  })),
  ...["God", "love", "the LORD said", "Jesus"].map((query) => ({
    shape: "very common word",
    weight: 2,
    query,
  })),
  ...["sheperd", "forgivness", "righteousnes", "Jeruselem"].map((query) => ({
    shape: "typo",
    weight: 2,
    query,
  })),
  ...["thou shalt not kill", "wherefore", "Abraham begat Isaac"].map((query) => ({
    shape: "archaic",
    weight: 1,
    query,
  })),
  { shape: "no match", weight: 1, query: "zeppelin submarine" },
];

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const r = (n: number) => Number(n.toFixed(1));
  return {
    n: s.length,
    p50: r(pct(s, 50)),
    p95: r(pct(s, 95)),
    p99: r(pct(s, 99)),
    max: r(s.at(-1) ?? 0),
    mean: r(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)),
  };
}
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const mix = (n: number, seed: number) => {
  const rand = rng(seed);
  const bag = SHAPES.flatMap((s) => Array.from({ length: s.weight }, () => s));
  return Array.from({ length: n }, () => bag[Math.floor(rand() * bag.length)]!);
};

/** Resident memory (MB) and cumulative CPU seconds of every postgres process, and this process. */
function postgresUsage() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process postgres -ErrorAction SilentlyContinue | ForEach-Object { '{0},{1}' -f $_.WorkingSet64, $_.TotalProcessorTime.TotalSeconds }"`,
      { encoding: "utf8" },
    );
    const rows = out
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split(",").map(Number));
    return {
      processes: rows.length,
      memoryMB: Number((rows.reduce((a, r) => a + (r[0] ?? 0), 0) / 1048576).toFixed(0)),
      cpuSeconds: Number(rows.reduce((a, r) => a + (r[1] ?? 0), 0).toFixed(2)),
    };
  } catch {
    return { processes: 0, memoryMB: 0, cpuSeconds: 0 };
  }
}

const results: Record<string, unknown> = {};
let h: Harness;
let pool: Pool;

async function timed<T>(fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

/** Runs `work` for every item with at most `concurrency` in flight; returns per-item ms and wall time. */
async function runLevel<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  const latencies: number[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        const { ms } = await timed(() => work(item));
        latencies.push(ms);
      }
    }),
  );
  const wall = (performance.now() - started) / 1000;
  return {
    ...stats(latencies),
    wallSeconds: Number(wall.toFixed(2)),
    requestsPerSecond: Number((items.length / wall).toFixed(1)),
  };
}

describe.skipIf(!enabled)("search performance on the real editions", () => {
  beforeAll(async () => {
    h = await startLoadedDatabase(Number(process.env["DB_TEST_PORT"] ?? 54336));
    await h.q(
      "update public.bible_sources set status = 'active' where edition_code in ('WEB','BSB','ASV')",
    );
    pool = await createPool(h, 16);
    results["machine"] = {
      platform: process.platform,
      node: process.version,
      cpus: Number(
        execSync(
          `powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors"`,
          { encoding: "utf8" },
        ).trim(),
      ),
      note: "Single local machine; PostgreSQL 17.10 embedded with default settings (shared_buffers 128MB).",
    };
  }, 600_000);

  afterAll(async () => {
    await pool?.end();
    await h?.stop();
    writeFileSync(
      join(process.cwd(), "docs/audit/search-perf-results.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...results }, null, 1),
    );
  });

  it("database only, one request at a time, by query shape", async () => {
    const store = pgStore(h, { pool });
    const signal = AbortSignal.timeout(60_000);
    const byShape: Record<string, number[]> = {};
    for (const s of SHAPES) {
      for (let i = 0; i < 3; i += 1)
        await store.search(
          { query: s.query, editions: ["WEB", "BSB", "ASV"], limit: 25, offset: 0, repair: true },
          signal,
        ); // warm
    }
    for (const s of SHAPES) {
      for (let i = 0; i < 20; i += 1) {
        const { ms } = await timed(() =>
          store.search(
            { query: s.query, editions: ["WEB", "BSB", "ASV"], limit: 25, offset: 0, repair: true },
            signal,
          ),
        );
        (byShape[s.shape] ??= []).push(ms);
      }
    }
    results["databaseOnly_sequential_byShape_ms"] = Object.fromEntries(
      Object.entries(byShape).map(([k, v]) => [k, stats(v)]),
    );
    const slowest = Math.max(...Object.values(byShape).flat());
    expect(slowest).toBeLessThan(2000);
  }, 300_000);

  it("pagination: deeper pages of a common word, and every page of a mid-size result", async () => {
    const store = pgStore(h, { pool });
    const signal = AbortSignal.timeout(60_000);
    const deep: Record<string, ReturnType<typeof stats>> = {};
    for (const offset of [0, 25, 250, 500, 750, 1000]) {
      const runs: number[] = [];
      for (let i = 0; i < 10; i += 1)
        runs.push(
          (
            await timed(() =>
              store.search(
                { query: "God", editions: ["WEB", "BSB", "ASV"], limit: 25, offset, repair: true },
                signal,
              ),
            )
          ).ms,
        );
      deep[`God offset ${offset}`] = stats(runs);
    }
    const walk: number[] = [];
    for (let offset = 0; offset < 400; offset += 25)
      walk.push(
        (
          await timed(() =>
            store.search(
              { query: "grace", editions: ["WEB", "BSB", "ASV"], limit: 25, offset, repair: true },
              signal,
            ),
          )
        ).ms,
      );
    results["pagination_ms"] = { ...deep, "grace, every page (16 pages)": stats(walk) };
    expect(stats(walk).max).toBeLessThan(1000);
  }, 300_000);

  it("database only under concurrency (mixed shapes)", async () => {
    const store = pgStore(h, { pool });
    const levels: Record<string, unknown> = {};
    for (const c of [1, 4, 8, 16]) {
      const before = postgresUsage();
      const items = mix(400, 100 + c);
      const r = await runLevel(items, c, async (s) => {
        await store.search(
          { query: s.query, editions: ["WEB", "BSB", "ASV"], limit: 25, offset: 0, repair: true },
          AbortSignal.timeout(60_000),
        );
      });
      const after = postgresUsage();
      levels[`concurrency ${c}`] = {
        ...r,
        postgresCpuSeconds: Number((after.cpuSeconds - before.cpuSeconds).toFixed(2)),
        postgresMemoryMB: after.memoryMB,
      };
    }
    results["databaseOnly_concurrent_ms"] = levels;
    expect((levels["concurrency 16"] as { p95: number }).p95).toBeLessThan(5000);
  }, 600_000);

  it("service path (validation, identity, rate-limit write, search, mapping) under concurrency", async () => {
    const levels: Record<string, unknown> = {};
    for (const c of [1, 4, 8, 16]) {
      await h.q("delete from public.free_search_usage");
      const { deps } = makeDeps({ store: pgStore(h, { pool }) });
      const items = mix(400, 200 + c).map((s, i) => ({ s, ip: `198.51.100.${(i % 200) + 1}` }));
      const before = postgresUsage();
      const failures: string[] = [];
      const r = await runLevel(items, c, async ({ s, ip }) => {
        const out = await runFreeSearch(
          { query: s.query, limit: 25 },
          { headers: new Headers(), socketIp: ip },
          deps,
        );
        if (!out.ok) failures.push(out.error);
      });
      const after = postgresUsage();
      levels[`concurrency ${c}`] = {
        ...r,
        failures: failures.length,
        postgresCpuSeconds: Number((after.cpuSeconds - before.cpuSeconds).toFixed(2)),
        postgresMemoryMB: after.memoryMB,
        nodeRssMB: Number((process.memoryUsage().rss / 1048576).toFixed(0)),
      };
      expect(failures).toEqual([]);
    }
    results["servicePath_concurrent_ms"] = levels;
  }, 600_000);

  it("the rate-limit write alone (one shared row is updated by every request)", async () => {
    const store = pgStore(h, { pool });
    const out: Record<string, unknown> = {};
    for (const c of [1, 8, 16]) {
      await h.q("delete from public.free_search_usage");
      const items = Array.from(
        { length: 300 },
        (_, i) => `ip:${(i % 200).toString(16).padStart(32, "0")}`,
      );
      out[`concurrency ${c}`] = await runLevel(items, c, async (subject) => {
        await store.consumeQuota(
          { subject, minuteLimit: 100000, dayLimit: 100000, globalMinuteLimit: 100000 },
          AbortSignal.timeout(30_000),
        );
      });
    }
    results["quotaWriteOnly_ms"] = out;
  }, 300_000);

  it("abusive shapes stay cheap: 200-character queries, 24 unknown words, offset 1000, 25 editions entries", async () => {
    const store = pgStore(h, { pool });
    const signal = AbortSignal.timeout(60_000);
    const abusive = {
      "200 characters of real words": "the lord said unto moses ".repeat(8).slice(0, 200).trim(),
      "24 unknown words (typo repair worst case)": Array.from(
        { length: 24 },
        (_, i) => `qxzv${"abcdefghij"[i % 10]}kw`,
      ).join(" "),
      "8 repairable typos":
        "sheperd forgivness righteousnes resurection salavation temtation beleive Isreal",
      "common word, deepest page": "God",
    };
    const out: Record<string, unknown> = {};
    for (const [name, query] of Object.entries(abusive)) {
      const runs: number[] = [];
      for (let i = 0; i < 10; i += 1)
        runs.push(
          (
            await timed(() =>
              store.search(
                {
                  query,
                  editions: ["WEB", "BSB", "ASV"],
                  limit: 25,
                  offset: name.includes("deepest") ? 1000 : 0,
                  repair: true,
                },
                signal,
              ),
            )
          ).ms,
        );
      out[name] = stats(runs);
    }
    results["abusiveShapes_ms"] = out;
    expect(Math.max(...Object.values(out).map((v) => (v as { max: number }).max))).toBeLessThan(
      2000,
    );
  }, 300_000);
});
