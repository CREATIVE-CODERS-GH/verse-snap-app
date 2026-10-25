// Tests supabase/migrations/20261023000000_bible_search_index.sql and
// 20261023000100_free_search_rate_limit.sql on a THROWAWAY local PostgreSQL 17 (never Supabase):
// additive-only change, structure and grants, the licence gate (unapproved editions cannot be
// imported), native numbering and duplicates, edition isolation, phrase / keyword / typo matching,
// injection-shaped input, exact paging, server-only access and RLS, the separate rate limit
// (including concurrency), query cancellation, performance and storage on a synthetic Bible-sized
// corpus, verification 08, and both rollbacks.
//
// The corpus is SYNTHETIC (invented words with a Zipf-like frequency). No real Bible text is read,
// written or stored here; the correctness fixtures are a few short public-domain quotations.
// Setup and run: see scripts/db/lib.mjs, then
//   DB_TEST_DEPS=<folder> node scripts/db/bible-search-migration-test.mjs
import { read, startDatabase } from "./lib.mjs";

const UP1 = "supabase/migrations/20261023000000_bible_search_index.sql";
const UP2 = "supabase/migrations/20261023000100_free_search_rate_limit.sql";
const DOWN1 = "supabase/rollbacks/20261023000000_bible_search_index.down.sql";
const DOWN2 = "supabase/rollbacks/20261023000100_free_search_rate_limit.down.sql";
const VERIFY = "supabase/verification/08_bible_search_checks.sql";

const t = await startDatabase({ port: Number(process.env.DB_TEST_PORT ?? 54332) });
const { db, q, connect, check, shutdown, applyMigrations, expectError } = t;

// Supabase keeps extensions in this schema and lets the API roles use it.
await q(`create schema extensions;
         grant usage on schema extensions to anon, authenticated, service_role;
         -- Supabase grants EXECUTE on new functions to the API roles by default; the migrations must undo it.
         alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);

/** Runs one statement as an API role (anon, authenticated, service_role) in its own transaction. */
const as = async (role, sql, params, client = db) => {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    const result = await client.query(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
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
const keys = (rows) => rows.map((r) => `${r.edition_code}-${r.book}-${r.chapter}-${r.verse}`);
const ms = (n) => `${n.toFixed(0)} ms`;

const snapshot = async () =>
  JSON.stringify(
    await q(`
      select 'col' k, c.relname || '.' || attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull v
        from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and attnum > 0 and not attisdropped
      union all select 'con', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace
      union all select 'idx', indexdef from pg_indexes where schemaname = 'public'
      union all select 'pol', tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, '')
        from pg_policies where schemaname = 'public'
      union all select 'grant', table_name || grantee || privilege_type from information_schema.role_table_grants
       where table_schema = 'public'
      union all select 'fn', oid::regprocedure::text from pg_proc where pronamespace = 'public'::regnamespace
      order by 1, 2`),
  );

// ---------- 1. additive migration ----------
await applyMigrations("20261023000000");
check("existing migrations apply", true);
const before = await snapshot();
{
  const pre = (await db.query(read("supabase/verification/08a_bible_search_preflight.sql"))).rows;
  check(
    "pre-flight 08a passes on the database before the migrations",
    pre.at(-1)?.pass === true,
    pre
      .filter((r) => !r.pass)
      .map((r) => r.check_name)
      .join("; "),
  );
}
await q(read(UP1));
await q(read(UP2));
check("both migrations apply", true);
const after = JSON.parse(await snapshot());
const beforeRows = JSON.parse(before);
const removed = beforeRows.filter((r) => !after.some((a) => a.k === r.k && a.v === r.v));
check(
  "nothing that existed was changed or removed (additive only)",
  removed.length === 0,
  JSON.stringify(removed).slice(0, 300),
);
const NEW = ["bible_sources", "bible_verses", "bible_words", "free_search_usage"];
const added = after.filter((a) => !beforeRows.some((r) => r.k === a.k && r.v === a.v));
check(
  "every new object belongs to the four new tables or three new functions",
  added.every(
    (a) =>
      NEW.some((n) => a.v.includes(n)) ||
      /search_bible|refresh_bible_words|consume_free_search_quota/.test(a.v),
  ),
  JSON.stringify(added.filter((a) => !NEW.some((n) => a.v.includes(n))).slice(0, 5)),
);
check(
  "the migration inserts no Bible text",
  (await q(`select count(*)::int n from public.bible_verses`))[0].n === 0,
);

// ---------- 2. verification 08 and structure ----------
const verify = async () => {
  const rows = (await db.query(read(VERIFY))).rows;
  return {
    rows,
    ok: rows.at(-1)?.pass === true,
    failed: rows.filter((r) => !r.pass).map((r) => r.check_name),
  };
};
let v = await verify();
check("verification 08 passes on the new schema", v.ok, v.failed.join("; "));

const sources = await q(
  `select edition_code, license_status, status from public.bible_sources order by 1`,
);
check(
  "six source records: WEB/BSB/ASV approved, KJAV pending, BBE/FBV excluded, all staging",
  JSON.stringify(sources) ===
    JSON.stringify([
      { edition_code: "ASV", license_status: "approved", status: "staging" },
      { edition_code: "BBE", license_status: "excluded", status: "staging" },
      { edition_code: "BSB", license_status: "approved", status: "staging" },
      { edition_code: "FBV", license_status: "excluded", status: "staging" },
      { edition_code: "KJAV", license_status: "pending", status: "staging" },
      { edition_code: "WEB", license_status: "approved", status: "staging" },
    ]),
  JSON.stringify(sources),
);
const sha = await q(
  `select edition_code, source_sha256, source_bytes, publisher_sha256, helloao_id from public.bible_sources order by 1`,
);
check(
  "each source records its edition id and the checksum HelloAO lists (informational)",
  sha.every((r) => /^[0-9a-f]{64}$/.test(r.publisher_sha256) && r.helloao_id),
);
const pinned = {
  WEB: ["afa177afbcf775b294bee9b13059090b548e4d996679cf53214bfaaea9e427fd", 6293463],
  BSB: ["d02b81e78441f5ae5dadec0688ad8596cde6793c28f52ab711d901a855698b6a", 8155925],
  ASV: ["125acd86760f362fe5a8b47791057e546c26dcd0cde628f6017af146752cc69a", 6152058],
};
check(
  "the three approved sources pin the SHA-256 and size of the verified complete.json (2026-10-21)",
  Object.entries(pinned).every(([code, [hash, bytes]]) => {
    const row = sha.find((r) => r.edition_code === code);
    return row?.source_sha256 === hash && row.source_bytes === bytes;
  }),
);
check(
  "KJAV, BBE and FBV have no verified file hash (nothing was downloaded)",
  ["KJAV", "BBE", "FBV"].every(
    (code) => sha.find((r) => r.edition_code === code)?.source_sha256 === null,
  ),
);
check(
  "a source without a verified file hash cannot become active",
  (await expectError(
    () => svc(`update public.bible_sources set status = 'active' where edition_code = 'KJAV'`),
    /check constraint/i,
  )) === true,
);

// ---------- 3. the licence gate ----------
const ins = (edition, book, order, chapter, verse, text) =>
  svc(
    `insert into public.bible_verses (edition_code, book, book_order, chapter, verse, verse_text) values ($1,$2,$3,$4,$5,$6)`,
    [edition, book, order, chapter, verse, text],
  );
for (const [code, why] of [
  ["KJAV", "pending"],
  ["BBE", "excluded"],
  ["FBV", "excluded"],
  ["NIV", "unknown"],
]) {
  check(
    `an import for ${code} (${why}) is rejected`,
    (await expectError(
      () => ins(code, "JHN", 43, 3, 16, "For God so loved the world"),
      /foreign key|violates/i,
    )) === true,
  );
}
check(
  "a verse row cannot claim a different licence status",
  (await expectError(
    () =>
      svc(
        `insert into public.bible_verses (edition_code, license_status, book, book_order, chapter, verse, verse_text) values ('WEB','pending','JHN',43,3,16,'x')`,
      ),
    /check constraint|violates/i,
  )) === true,
);
check(
  "an excluded or pending source can never become active",
  (await expectError(
    () => svc(`update public.bible_sources set status = 'active' where edition_code = 'KJAV'`),
    /check constraint/i,
  )) === true &&
    (await expectError(
      () => svc(`update public.bible_sources set status = 'active' where edition_code = 'BBE'`),
      /check constraint/i,
    )) === true,
);

// Fixture: short public-domain quotations, in each edition's own numbering.
const fixture = [
  ["WEB", "PSA", 19, 23, 1, "Yahweh is my shepherd; I shall lack nothing."],
  ["BSB", "PSA", 19, 23, 1, "The LORD is my shepherd; I shall not want."],
  ["ASV", "PSA", 19, 23, 1, "Jehovah is my shepherd; I shall not want."],
  [
    "WEB",
    "JHN",
    43,
    3,
    16,
    "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.",
  ],
  [
    "BSB",
    "JHN",
    43,
    3,
    16,
    "For God so loved the world that He gave His only begotten Son, that everyone who believes in Him shall not perish but have eternal life.",
  ],
  [
    "ASV",
    "JHN",
    43,
    3,
    16,
    "For God so loved the world, that he gave his only begotten Son, that whosoever believeth on him should not perish, but have eternal life.",
  ],
  [
    "WEB",
    "ROM",
    45,
    12,
    2,
    "Don't be conformed to this world, but be transformed by the renewing of your mind.",
  ],
  [
    "BSB",
    "ROM",
    45,
    12,
    2,
    "Do not conform to the pattern of this world, but be transformed by the renewing of your mind.",
  ],
  [
    "WEB",
    "ROM",
    45,
    14,
    24,
    "Now to him who is able to establish you according to my Good News, the doxology.",
  ],
  ["WEB", "ROM", 45, 14, 26, "to the only wise God, through Jesus Christ, be the glory forever."],
  ["BSB", "ROM", 45, 16, 25, "Now to Him who can establish you according to my gospel."],
  ["ASV", "GEN", 1, 1, 1, "In the beginning God created the heavens and the earth."],
  [
    "WEB",
    "PHP",
    50,
    4,
    7,
    "And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus.",
  ],
  [
    "BSB",
    "PHP",
    50,
    4,
    7,
    "And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.",
  ],
];
for (const row of fixture) await ins(...row);
check(
  "approved editions accept verses",
  (await q(`select count(*)::int n from public.bible_verses`))[0].n === fixture.length,
);
check(
  "each edition keeps its native numbering: WEB Romans 14:24-26 and BSB Romans 16:25 both exist, nothing is remapped",
  (
    await q(
      `select edition_code, chapter, verse from public.bible_verses where book = 'ROM' and (chapter, verse) in ((14,24),(14,26),(16,25)) order by 1,2,3`,
    )
  )
    .map((r) => `${r.edition_code}${r.chapter}:${r.verse}`)
    .join() === "BSB16:25,WEB14:24,WEB14:26",
);
check(
  "the same verse in two editions is allowed; a duplicate within one edition is rejected",
  (await expectError(() => ins("WEB", "JHN", 43, 3, 16, "again"), /duplicate key|unique/i)) ===
    true,
);
for (const [label, args] of [
  ["empty text", ["WEB", "JHN", 43, 3, 17, "   "]],
  ["chapter 0", ["WEB", "JHN", 43, 0, 1, "x"]],
  ["verse 0", ["WEB", "JHN", 43, 3, 0, "x"]],
  ["a slug instead of a USFM book id", ["WEB", "john", 43, 3, 18, "x"]],
  ["book order 67", ["WEB", "JHN", 67, 3, 19, "x"]],
  ["text over 4,000 characters", ["WEB", "JHN", 43, 3, 20, "x".repeat(4001)]],
]) {
  check(
    `rejected: ${label}`,
    (await expectError(() => ins(...args), /check constraint|violates/i)) === true,
  );
}
check(
  "an approved source that has verses cannot be un-approved",
  (await expectError(
    () =>
      svc(`update public.bible_sources set license_status = 'excluded' where edition_code = 'WEB'`),
    /foreign key|violates/i,
  )) === true,
);
check(
  "a source that has verses cannot be deleted, nor its code changed",
  (await expectError(
    () => svc(`delete from public.bible_sources where edition_code = 'WEB'`),
    /foreign key|violates/i,
  )) === true &&
    (await expectError(
      () => svc(`update public.bible_sources set edition_code = 'WEB2' where edition_code = 'WEB'`),
      /foreign key|violates/i,
    )) === true,
);

// ---------- 4. search: nothing is searchable until a source is active ----------
check("staging editions are not searchable", (await search("shepherd")).length === 0);
check(
  "refresh_bible_words builds the vocabulary",
  (await svc(`select public.refresh_bible_words() n`))[0].n > 40 &&
    (await q(`select doc_freq from public.bible_words where word = 'shepherd'`))[0]?.doc_freq === 3,
);
await svc(
  `update public.bible_sources set status = 'active', imported_at = now() where edition_code in ('WEB','BSB','ASV')`,
);
check("a source set to active is searched", (await search("shepherd")).length === 3);

// phrase, keywords, fallback
let r = await search("for God so loved the world");
check(
  "phrase: all three editions' John 3:16 are found, as tier 3, each labelled with its edition",
  r.length === 3 &&
    r.every((x) => x.tier === 3 && x.book === "JHN") &&
    new Set(r.map((x) => x.edition_code)).size === 3,
  JSON.stringify(keys(r)),
);
r = await search("world loved God");
check(
  "all words in any order: tier 2",
  r.length === 3 && r.every((x) => x.tier === 2),
  JSON.stringify(r.map((x) => x.tier)),
);
r = await search("shepherd lack");
check(
  "every word is required while any verse has them all (BSB/ASV 'not want' are excluded)",
  keys(r).join() === "WEB-PSA-23-1",
);
r = await search("shepherd transformed");
check(
  "some-words (tier 1) only when no verse has all of them",
  r.length === 5 && r.every((x) => x.tier === 1) && r[0].total_count === 5,
  JSON.stringify(keys(r)),
);
r = await search("only begotten Son");
check(
  "stemming and case: 'begotten' is found in BSB and ASV, not in WEB's wording",
  keys(r).sort().join() === "ASV-JHN-3-16,BSB-JHN-3-16",
);
check("a stop-word-only query returns nothing", (await search("the and of")).length === 0);

// translation isolation
check(
  "only the requested edition is searched",
  keys(await search("shepherd", ["WEB"])).join() === "WEB-PSA-23-1",
);
check("two requested editions", (await search("shepherd", ["BSB", "ASV"])).length === 2);
check(
  "pending, excluded and unknown editions are ignored, never searched",
  (await search("shepherd", ["KJAV"])).length === 0 &&
    (await search("shepherd", ["BBE", "FBV", "NIV"])).length === 0,
);
check(
  "edition codes are exact (lower case is not an edition)",
  (await search("shepherd", ["web"])).length === 0,
);
check("an empty edition list searches nothing", (await search("shepherd", [])).length === 0);
await svc(`update public.bible_sources set status = 'retired' where edition_code = 'ASV'`);
check("a retired edition stops being searched", (await search("shepherd")).length === 2);
await svc(`update public.bible_sources set status = 'active' where edition_code = 'ASV'`);

// typos
r = await search("sheperd");
check(
  "typo: 'sheperd' is repaired to 'shepherd' and says so",
  r.length === 3 && r[0].corrected_query === "shepherd",
  JSON.stringify(r[0]),
);
r = await search("only begoten son");
check(
  "typo inside a phrase",
  r.length === 2 && r[0].corrected_query === "only begotten son" && r[0].tier === 3,
);
{
  const exactly = (q, repair) =>
    svc(`select * from public.search_bible($1, null, 10, 0, $2)`, [q, repair]);
  check(
    "original wording: with repair off, 'sheperd' is searched as typed (no match) and nothing is reported as corrected",
    (await exactly("sheperd", false)).length === 0,
  );
  check(
    "repair on (and NULL, and the default) still repairs it",
    (await exactly("sheperd", true)).length === 3 &&
      (await exactly("sheperd", null)).length === 3 &&
      (await search("sheperd")).length === 3,
  );
  check(
    "a word the Bible does use is found the same with repair on or off",
    (await exactly("shepherd", false)).length === 3 &&
      (await exactly("shepherd", true)).length === 3,
  );
}
{
  const r2 = await search("shepherd shepherd lord begotten believeth sheperd");
  check(
    "known long words do not use up the repair slots: a typo after four known words is still repaired",
    r2.length > 0 &&
      /sheperd/i.test("sheperd") &&
      String(r2[0].corrected_query).toLowerCase().includes("shepherd shepherd"),
    JSON.stringify(r2[0]?.corrected_query),
  );
}
check("no repair when every word is known", (await search("shepherd"))[0].corrected_query === null);
check("no repair when nothing is close", (await search("zzzxqj")).length === 0);
check("short words are never 'repaired'", (await search("hrt")).length === 0);

// input safety
check(
  "too short and too long queries are refused",
  (await expectError(() => search("a"), /invalid query length/)) === true &&
    (await expectError(() => search("x".repeat(201)), /invalid query length/)) === true,
);
check(
  "control characters and extra spaces are normalised",
  (await search("shepherd\t\n   lack\u0007")).length === 1,
);
for (const evil of [
  `shepherd'); drop table public.bible_verses; --`,
  `shepherd & | ! ( ) : * <-> "unbalanced`,
  `'; select pg_sleep(5); --`,
  `\\ shepherd %% _ `,
]) {
  const start = performance.now();
  const ok = (await expectError(() => search(evil), /never/)) === "no error";
  check(
    `injection-shaped input is only text: ${JSON.stringify(evil).slice(0, 40)}`,
    ok && performance.now() - start < 1000,
  );
}
check(
  "the table survived",
  (await q(`select count(*)::int n from public.bible_verses`))[0].n === fixture.length,
);

// ---------- 5. exact paging ----------
for (const [code] of [["WEB"], ["BSB"], ["ASV"]]) {
  for (let i = 1; i <= 20; i += 1)
    await ins(
      code,
      "EPH",
      49,
      1 + Math.floor((i - 1) / 5),
      1 + ((i - 1) % 5) + 10,
      `grace abounds number ${i}`,
    );
}
await svc(`select public.refresh_bible_words()`);
const all25 = await search("grace", null, 25, 0);
const pagesOf = async (size) => {
  const out = [];
  let total = null;
  for (let offset = 0; offset < 70; offset += size) {
    const page = await search("grace", null, size, offset);
    if (page.length === 0) break;
    total ??= page[0].total_count;
    if (!page.every((x) => x.total_count === total)) throw new Error("total changed between pages");
    out.push(...page);
  }
  return { out, total };
};
const p10 = await pagesOf(10);
const p7 = await pagesOf(7);
check(
  "total_count is the exact number of matches (60) on every page",
  p10.total === 60 && p7.total === 60,
);
check(
  "pages of 10 and pages of 7 list the same 60 verses in the same order",
  JSON.stringify(keys(p10.out)) === JSON.stringify(keys(p7.out)) && p10.out.length === 60,
);
check("no verse repeats or is skipped across pages", new Set(keys(p10.out)).size === 60);
check(
  "one big page equals the start of the paged list",
  JSON.stringify(keys(all25)) === JSON.stringify(keys(p10.out.slice(0, 25))),
);
check(
  "the last page is partial and an offset at or past the end is empty",
  (await search("grace", null, 10, 55)).length === 5 &&
    (await search("grace", null, 10, 60)).length === 0 &&
    (await search("grace", null, 10, 1000)).length === 0,
);
check(
  "limit is clamped to 1-25 and a negative offset to 0",
  (await search("grace", null, 1000, 0)).length === 25 &&
    (await search("grace", null, 0, 0)).length === 1 &&
    (await search("grace", null, 5, -9)).length === 5,
);
check(
  "results are ordered by Bible order and edition within a rank",
  keys(p10.out).slice(0, 3).join() === "ASV-EPH-1-11,BSB-EPH-1-11,WEB-EPH-1-11",
  JSON.stringify(p10.out.slice(0, 6).map((x) => [x.edition_code, x.chapter, x.verse, x.rank])),
);

// ---------- 6. server-only access and RLS ----------
for (const role of ["anon", "authenticated"]) {
  for (const table of NEW) {
    check(
      `${role} cannot read ${table}`,
      (await expectError(
        () => as(role, `select * from public.${table} limit 1`),
        /permission denied/,
      )) === true,
    );
    check(
      `${role} cannot write ${table}`,
      (await expectError(() => as(role, `delete from public.${table}`), /permission denied/)) ===
        true,
    );
  }
  check(
    `${role} cannot call search_bible`,
    (await expectError(
      () => as(role, `select * from public.search_bible('shepherd')`),
      /permission denied/,
    )) === true,
  );
  check(
    `${role} cannot call refresh_bible_words`,
    (await expectError(
      () => as(role, `select public.refresh_bible_words()`),
      /permission denied/,
    )) === true,
  );
  check(
    `${role} cannot call the rate limiter`,
    (await expectError(
      () => as(role, `select * from public.consume_free_search_quota('ip:0123456789abcdef',1,1,1)`),
      /permission denied/,
    )) === true,
  );
}
// RLS as a second wall: even if someone granted SELECT by mistake, RLS (no policies) shows nothing.
await q(
  `grant select on public.bible_verses, public.bible_sources, public.bible_words, public.free_search_usage to authenticated`,
);
const leaked = await as(
  "authenticated",
  `select (select count(*) from public.bible_verses)::int v, (select count(*) from public.bible_sources)::int s, (select count(*) from public.bible_words)::int w`,
);
check(
  "RLS alone hides every row even if SELECT were granted by mistake",
  leaked.rows[0].v === 0 && leaked.rows[0].s === 0 && leaked.rows[0].w === 0,
  JSON.stringify(leaked.rows[0]),
);
await q(
  `revoke select on public.bible_verses, public.bible_sources, public.bible_words, public.free_search_usage from authenticated`,
);
check(
  "the same rows are visible to service_role",
  (await svc(`select count(*)::int n from public.bible_verses`))[0].n === fixture.length + 60,
);
check(
  "search_bible runs as the caller, not as its owner",
  (await q(`select prosecdef from pg_proc where proname = 'search_bible'`))[0].prosecdef === false,
);
v = await verify();
check("verification 08 still passes (and on a database holding verses)", v.ok, v.failed.join("; "));

// ---------- 7. the separate rate limit ----------
const SUB = "ip:0123456789abcdef0123456789abcdef";
const take = (subject, a, b, c) =>
  svc(`select * from public.consume_free_search_quota($1,$2,$3,$4)`, [subject, a, b, c]);
let res = [];
for (let i = 0; i < 4; i += 1) res.push((await take(SUB, 3, 100, 1000))[0]);
check(
  "per-minute limit: 3 allowed, then refused with 'minute' and a retry time",
  res.slice(0, 3).every((x) => x.allowed) &&
    !res[3].allowed &&
    res[3].reason === "minute" &&
    res[3].retry_after_seconds >= 1 &&
    res[3].retry_after_seconds <= 60,
  JSON.stringify(res[3]),
);
const U = `user:${"abcdef01-2345-4678-89ab-cdef01234567"}`;
res = [];
for (let i = 0; i < 3; i += 1) res.push((await take(U, 100, 2, 1000))[0]);
check(
  "per-day limit: refused with 'day' once the day count is used",
  res[2].allowed === false && res[2].reason === "day" && res[2].retry_after_seconds >= 1,
  JSON.stringify(res[2]),
);
const G1 = "ip:1111111111111111",
  G2 = "ip:2222222222222222",
  G3 = "ip:3333333333333333";
await take(G1, 10, 10, 2);
await take(G2, 10, 10, 2);
const g = (await take(G3, 10, 10, 2))[0];
check(
  "global per-minute ceiling protects the database across different people",
  g.allowed === false && g.reason === "global_minute",
  JSON.stringify(g),
);
const rows3 = await q(
  `select used from public.free_search_usage where subject = $1 and window_kind = 'minute'`,
  [G3],
);
check(
  "a refused attempt counts nowhere (no partial counting)",
  rows3.length === 0,
  JSON.stringify(rows3),
);
check(
  "bad subjects and limits are refused",
  (await expectError(() => take("someone@example.com", 1, 1, 1), /invalid subject/)) === true &&
    (await expectError(() => take(SUB, 0, 1, 1), /limits must be positive/)) === true,
);
check(
  "the table holds counters only (no query text or addresses)",
  (
    await q(
      `select string_agg(column_name, ',' order by column_name) c from information_schema.columns where table_name = 'free_search_usage'`,
    )
  )[0].c === "subject,used,window_kind,window_start",
);
check(
  "the AI quota table is untouched by free search",
  (await q(`select count(*)::int n from public.ai_search_usage`))[0].n === 0,
);
await q(`delete from public.free_search_usage`);
const clients = await Promise.all(Array.from({ length: 20 }, () => connect()));
const raced = await Promise.all(
  clients.map((c) =>
    as(
      "service_role",
      `select * from public.consume_free_search_quota('ip:aaaaaaaaaaaaaaaa', 5, 100, 1000)`,
      undefined,
      c,
    ),
  ),
);
await Promise.all(clients.map((c) => c.end()));
const allowedCount = raced.filter((x) => x.rows[0].allowed).length;
check(
  "20 simultaneous requests with a limit of 5: exactly 5 are allowed",
  allowedCount === 5,
  `allowed ${allowedCount}`,
);

// ---------- 8. performance and storage on a synthetic Bible-sized corpus ----------
await svc(`delete from public.bible_verses`);
await svc(`delete from public.bible_words`);
const rng = (() => {
  let s = 123456789;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
})();
const CONS = "bcdfghjklmnprstvwz",
  VOW = "aeiou",
  N = 13000;
const STOP = [
  "the",
  "and",
  "of",
  "to",
  "that",
  "in",
  "he",
  "shall",
  "unto",
  "for",
  "i",
  "his",
  "a",
  "is",
  "with",
];
const vocab = Array.from({ length: N }, (_, i) => {
  if (i < STOP.length) return STOP[i];
  const w =
    CONS[i % 18] +
    VOW[Math.floor(i / 18) % 5] +
    CONS[Math.floor(i / 90) % 18] +
    VOW[Math.floor(i / 1620) % 5] +
    CONS[Math.floor(i / 8100) % 18];
  return w + (i % 7 === 0 ? "ing" : i % 11 === 0 ? "ed" : "");
});
const draw = () => vocab[Math.min(N - 1, Math.floor(Math.exp(rng() * Math.log(N))) - 1)]; // Zipf, s = 1
const PER_EDITION = 31086;
const corpus = [];
const wordsOf = [];
let textBytes = 0;
for (const edition of ["WEB", "BSB", "ASV"]) {
  for (let g = 0; g < PER_EDITION; g += 1) {
    const b = Math.min(65, Math.floor(g / 471)),
      rem = g - Math.floor(g / 471) * 471;
    const words = Array.from({ length: 12 + (g % 12) }, draw);
    const text = words.join(" ") + ".";
    textBytes += text.length;
    corpus.push([
      edition,
      "B" + String(b + 1).padStart(2, "0"),
      b + 1,
      1 + Math.floor(rem / 25),
      1 + (rem % 25),
      text,
    ]);
    wordsOf.push(words);
  }
}
const loadStart = performance.now();
for (let i = 0; i < corpus.length; i += 4000) {
  const part = corpus.slice(i, i + 4000);
  await q(
    `insert into public.bible_verses (edition_code, book, book_order, chapter, verse, verse_text)
     select * from unnest($1::text[], $2::text[], $3::smallint[], $4::smallint[], $5::smallint[], $6::text[])`,
    [0, 1, 2, 3, 4, 5].map((k) => part.map((row) => row[k])),
  );
}
const loadMs = performance.now() - loadStart;
await q(`analyze public.bible_verses`);
const wordsStart = performance.now();
const wordCount = (await svc(`select public.refresh_bible_words() n`))[0].n;
const refreshMs = performance.now() - wordsStart;
await q(`analyze public.bible_words`);
console.log(
  `\nsynthetic corpus: ${corpus.length} verses (3 editions), ${(textBytes / 1e6).toFixed(2)} MB of text, load ${ms(loadMs)}, vocabulary ${wordCount} words refreshed in ${ms(refreshMs)}`,
);

const size = async (rel) =>
  Number((await q(`select pg_total_relation_size($1::regclass) s`, [rel]))[0].s);
const rawSize = async (rel) =>
  Number((await q(`select pg_relation_size($1::regclass) s`, [rel]))[0].s);
const heap = await rawSize("public.bible_verses");
const gin = await rawSize("public.bible_verses_tsv_idx");
const pk = await rawSize("public.bible_verses_pkey");
const toast = (await size("public.bible_verses")) - heap - gin - pk;
const wordsTotal = await size("public.bible_words");
const MB = (n) => (n / 1048576).toFixed(1);
console.log(
  `storage (3 editions, 93,258 rows): heap ${MB(heap)} MB, GIN(tsv) ${MB(gin)} MB, primary key ${MB(pk)} MB, TOAST ${MB(toast)} MB; vocabulary ${MB(wordsTotal)} MB; total ${MB((await size("public.bible_verses")) + wordsTotal)} MB`,
);
check(
  "storage for three synthetic editions stays modest (< 120 MB)",
  (await size("public.bible_verses")) + wordsTotal < 120 * 1048576,
);

// Query shapes
const verseWords = wordsOf[5000];
const nonStop = (w) => !STOP.includes(w);
const phrase = verseWords.filter(nonStop).slice(1, 4).join(" ");
const common = vocab[20],
  common2 = vocab[40],
  rare = vocab[9000];
const mutate = (w) => w.slice(0, 2) + w.slice(3);
const typoSource = vocab.findIndex((w, i) => i >= 500 && w.endsWith("ing"));
const shapes = [
  ["phrase of three words", phrase],
  ["two moderately common words", `${common} ${common2}`],
  ["one common word (large match set)", common],
  ["common word + word that does not exist (some-words fallback)", `${common} qqqqqz`],
  ["typo repaired", `${mutate(vocab[typoSource])} ${common2}`],
  ["rare word", rare],
];
const timings = [];
for (const [label, query] of shapes) {
  await search(query);
  const runs = [];
  let first;
  for (let i = 0; i < 12; i += 1) {
    const s = performance.now();
    const rows = await search(query);
    runs.push(performance.now() - s);
    first ??= rows;
  }
  runs.sort((a, b) => a - b);
  timings.push({
    label,
    p50: runs[6],
    max: runs[11],
    total: first[0]?.total_count ?? 0,
    corrected: first[0]?.corrected_query ?? null,
  });
}
console.log(
  "\nsearch timings over 93,258 verses (first page of 10; median / worst of 12; round trip incl. total count):",
);
for (const x of timings)
  console.log(
    `  ${x.label.padEnd(62)} ${ms(x.p50).padStart(7)} / ${ms(x.max).padStart(7)}   matches: ${x.total}${x.corrected ? `  (repaired to "${x.corrected}")` : ""}`,
  );
check(
  "every query shape answers in under 1 second, worst case",
  timings.every((x) => x.max < 1000),
  JSON.stringify(timings.map((x) => Math.round(x.max))),
);
check(
  "a typo query is repaired on the synthetic corpus",
  timings[4].corrected !== null && timings[4].total > 0,
);
const deepStart = performance.now();
const deep = await search(common, null, 25, 500);
console.log(
  `  deep page (offset 500, 25 rows) of the common word: ${ms(performance.now() - deepStart)}, matches ${deep[0]?.total_count}`,
);
const single = [];
for (let i = 0; i < 12; i += 1) {
  const s = performance.now();
  await search(common, ["WEB"]);
  single.push(performance.now() - s);
}
single.sort((a, b) => a - b);
console.log(
  `  one edition only (WEB), common word: median ${ms(single[6])}, worst ${ms(single[11])}`,
);

const plan = (
  await q(
    `explain select v.edition_code from public.bible_verses v where v.edition_code = any('{WEB,BSB,ASV}') and v.tsv @@ plainto_tsquery('english', $1)`,
    [`${common2} ${rare}`],
  )
)
  .map((x) => x["QUERY PLAN"])
  .join("\n");
check(
  "the full-text index is used for keyword matching",
  /bible_verses_tsv_idx/.test(plan),
  plan.slice(0, 300),
);
// Typo repair scans the vocabulary with a bounded edit distance; measure that lookup on its own.
const lookups = [];
for (let i = 0; i < 12; i += 1) {
  const s0 = performance.now();
  await q(
    `select word from public.bible_words where abs(char_length(word) - 7) <= 2 and extensions.levenshtein_less_equal(word, 'bohabng', 2) <= 2 order by 1 limit 1`,
  );
  lookups.push(performance.now() - s0);
}
lookups.sort((x, y) => x - y);
console.log(
  `  typo lookup against the 13,000-word vocabulary: median ${ms(lookups[6])}, worst ${ms(lookups[11])}`,
);
check("a typo lookup takes well under 100 ms", lookups[11] < 100);

// query cancellation (the server sets a timeout per call; here it is set the same way, per transaction)
const withTimeout = async (millis, sql, params) => {
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    await db.query(`set local statement_timeout = ${millis}`);
    await db.query(sql, params);
    await db.query("commit");
    return "no error";
  } catch (error) {
    await db.query("rollback");
    return /statement timeout/i.test(error.message) ? "cancelled" : error.message;
  }
};
check(
  "a 1 ms timeout cancels a search over the large set",
  (await withTimeout(1, `select * from public.search_bible($1)`, [common])) === "cancelled",
);
check(
  "a 100 ms timeout cancels a call that runs 500 ms",
  (await withTimeout(100, `select count(*) from public.search_bible($1), pg_sleep(0.5)`, [
    common,
  ])) === "cancelled",
);
check(
  "a 5 s timeout lets a normal search finish",
  (await withTimeout(5000, `select * from public.search_bible($1)`, [common])) === "no error",
);
check("the connection is healthy after a cancelled search", (await search(rare)).length >= 0);

// ---------- 9. rollbacks ----------
await q(read(DOWN2));
check(
  "rate-limit rollback removes its table and function only",
  (
    await q(
      `select to_regclass('public.free_search_usage') t, to_regprocedure('public.consume_free_search_quota(text,integer,integer,integer)') f`,
    )
  )[0].t === null && (await q(`select to_regclass('public.bible_verses') t`))[0].t !== null,
);
check(
  "the AI rate limit is untouched by that rollback",
  (await q(`select to_regclass('public.ai_search_usage') t`))[0].t !== null,
);
await q(read(DOWN1));
check(
  "index rollback (with data present) removes every new object",
  (
    await q(
      `select to_regclass('public.bible_sources') a, to_regclass('public.bible_verses') b, to_regclass('public.bible_words') c, to_regprocedure('public.search_bible(text,text[],integer,integer,boolean)') d`,
    )
  )[0].a === null,
);
check(
  "the public schema is exactly as it was before the migrations",
  (await snapshot()) === before,
);
check(
  "fuzzystrmatch is left installed for other features",
  (await q(`select count(*)::int n from pg_extension where extname = 'fuzzystrmatch'`))[0].n === 1,
);
await q(read(DOWN1));
await q(read(DOWN2));
check("rollbacks can be run twice without error", true);
await q(read(UP1));
await q(read(UP2));
check(
  "migrations apply again after a rollback",
  (await q(`select count(*)::int n from public.bible_sources`))[0].n === 6,
);
v = await verify();
check("verification 08 passes after re-applying", v.ok, v.failed.join("; "));

await shutdown();
