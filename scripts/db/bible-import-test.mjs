// Loads the REAL Bible text prepared by scripts/bible-import into a THROWAWAY local PostgreSQL 17
// (never Supabase) and tests the search on it: source and licence gates, verse counts, duplicate
// prevention, failed-import recovery, indexing, real phrases and older vocabulary, typos,
// pagination, latency and storage.
//
// The text stays outside the repository: BIBLE_IMPORT_DIR points at the folder written by
//   node scripts/bible-import/prepare-bible-import.mjs --source-dir <dir> --out <dir> --download
// Run:  DB_TEST_DEPS=<folder> BIBLE_IMPORT_DIR=<out folder> node scripts/db/bible-import-test.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { read, startDatabase } from "./lib.mjs";
import { CONFIG, verifyOutputFiles } from "../bible-import/lib.mjs";

const OUT = process.env.BIBLE_IMPORT_DIR;
if (!OUT || !fs.existsSync(path.join(OUT, "manifest.json"))) {
  console.error("Set BIBLE_IMPORT_DIR to the folder written by prepare-bible-import.mjs.");
  process.exit(2);
}
const manifest = JSON.parse(read(path.join(OUT, "manifest.json")));

// UTF-8 like Supabase (ASV contains Hebrew letters and "Cæsar"; the default Windows cluster is WIN1252).
const t = await startDatabase({
  port: Number(process.env.DB_TEST_PORT ?? 54333),
  initdbFlags: ["--encoding=UTF8", `--locale=${process.env.DB_TEST_LOCALE ?? "en-US"}`],
});
const { db, q, check, shutdown, applyMigrations, expectError } = t;
await q(`create schema extensions;
         grant usage on schema extensions to anon, authenticated, service_role;
         -- Supabase grants EXECUTE on new functions to the API roles by default; the migrations must undo it.
         alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
await applyMigrations();
check("all migrations (including the two search migrations) apply", true);

const as = async (role, sql, params) => {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    const result = await db.query(sql, params);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
};
const svc = async (sql, params) => (await as("service_role", sql, params)).rows;
const search = (query, editions = null, limit = 10, offset = 0) =>
  svc(`select * from public.search_bible($1, $2::text[], $3, $4)`, [
    query,
    editions,
    limit,
    offset,
  ]);
const ref = (r) => `${r.edition_code}:${r.book} ${r.chapter}:${r.verse}`;
const ms = (n) => `${n.toFixed(0)} ms`;
const MB = (n) => (n / 1048576).toFixed(1);

/** Runs one SQL file; a failure is rolled back (as a loader using ON_ERROR_STOP would stop). */
const runFile = async (file) => {
  try {
    await db.query(read(file));
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }
};
const dirOf = (code) => path.join(OUT, code);
const step = (code, pattern) =>
  manifest.editions[code].files.map((f) => f.name).filter((n) => pattern.test(n));
const chunks = (code) => step(code, /_\d\d\.sql$/).filter((n) => !/_(00|90|99)_/.test(n));
const run = async (code, name) => runFile(path.join(dirOf(code), name));
const count = async (code) =>
  (await q(`select count(*)::int n from public.bible_verses where edition_code = $1`, [code]))[0].n;
const rowsHash = async (code) =>
  (
    await q(
      `select md5(string_agg(book || ':' || chapter || ':' || verse || ':' || verse_text, '|' order by book_order, chapter, verse)) h from public.bible_verses where edition_code = $1`,
      [code],
    )
  )[0].h;

// ---------- 1. source verification and the pipeline's own safety ----------
const approved = ["WEB", "BSB", "ASV"];
check(
  "manifest covers exactly the three approved editions",
  Object.keys(manifest.editions).sort().join() === "ASV,BSB,WEB",
);
for (const code of approved) {
  const problems = verifyOutputFiles(dirOf(code), manifest.editions[code]);
  check(
    `${code}: generated SQL files match the manifest checksums`,
    problems.length === 0,
    problems.join("; "),
  );
}
{
  const tamper = fs.mkdtempSync(path.join(OUT, "..", "tamper-"));
  fs.copyFileSync(path.join(dirOf("WEB"), "WEB_01.sql"), path.join(tamper, "WEB_01.sql"));
  const damaged = read(path.join(tamper, "WEB_01.sql")).replace(
    "In the beginning",
    "In the beginnin",
  );
  fs.writeFileSync(path.join(tamper, "WEB_01.sql"), damaged);
  const problems = verifyOutputFiles(tamper, {
    files: manifest.editions.WEB.files.filter((f) => f.name === "WEB_01.sql"),
  });
  check(
    "a SQL file edited after generation is detected",
    problems.length === 1 && /checksum|bytes/.test(problems[0]),
    problems.join(";"),
  );
  fs.rmSync(tamper, { recursive: true, force: true });
}
const rows = await q(
  `select edition_code, helloao_id, license_status, source_sha256, source_bytes, expected_verse_count from public.bible_sources`,
);
for (const code of approved) {
  const e = CONFIG.editions[code];
  const r = rows.find((x) => x.edition_code === code);
  check(
    `${code}: source record (id, status, pinned SHA-256, size, verse blocks) equals editions.json and the manifest`,
    r.helloao_id === e.helloaoId &&
      r.license_status === "approved" &&
      r.source_sha256 === e.pinnedSha256 &&
      r.source_sha256 === manifest.editions[code].source.sha256 &&
      r.source_bytes === e.pinnedBytes &&
      r.expected_verse_count === e.expectedVerseBlocks &&
      r.expected_verse_count === manifest.editions[code].verseBlocksInFile,
    JSON.stringify(r),
  );
}
for (const code of ["KJAV", "BBE", "FBV"]) {
  const r = rows.find((x) => x.edition_code === code);
  check(
    `${code}: editions.json and the database both say ${CONFIG.editions[code].licenseStatus}`,
    r.license_status === CONFIG.editions[code].licenseStatus,
  );
}
const credentialPattern =
  /service_role|eyJ[A-Za-z0-9_-]{20,}|sb_secret|postgres(ql)?:\/\/|password\s*=|SUPABASE_[A-Z_]*KEY/i;
const codeFiles = ["editions.json", "lib.mjs", "prepare-bible-import.mjs"].map((f) =>
  path.join("scripts/bible-import", f),
);
check(
  "the pipeline's code embeds no credentials and mentions no privileged role",
  codeFiles.every((f) => !credentialPattern.test(read(f))),
  codeFiles.filter((f) => credentialPattern.test(read(f))).join(),
);
const sqlHeads = approved.flatMap((c) =>
  manifest.editions[c].files.map((f) => read(path.join(dirOf(c), f.name)).slice(0, 400)),
);
check(
  "the generated SQL embeds no credentials",
  sqlHeads.every((h) => !credentialPattern.test(h)),
);
check(
  "it connects to no database itself (no pg client in the CLI or library)",
  !/from "pg"|require\("pg"\)|new Client\(/.test(
    read("scripts/bible-import/prepare-bible-import.mjs") + read("scripts/bible-import/lib.mjs"),
  ),
);

// ---------- 2. licence gates, on real chunk files ----------
const web1 = read(path.join(dirOf("WEB"), "WEB_01.sql"));
for (const code of ["KJAV", "BBE", "FBV", "NIV"]) {
  const r = await expectError(async () => {
    try {
      await db.query(web1.replace(/\('WEB',/g, `('${code}',`));
    } catch (e) {
      await db.query("rollback").catch(() => {});
      throw e;
    }
  }, /foreign key|violates/i);
  check(`a real chunk relabelled ${code} is rejected by the database`, r === true, String(r));
}
check(
  "nothing was written by the rejected chunks",
  (await q(`select count(*)::int n from public.bible_verses`))[0].n === 0,
);
const wrongHash = await expectError(async () => {
  await q(
    `update public.bible_sources set source_sha256 = repeat('0', 64) where edition_code = 'WEB'`,
  );
  try {
    await run("WEB", "WEB_00_check.sql");
  } finally {
    await q(
      `update public.bible_sources set source_sha256 = '${CONFIG.editions.WEB.pinnedSha256}' where edition_code = 'WEB'`,
    );
  }
}, /does not match this file/);
check(
  "the check step refuses a file whose hash is not the one recorded for the edition",
  wrongHash === true,
  String(wrongHash),
);
await q(`update public.bible_sources set license_status = 'pending' where edition_code = 'BSB'`);
check(
  "the check step refuses an edition that is not approved",
  (await expectError(() => run("BSB", "BSB_00_check.sql"), /not approved/)) === true,
);
await q(`update public.bible_sources set license_status = 'approved' where edition_code = 'BSB'`);
for (const code of approved) await run(code, `${code}_00_check.sql`);
check("the check step passes for the three approved editions", true);

// ---------- 3. failed import and safe restart (ASV) ----------
const asvChunks = chunks("ASV");
for (const name of asvChunks.slice(0, 5)) await run("ASV", name);
check("five chunks load (10,000 rows)", (await count("ASV")) === 10000);
{
  const lines = read(path.join(dirOf("ASV"), asvChunks[5])).split("\n");
  const firstRow = lines.findIndex((l) => l.startsWith("("));
  lines.splice(firstRow + 1, 0, lines[firstRow].replace(/,$/, "") + ","); // the same verse twice in one statement
  const failure = await expectError(async () => {
    try {
      await db.query(lines.join("\n"));
    } catch (e) {
      await db.query("rollback").catch(() => {});
      throw e;
    }
  }, /second time|duplicate|cannot affect row/i);
  check("a chunk with a duplicate verse fails", failure === true, String(failure));
}
check("the failed chunk left nothing behind (still 10,000 rows)", (await count("ASV")) === 10000);
check(
  "a partly imported edition is invisible to search (not active)",
  (await search("Jesus wept")).length === 0,
);
check(
  "the verify step fails on the partial import",
  (await expectError(() => run("ASV", "ASV_90_verify.sql"), /expected 31086 verses/)) === true,
);
check(
  "the promote step refuses the partial import",
  (await expectError(() => run("ASV", "ASV_99_promote.sql"), /does not match the manifest/)) ===
    true,
);
for (const name of asvChunks) await run("ASV", name); // restart from the first chunk
check(
  "restarting from chunk 1 completes the import (31,086 rows)",
  (await count("ASV")) === manifest.editions.ASV.rowsToImport &&
    manifest.editions.ASV.rowsToImport === 31086,
);
const hashAfterRecovery = await rowsHash("ASV");
for (const name of asvChunks.slice(0, 3)) await run("ASV", name);
check(
  "re-running chunks is idempotent (no duplicates, same rows)",
  (await count("ASV")) === 31086 && (await rowsHash("ASV")) === hashAfterRecovery,
);
await q(
  `update public.bible_verses set verse_text = 'tampered' where edition_code = 'ASV' and book = 'GEN' and chapter = 1 and verse = 1`,
);
await run("ASV", asvChunks[0]);
check("re-running a chunk repairs a changed verse", (await rowsHash("ASV")) === hashAfterRecovery);
await run("ASV", "ASV_90_verify.sql");
check("the verify step passes after recovery", true);
await q(`delete from public.bible_verses where edition_code = 'ASV'`);
for (const name of asvChunks) await run("ASV", name);
check(
  "a clean import gives byte-identical rows to the recovered one",
  (await rowsHash("ASV")) === hashAfterRecovery,
);

// ---------- 4. import the rest, verify, promote ----------
const storage = [];
const sizes = async () => ({
  heap: Number((await q(`select pg_relation_size('public.bible_verses') s`))[0].s),
  gin: Number((await q(`select pg_relation_size('public.bible_verses_tsv_idx') s`))[0].s),
  pk: Number((await q(`select pg_relation_size('public.bible_verses_pkey') s`))[0].s),
  total: Number((await q(`select pg_total_relation_size('public.bible_verses') s`))[0].s),
  words: Number((await q(`select pg_total_relation_size('public.bible_words') s`))[0].s),
});
storage.push(["ASV", await sizes()]);
const timing = {};
for (const code of ["WEB", "BSB"]) {
  const start = performance.now();
  for (const name of chunks(code)) await run(code, name);
  timing[code] = performance.now() - start;
  await run(code, `${code}_90_verify.sql`);
  storage.push([code, await sizes()]);
}
await run("ASV", "ASV_90_verify.sql");
for (const code of approved) {
  const m = manifest.editions[code];
  const n = await count(code);
  const chapters = (
    await q(
      `select count(distinct (book, chapter))::int n from public.bible_verses where edition_code = $1`,
      [code],
    )
  )[0].n;
  const books = (
    await q(`select count(distinct book)::int n from public.bible_verses where edition_code = $1`, [
      code,
    ])
  )[0].n;
  check(
    `${code}: ${n} verses, ${chapters} chapters, ${books} books (manifest ${m.rowsToImport}/${m.chapters}/66)`,
    n === m.rowsToImport && chapters === m.chapters && books === 66,
  );
}
check(
  "verse counts: WEB 31,098 (31,103 blocks, 5 empty), BSB 31,086, ASV 31,086 (31,102 blocks, 16 empty)",
  (await count("WEB")) === 31098 &&
    (await count("BSB")) === 31086 &&
    (await count("ASV")) === 31086,
);
check(
  "no empty or duplicate rows and native numbering preserved (WEB Romans 14:24-26, BSB/ASV Romans 16:25-27)",
  (await q(`select count(*)::int n from public.bible_verses where btrim(verse_text) = ''`))[0].n ===
    0 &&
    (
      await q(
        `select edition_code, string_agg(chapter || ':' || verse, ',' order by chapter, verse) v from public.bible_verses where book = 'ROM' and ((chapter = 14 and verse >= 24) or (chapter = 16 and verse >= 24)) group by 1 order by 1`,
      )
    )
      .map((r) => `${r.edition_code}=${r.v}`)
      .join(";") === "ASV=16:25,16:26,16:27;BSB=16:25,16:26,16:27;WEB=14:24,14:25,14:26,16:24",
);
check(
  "every row's text is NFC and has no control or zero-width characters",
  (
    await q(
      `select count(*)::int n from public.bible_verses where verse_text <> normalize(verse_text, NFC) or verse_text ~ '[[:cntrl:]]'`,
    )
  )[0].n === 0,
);
check(
  "the apostrophes and quotes of the source are kept as they are (not rewritten)",
  (
    await q(
      `select count(*)::int n from public.bible_verses where edition_code = 'WEB' and verse_text like '%’%'`,
    )
  )[0].n > 5000,
);
check("not searchable until promoted", (await search("Jesus wept")).length === 0);
const vocabStart = performance.now();
const vocab = (await svc(`select public.refresh_bible_words() n`))[0].n;
const vocabMs = performance.now() - vocabStart;
console.log(`\nvocabulary: ${vocab} distinct words, refreshed in ${ms(vocabMs)}`);
for (const code of approved) await run(code, `${code}_99_promote.sql`);
check(
  "promote makes the three editions searchable",
  new Set((await search("Jesus wept")).map((x) => x.edition_code)).size === 3,
);
check(
  "KJAV, BBE and FBV are still not searchable and have no rows",
  (await search("Jesus wept", ["KJAV", "BBE", "FBV"])).length === 0 &&
    (await count("KJAV")) + (await count("BBE")) + (await count("FBV")) === 0,
);
await q(`analyze public.bible_verses; analyze public.bible_words`);

// ---------- 5. real wording ----------
console.log("\nreal-wording searches (first results, edition:book chapter:verse, tier):");
const shown = async (query, editions = null, n = 25) => {
  const r = await search(query, editions, n);
  console.log(
    `  ${JSON.stringify(query).padEnd(42)} total ${String(r[0]?.total_count ?? 0).padStart(4)}${r[0]?.corrected_query ? ` (as "${r[0].corrected_query}")` : ""}  ${r
      .slice(0, 4)
      .map((x) => `${ref(x)} t${x.tier}`)
      .join(", ")}`,
  );
  return r;
};
const has = (rows, e, b, c, v) =>
  rows.some((r) => r.edition_code === e && r.book === b && r.chapter === c && r.verse === v);
let r;
r = await shown("for God so loved the world");
check(
  "phrase 'for God so loved the world': John 3:16 in all three editions, phrase tier",
  ["WEB", "BSB", "ASV"].every((e) => has(r, e, "JHN", 3, 16)) &&
    r.slice(0, 3).every((x) => x.tier === 3),
);
r = await shown("Jesus wept");
check(
  "'Jesus wept': John 11:35 in all three",
  ["WEB", "BSB", "ASV"].every((e) => has(r, e, "JHN", 11, 35)),
);
r = await shown("In the beginning God created");
check(
  "'In the beginning God created': Genesis 1:1 in all three",
  ["WEB", "BSB", "ASV"].every((e) => has(r, e, "GEN", 1, 1)),
);
r = await shown("be still and know that I am God");
check(
  "'be still and know that I am God': Psalm 46:10",
  has(r, "ASV", "PSA", 46, 10) || has(r, "WEB", "PSA", 46, 10),
);
r = await shown("Be anxious for nothing");
check("modern wording: BSB Philippians 4:6", has(r, "BSB", "PHP", 4, 6));
r = await shown("Do not be anxious about anything");
check(
  "a query phrased like another translation still finds relevant verses (some-words fallback, tier 1)",
  r.length > 0 && r.every((x) => x.tier === 1),
);
r = await shown("love is patient");
check(
  "modern wording: 1 Corinthians 13:4 (WEB/BSB)",
  has(r, "WEB", "1CO", 13, 4) || has(r, "BSB", "1CO", 13, 4),
);
r = await shown("love suffereth long");
check("older vocabulary: ASV 1 Corinthians 13:4 ('suffereth long')", has(r, "ASV", "1CO", 13, 4));
r = await shown("thou shalt not kill");
check(
  "older vocabulary: 'thou shalt not kill' only in ASV (Exodus 20:13)",
  has(r, "ASV", "EXO", 20, 13) && r.every((x) => x.edition_code === "ASV"),
);
r = await shown("Abraham begat Isaac");
check("older vocabulary: 'begat' finds ASV Matthew 1:2", has(r, "ASV", "MAT", 1, 2));
r = await shown("whosoever believeth on him");
check("older vocabulary: 'whosoever believeth' finds ASV John 3:16", has(r, "ASV", "JHN", 3, 16));
r = await shown("whoever believes in him");
check("modern wording of the same verse finds WEB John 3:16", has(r, "WEB", "JHN", 3, 16));
r = await shown("peace which passeth all understanding");
check("older vocabulary: 'passeth' finds ASV Philippians 4:7", has(r, "ASV", "PHP", 4, 7));
r = await shown("the LORD is my shepherd");
check("'the LORD is my shepherd': Psalm 23:1 (BSB wording)", has(r, "BSB", "PSA", 23, 1));
r = await shown("only begotten Son");
check(
  "'only begotten Son': ASV/BSB John 3:16, not WEB's 'one and only'",
  has(r, "ASV", "JHN", 3, 16) &&
    !r.some(
      (x) => x.edition_code === "WEB" && x.book === "JHN" && x.chapter === 3 && x.verse === 16,
    ),
);
r = await shown("I can do all things through Christ");
check(
  "'I can do all things through Christ': Philippians 4:13",
  has(r, "WEB", "PHP", 4, 13) || has(r, "ASV", "PHP", 4, 13) || has(r, "BSB", "PHP", 4, 13),
);
const straight = await search("God's Spirit");
const curly = await search("God’s Spirit");
await shown("God’s Spirit");
check(
  "straight and curly apostrophes give the same results",
  JSON.stringify(straight.map(ref)) === JSON.stringify(curly.map(ref)) && straight.length > 0,
);
r = await shown("“Let there be light”");
check(
  "curly quotes in the query: Genesis 1:3",
  ["WEB", "BSB", "ASV"].every((e) => has(r, e, "GEN", 1, 3)),
);
r = await shown("faith, hope, and love");
check(
  "punctuation in the query is ignored: 1 Corinthians 13:13",
  has(r, "WEB", "1CO", 13, 13) || has(r, "BSB", "1CO", 13, 13),
);

// typos
const typoCases = [
  ["sheperd", "shepherd"],
  ["forgivness", "forgiveness"],
  ["righteousnes", "righteousness"],
  ["begoten Son", "begotten Son"],
  ["Jeruselem", "jerusalem"],
  ["Pharoah", "pharaoh"],
  ["rigtheous", "righteous"],
  ["transfiguraton", "transfigured"],
  ["Nebuchadnezer", "nebuchadnezzar"],
  ["resurection", "resurrection"],
  ["salavation", "salvation"],
  ["temtation", "temptation"],
  ["beleive", "believe"],
  ["Isreal", "israel"],
  ["Chirst", "christ"],
  ["covanent", "covenant"],
  ["disiples", "disciples"],
  ["tounge", "tongue"],
  ["Bethlehm", "bethlehem"],
  ["commandements", "commandments"],
];
let repaired = 0;
const wrongRepairs = [];
for (const [typo, fixed] of typoCases) {
  const rows = await search(typo);
  const got = (rows[0]?.corrected_query ?? "").toLowerCase();
  if (got.includes(fixed.toLowerCase()) && rows.length > 0) repaired += 1;
  else wrongRepairs.push(`${typo} -> ${got || "(none)"}`);
}
console.log(
  `  typo repair: ${repaired}/${typoCases.length} correct; wrong or missed: ${wrongRepairs.join(", ") || "-"}`,
);
check(
  "typo repair gets at least 18 of 20 realistic misspellings right",
  repaired >= 18,
  wrongRepairs.join(", "),
);
for (const [typo, fixed, expectedRef] of [
  ["sheperd", "shepherd", ["BSB", "PSA", 23, 1]],
  ["begoten Son", "begotten Son", ["ASV", "JHN", 3, 16]],
]) {
  r = await shown(typo);
  check(
    `typo '${typo}' is repaired to '${fixed}' and finds the verse`,
    (r[0]?.corrected_query ?? "").toLowerCase().includes(fixed.toLowerCase()) &&
      has(r, ...expectedRef),
    JSON.stringify(r[0]?.corrected_query),
  );
}
const modern = [
  "computer",
  "telephone",
  "internet",
  "chocolate",
  "airplane",
  "electricity",
  "bicycle",
  "smartphone",
  "football",
  "coffee",
  "pizza",
  "laptop",
  "hospital",
];
const rewritten = [];
for (const word of modern) {
  const rows = await search(word);
  if (rows[0]?.corrected_query) rewritten.push(`${word} -> ${rows[0].corrected_query}`);
}
console.log(
  `  modern words the repair rewrites anyway (${rewritten.length}/${modern.length}): ${rewritten.join(", ") || "-"}`,
);
const many = (
  await search(Array.from({ length: 12 }, (_, i) => "begoten" + "abcdefghijkl"[i]).join(" "))
).length;
console.log(`  a 12-word all-typo query returns ${many} rows (only 3 words are repaired)`);
r = await search("sheperd", ["ASV"]);
check(
  "typo repair respects the edition filter",
  r.length > 0 && r.every((x) => x.edition_code === "ASV"),
);
check(
  "a correctly spelled word is never rewritten",
  (await search("shepherd"))[0].corrected_query === null,
);

// isolation, tiers
check(
  "edition filter: only ASV",
  (await search("God", ["ASV"], 25)).every((x) => x.edition_code === "ASV"),
);
check(
  "edition filter: two editions",
  new Set((await search("God", ["BSB", "WEB"], 25)).map((x) => x.edition_code)).size === 2,
);
check(
  "ASV-only wording is not found in the other editions",
  (await search("thou shalt not kill", ["WEB", "BSB"])).every(
    (x) => !/thou shalt not kill/i.test(x.verse_text),
  ),
);
const texts = await search("Jesus wept");
check(
  "results carry the verse text of the edition they were found in",
  texts.every((x) => /wept/i.test(x.verse_text)),
);

// ---------- 6. pagination on real data ----------
const walk = async (query, size, editions = null) => {
  const seen = [];
  let total = null;
  for (let offset = 0; offset <= 1000; offset += size) {
    const page = await search(query, editions, size, offset);
    if (!page.length) break;
    total ??= page[0].total_count;
    if (page.some((x) => x.total_count !== total)) throw new Error("total changed between pages");
    seen.push(...page.map(ref));
  }
  return { seen, total };
};
const grace = await walk("grace", 25);
const grace7 = await walk("grace", 7);
const independent = (
  await q(
    `select count(*)::int n from public.bible_verses where tsv @@ plainto_tsquery('english', 'grace')`,
  )
)[0].n;
console.log(
  `\n'grace': ${grace.total} matches (independent count ${independent}); 25-row pages ${grace.seen.length} rows, 7-row pages ${grace7.seen.length}`,
);
check(
  "total_count equals an independent count of matching rows",
  grace.total === independent && independent > 100,
);
check(
  "walking every page yields exactly total_count distinct verses",
  grace.seen.length === grace.total && new Set(grace.seen).size === grace.total,
);
check(
  "page size does not change the sequence",
  JSON.stringify(grace.seen) === JSON.stringify(grace7.seen),
);
const god = await search("God", null, 25, 0);
const godTotal = god[0].total_count;
console.log(
  `'God': ${godTotal} matches; offset 1000 -> ${(await search("God", null, 25, 1000)).length} rows; offset 1001 -> ${(await search("God", null, 25, 1001)).length} rows`,
);
check(
  "a very common word has more matches than the 1,025 rows the API can serve, and says so exactly",
  godTotal > 1025,
);
check(
  "offset 1000 still serves a page; offset 1001 and beyond serve nothing (never a repeat of an earlier page)",
  (await search("God", null, 25, 1000)).length === 25 &&
    (await search("God", null, 25, 1001)).length === 0 &&
    (await search("God", null, 25, 100000)).length === 0,
);
const lastReachable = await search("God", null, 25, 1000);
const firstPage = await search("God", null, 25, 0);
check(
  "the last reachable page does not repeat the first",
  !lastReachable.some((x) => firstPage.map(ref).includes(ref(x))),
);

// ---------- 7. latency on real text ----------
const shapes = [
  ["phrase (7 words)", "for God so loved the world"],
  ["phrase with names", "the LORD said to Moses"],
  ["three words", "faith hope love"],
  ["rare word", "Melchizedek"],
  ["common word 'love'", "love"],
  ["very common word 'God'", "God"],
  ["some-words fallback", "Jesus zzzzzqx"],
  ["typo repaired", "sheperd"],
  ["typo in a phrase", "forgivness of sins"],
  [
    "24 unknown words (worst typo case, 191 chars)",
    Array.from({ length: 24 }, (_, i) => "qxzv" + "abcdefghij"[i % 10] + "kw").join(" "),
  ],
];
const latency = [];
for (const [label, query] of shapes) {
  await search(query);
  const runs = [];
  for (let i = 0; i < 12; i += 1) {
    const s0 = performance.now();
    await search(query);
    runs.push(performance.now() - s0);
  }
  runs.sort((a, b) => a - b);
  latency.push({ label, p50: runs[6], max: runs[11] });
}
const deepRuns = [];
for (let i = 0; i < 8; i += 1) {
  const s0 = performance.now();
  await search("God", null, 25, 1000);
  deepRuns.push(performance.now() - s0);
}
deepRuns.sort((a, b) => a - b);
latency.push({ label: "deepest page (offset 1000) of 'God'", p50: deepRuns[4], max: deepRuns[7] });
const one = [];
for (let i = 0; i < 12; i += 1) {
  const s0 = performance.now();
  await search("God", ["WEB"]);
  one.push(performance.now() - s0);
}
one.sort((a, b) => a - b);
latency.push({ label: "one edition only ('God', WEB)", p50: one[6], max: one[11] });
console.log(
  "\nlatency over 93,270 real verses (median / worst of 12; database round trip, first page of 10):",
);
for (const x of latency)
  console.log(`  ${x.label.padEnd(52)} ${ms(x.p50).padStart(7)} / ${ms(x.max).padStart(7)}`);
check(
  "every query shape answers in under 1 second, worst case",
  latency.every((x) => x.max < 1000),
  JSON.stringify(latency.map((x) => Math.round(x.max))),
);

// ---------- 8. storage ----------
const bloated = await sizes();
// The failure and recovery tests above deleted and re-imported ASV, leaving dead rows; a real
// import is a single clean load, so measure after reclaiming that space.
await q(`vacuum full public.bible_verses`);
await q(`vacuum full public.bible_words`);
const total = await sizes();
console.log(
  `  (before reclaiming the dead rows left by the recovery tests: ${MB(bloated.total + bloated.words)} MB)`,
);
console.log("\nstorage (real text):");
let prev = 0;
for (const [code, s] of storage) {
  console.log(
    `  after ${code}: verses table incl. indexes ${MB(s.total)} MB (+${MB(s.total - prev)})`,
  );
  prev = s.total;
}
console.log(
  `  final: heap ${MB(total.heap)} MB, GIN(tsv) ${MB(total.gin)} MB, primary key ${MB(total.pk)} MB, TOAST+other ${MB(total.total - total.heap - total.gin - total.pk)} MB; vocabulary ${vocab} words ${MB(total.words)} MB; total ${MB(total.total + total.words)} MB`,
);
console.log(
  `  text size: ${MB(Number((await q(`select sum(octet_length(verse_text)) s from public.bible_verses`))[0].s))} MB; import time WEB ${ms(timing.WEB)}, BSB ${ms(timing.BSB)}`,
);
check("three real editions fit in under 100 MB", total.total + total.words < 100 * 1048576);

// ---------- 9. migration atomicity (Supabase-style single-transaction apply) ----------
await shutdownChecks();

async function shutdownChecks() {
  const UP1 = read("supabase/migrations/20261023000000_bible_search_index.sql");
  const DOWN1 = read("supabase/rollbacks/20261023000000_bible_search_index.down.sql");
  const DOWN2 = read("supabase/rollbacks/20261023000100_free_search_rate_limit.down.sql");
  await q(DOWN2);
  await q(DOWN1);
  // A failure half-way through leaves nothing behind: the second table already exists.
  await q(`create table public.bible_words (x int)`);
  const half = await expectError(() => q(UP1), /already exists/);
  check(
    "a migration that fails half-way applies nothing (single implicit transaction)",
    half === true && (await q(`select to_regclass('public.bible_sources') t`))[0].t === null,
    String(half),
  );
  await q(`drop table public.bible_words`);
  // The extension guard: an extension living elsewhere stops the migration before any change.
  await q(`drop extension fuzzystrmatch; create extension fuzzystrmatch with schema public;`);
  const guard = await expectError(() => q(UP1), /outside the "extensions" schema/);
  check(
    "the fuzzystrmatch guard stops the migration cleanly when the extension is in another schema",
    guard === true && (await q(`select to_regclass('public.bible_sources') t`))[0].t === null,
    String(guard),
  );
  await q(`drop extension fuzzystrmatch; create extension fuzzystrmatch with schema extensions;`);
  await q(UP1);
  check(
    "the migration applies after the guard is satisfied",
    (await q(`select count(*)::int n from public.bible_sources`))[0].n === 6,
  );
}

await shutdown();
