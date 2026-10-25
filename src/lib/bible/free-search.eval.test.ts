import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toApiBookId } from "./books";
import { runFreeSearch } from "./free-search.server";
import { FREE_SEARCH_MAX_REACHABLE } from "./free-search-protocol";
import { routeQuery } from "./search-router";
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
 * Reproducible search-quality evaluation on the REAL approved editions (WEB, BSB, ASV) in a disposable
 * local database. The query set and the measurement method are in scripts/eval/search-eval-set.json.
 *
 *   DB_TEST_DEPS=… BIBLE_IMPORT_DIR=… [EVAL_WRITE=1] npx vitest run src/lib/bible/free-search.eval.test.ts
 *
 * With EVAL_WRITE=1 the per-query record is written to docs/audit/search-eval-results.json.
 * Each query also has a recorded `baseline` (pass or fail); the test fails when a query's status
 * changes, so a regression, or an improvement, is noticed and the baseline has to be updated on purpose.
 */

interface VerseExpectation {
  ref: string;
  editions?: string[];
}
interface Expect {
  verses?: VerseExpectation[];
  mode?: "any" | "all";
  topN?: number;
  notVerses?: VerseExpectation[];
  minTotal?: number;
  maxTotal?: number;
  empty?: boolean;
  emptyOrCorrected?: boolean;
  corrected?: string;
  onlyEditions?: string[];
  minEditionsInTop10?: number;
  limitReached?: boolean;
  route?: string;
  notRoute?: string;
}
interface EvalQuery {
  id: string;
  category: string;
  query: string;
  editions?: string[];
  expect: Expect;
  limitation?: string;
  baseline?: "pass" | "fail";
  revised?: string;
}
const set = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/eval/search-eval-set.json"), "utf8"),
) as {
  measurement: string;
  queries: EvalQuery[];
};

interface Hit {
  edition: string;
  ref: string;
}
interface EvalRecord {
  id: string;
  category: string;
  query: string;
  route: string;
  searched: boolean;
  total: number;
  correctedQuery: string | null;
  top10: { edition: string; ref: string; tier: number | null }[];
  editionsInTop10: string[];
  firstExpectedRank: number | null;
  status: "pass" | "fail";
  failures: string[];
  limitation?: string;
  baseline?: string;
}

const records: EvalRecord[] = [];
let h: Harness;
let pool: Pool;

const matches = (hit: Hit, want: VerseExpectation) =>
  hit.ref === want.ref && (!want.editions || want.editions.includes(hit.edition));

describe.skipIf(!harnessEnabled)("search quality evaluation (real WEB, BSB and ASV)", () => {
  beforeAll(async () => {
    h = await startLoadedDatabase(Number(process.env["DB_TEST_PORT"] ?? 54335));
    await h.q(
      "update public.bible_sources set status = 'active' where edition_code in ('WEB','BSB','ASV')",
    );
    pool = await createPool(h, 4);
  }, 600_000);

  afterAll(async () => {
    await pool?.end();
    await h?.stop();
    if (process.env["EVAL_WRITE"] === "1") {
      const ids = new Set(records.map((r) => r.id));
      const ordered = set.queries
        .filter((q) => ids.has(q.id))
        .map((q) => records.find((r) => r.id === q.id)!);
      const withVerses = ordered.filter(
        (r) => set.queries.find((q) => q.id === r.id)?.expect.verses,
      );
      const hit10 = withVerses.filter((r) => !r.failures.some((f) => f.startsWith("verses:")));
      const mrr =
        withVerses.reduce(
          (sum, r) => sum + (r.firstExpectedRank ? 1 / r.firstExpectedRank : 0),
          0,
        ) / Math.max(1, withVerses.length);
      writeFileSync(
        join(process.cwd(), "docs/audit/search-eval-results.json"),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            measurement: set.measurement,
            queries: ordered.length,
            passed: ordered.filter((r) => r.status === "pass").length,
            failed: ordered.filter((r) => r.status === "fail").length,
            queriesWithVerseExpectation: withVerses.length,
            hitAt10: Number((hit10.length / Math.max(1, withVerses.length)).toFixed(3)),
            mrrAt25: Number(mrr.toFixed(3)),
            byCategory: Object.fromEntries(
              [...new Set(ordered.map((r) => r.category))].map((c) => {
                const rs = ordered.filter((r) => r.category === c);
                return [
                  c,
                  { queries: rs.length, passed: rs.filter((r) => r.status === "pass").length },
                ];
              }),
            ),
            results: ordered,
          },
          null,
          1,
        ),
      );
    }
  });

  for (const q of set.queries) {
    it(`${q.id} [${q.category}] ${JSON.stringify(q.query)}`, async () => {
      const failures: string[] = [];
      const decision = routeQuery(q.query);
      const rec: EvalRecord = {
        id: q.id,
        category: q.category,
        query: q.query,
        route: decision.route,
        searched: false,
        total: 0,
        correctedQuery: null,
        top10: [],
        editionsInTop10: [],
        firstExpectedRank: null,
        status: "pass",
        failures,
        ...(q.limitation ? { limitation: q.limitation } : {}),
        ...(q.baseline ? { baseline: q.baseline } : {}),
      };
      const e = q.expect;
      if (e.route && decision.route !== e.route)
        failures.push(`route: expected ${e.route}, got ${decision.route}`);
      if (e.notRoute && decision.route === e.notRoute)
        failures.push(`route: should not be ${e.notRoute}`);

      let hits: Hit[] = [];
      if (decision.route !== "reference" && decision.canSearchFree) {
        rec.searched = true;
        const { deps } = makeDeps({ store: pgStore(h, { pool }) });
        const result = await runFreeSearch(
          {
            query: decision.query,
            limit: 25,
            ...(q.editions ? { editions: q.editions as ("WEB" | "BSB" | "ASV")[] } : {}),
          },
          { headers: new Headers(), socketIp: "203.0.113.5" },
          deps,
        );
        if (!result.ok) {
          failures.push(`search failed: ${result.error}`);
        } else {
          const r = result.response;
          rec.total = r.total;
          rec.correctedQuery = r.correctedQuery ?? null;
          hits = r.results.map((x) => ({
            edition: x.translation,
            ref: `${toApiBookId(x.bookId)} ${x.chapter}:${x.verse}`,
          }));
          // Tier and rank of the leading results, straight from the database function.
          const raw = await h.q(
            "select edition_code, book, chapter, verse, tier from public.search_bible($1, $2::text[], 10, 0, true)",
            [decision.query, q.editions ?? null],
          );
          rec.top10 = hits.slice(0, 10).map((x, i) => ({
            edition: x.edition,
            ref: x.ref,
            tier: raw[i] ? Number(raw[i]["tier"]) : null,
          }));
          rec.editionsInTop10 = [...new Set(hits.slice(0, 10).map((x) => x.edition))];
          if (
            r.limitReached === false &&
            r.total > FREE_SEARCH_MAX_REACHABLE &&
            r.hasMore === false
          )
            failures.push("paging: no next page although more exist");
        }
      }
      const blocked = !rec.searched && decision.route !== "reference";

      if (e.verses) {
        const topN = e.topN ?? 10;
        const found = e.verses.map((w) => hits.slice(0, topN).some((x) => matches(x, w)));
        const ok = e.mode === "all" ? found.every(Boolean) : found.some(Boolean);
        if (!ok)
          failures.push(
            `verses: ${e.mode ?? "any"} of ${e.verses.map((w) => `${w.ref}${w.editions ? `[${w.editions}]` : ""}`).join(", ")} not in the first ${topN}`,
          );
        const idx = hits.slice(0, 25).findIndex((x) => e.verses!.some((w) => matches(x, w)));
        rec.firstExpectedRank = idx >= 0 ? idx + 1 : null;
      }
      for (const w of e.notVerses ?? []) {
        if (hits.slice(0, 25).some((x) => matches(x, w)))
          failures.push(`notVerses: ${w.ref}[${w.editions}] should not appear`);
      }
      if (e.minTotal !== undefined && rec.total < e.minTotal)
        failures.push(`total: ${rec.total} < ${e.minTotal}`);
      if (e.maxTotal !== undefined && rec.total > e.maxTotal)
        failures.push(`total: ${rec.total} > ${e.maxTotal}`);
      if (e.empty && (rec.searched ? hits.length !== 0 : false))
        failures.push(`empty: got ${rec.total} results`);
      if (e.empty && !rec.searched && !blocked) failures.push("empty: no search ran");
      if (e.emptyOrCorrected && hits.length > 0 && !rec.correctedQuery)
        failures.push(
          "emptyOrCorrected: results for a word not in the text, with no correction notice",
        );
      if (
        e.corrected &&
        !(rec.correctedQuery ?? "").toLowerCase().includes(e.corrected.toLowerCase())
      )
        failures.push(
          `corrected: expected "${e.corrected}", got ${JSON.stringify(rec.correctedQuery)}`,
        );
      if (e.onlyEditions) {
        if (hits.length === 0) failures.push("onlyEditions: no results");
        if (hits.some((x) => !e.onlyEditions!.includes(x.edition)))
          failures.push(`onlyEditions: found ${[...new Set(hits.map((x) => x.edition))]}`);
      }
      if (e.minEditionsInTop10 !== undefined && rec.editionsInTop10.length < e.minEditionsInTop10)
        failures.push(
          `editions in top 10: ${rec.editionsInTop10.length} < ${e.minEditionsInTop10}`,
        );
      if (e.limitReached && rec.total <= FREE_SEARCH_MAX_REACHABLE)
        failures.push(
          `limitReached: total ${rec.total} does not exceed ${FREE_SEARCH_MAX_REACHABLE}`,
        );

      rec.status = failures.length === 0 ? "pass" : "fail";
      records.push(rec);
      if (q.baseline) {
        expect(rec.status, `${q.id}: ${failures.join(" | ")}`).toBe(q.baseline);
      }
    }, 60_000);
  }
});
