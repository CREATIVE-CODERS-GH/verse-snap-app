// Tests supabase/migrations/20261020000000_history_chapter_entries.sql on a THROWAWAY local
// PostgreSQL 17 (never on Supabase): builds the schema from the real migration files with a minimal
// stand-in for Supabase's auth schema and API roles, then checks compatibility with existing rows,
// chapter and verse History writes as the app sends them, two-user RLS isolation, concurrent
// duplicate prevention (separate connections), and the rollback.
//
// One-time setup (installs outside the repo; package.json and node_modules are not touched):
//   npm install --prefix <folder> embedded-postgres@17.10.0-beta.17 pg@8.23.1
// Run:
//   DB_TEST_DEPS=<folder> npm run test:db:history
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const depsDir = process.env.DB_TEST_DEPS;
if (!depsDir) {
  console.error("Set DB_TEST_DEPS to the folder with embedded-postgres and pg (see the header).");
  process.exit(2);
}
const requireDep = createRequire(path.join(path.resolve(depsDir), "package.json"));
const { default: EmbeddedPostgres } = await import(
  "file://" + requireDep.resolve("embedded-postgres").replace(/\\/g, "/")
);
const { Client } = requireDep("pg");

const MIGRATIONS = "supabase/migrations";
const UP = path.join(MIGRATIONS, "20261020000000_history_chapter_entries.sql");
const DOWN = "supabase/rollbacks/20261020000000_history_chapter_entries.down.sql";
const read = (file) => fs.readFileSync(file, "utf8");

// ---------- throwaway server ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "versesnap-pg-"));
const port = Number(process.env.DB_TEST_PORT ?? 54329);
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
const expectError = async (fn, pattern) => {
  try {
    await fn();
    return "no error";
  } catch (error) {
    return pattern.test(error.message) ? true : error.message;
  }
};

async function shutdown(code) {
  try {
    await db.end();
  } catch {
    /* closed */
  }
  await server.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}
process.on("unhandledRejection", async (error) => {
  console.log(`FAIL  test stopped: ${error?.message ?? error}`);
  await shutdown(1);
});

// ---------- Supabase stand-ins (the parts the migrations and RLS use) ----------
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
`);
for (const file of fs.readdirSync(MIGRATIONS).sort()) {
  // Only the migrations that come before this one (later ones are tested separately).
  if (file >= "20261020000000") break;
  await q(read(path.join(MIGRATIONS, file)));
}
check("existing migrations 1–6 apply on PostgreSQL 17", true);

// ---------- schema snapshot (to prove nothing else changes, and that rollback restores it) ----------
const snapshot = async () =>
  JSON.stringify(
    await q(`
      select 'col' k, attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull ||
             coalesce(' ' || pg_get_expr(d.adbin, d.adrelid), '') v
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where attrelid = 'public.history'::regclass and attnum > 0 and not attisdropped
      union all select 'con', conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.history'::regclass
      union all select 'idx', indexdef from pg_indexes where schemaname = 'public' and tablename = 'history'
      union all select 'pol', policyname || cmd || array_to_string(roles, ',') || coalesce(qual, '') || coalesce(with_check, '')
        from pg_policies where tablename = 'history'
      union all select 'rls', relrowsecurity::text from pg_class where oid = 'public.history'::regclass
      union all select 'grant', grantee || ':' || privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'history'
      order by 1, 2`),
  );
const policies = () =>
  q(
    `select policyname, cmd, roles::text, qual, with_check from pg_policies where tablename = 'history' order by 1`,
  );
const original = await snapshot();
const originalPolicies = JSON.stringify(await policies());

// ---------- existing data (written the way the current app writes it) ----------
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
await q(
  `insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', 'a@example.invalid'),
                                                              ($2, 'authenticated', 'authenticated', 'b@example.invalid')`,
  [A, B],
);
await q(
  `insert into public.history (user_id, translation, book_id, book_name, chapter, verse, verse_text, viewed_at) values
  ($1, 'KJAV', 'john', 'John', 3, 16, 'For God so loved', '2026-01-01T10:00:00Z'),
  ($1, 'WEB', 'john', 'John', 3, 16, 'For God so loved', '2026-01-02T10:00:00Z'),
  ($1, 'KJAV', 'romans', 'Romans', 12, 2, 'And be not conformed', '2026-01-03T10:00:00Z'),
  ($2, 'KJAV', 'psalms', 'Psalms', 23, 1, 'The LORD is my shepherd', '2026-01-04T10:00:00Z'),
  ($2, 'BSB', 'genesis', 'Genesis', 1, 1, 'In the beginning', '2026-01-05T10:00:00Z')`,
  [A, B],
);
// Rows without translation/verse_text/viewed_at, as the column defaults fill them.
await q(
  `insert into public.history (user_id, book_id, book_name, chapter, verse) values ($1, 'mark', 'Mark', 1, 1)`,
  [B],
);
const rowsBefore = await q(`select * from public.history order by id`);

// ---------- 1. duplicate guard: stops before changing anything ----------
const dup = await q(
  `insert into public.history (user_id, translation, book_id, book_name, chapter, verse)
   values ($1, 'KJAV', 'john', 'John', 3, 16) returning id`,
  [A],
);
const guard = await expectError(() => q(read(UP)), /Nothing was changed/);
await q("rollback").catch(() => {}); // the failed migration's transaction
check(
  "migration aborts with a clear message when duplicate verse rows exist",
  guard === true,
  String(guard),
);
check("…and leaves the schema exactly as it was", (await snapshot()) === original);
await q(`delete from public.history where id = $1`, [dup[0].id]);

// ---------- 2. apply ----------
await q(read(UP));
check("migration applies", true);
const rowsAfter = await q(`select * from public.history order by id`);
check(
  "every existing row is preserved unchanged and becomes a verse entry",
  rowsAfter.length === rowsBefore.length &&
    rowsAfter.every((row, index) => {
      const { kind, ...rest } = row;
      return kind === "verse" && JSON.stringify(rest) === JSON.stringify(rowsBefore[index]);
    }),
);
check("RLS policy is unchanged", JSON.stringify(await policies()) === originalPolicies);
const keyInfo = await q(`
  select i.indnullsnotdistinct nnd, pg_get_indexdef(i.indexrelid) def
    from pg_constraint c join pg_index i on i.indexrelid = c.conindid
   where c.conname = 'history_entry_key'`);
check(
  "unique entry key is NULLS NOT DISTINCT on (user_id, translation, book_id, chapter, verse)",
  keyInfo[0]?.nnd === true &&
    /\(user_id, translation, book_id, chapter, verse\)/.test(keyInfo[0]?.def),
  JSON.stringify(keyInfo),
);
check(
  "the redundant lookup index is gone; the viewed_at index remains",
  (await q(`select indexname from pg_indexes where tablename = 'history' order by 1`))
    .map((r) => r.indexname)
    .join(",") === "history_entry_key,history_pkey,history_user_viewed_idx",
);

// ---------- requests as the API makes them (role authenticated, JWT subject set) ----------
async function asUser(client, userId, sql, params) {
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
}
// What PostgREST runs for supabase-js upsert(rows, { onConflict, ignoreDuplicates }).
const KEY = "user_id, translation, book_id, chapter, verse";
function upsertSql(columns, ignoreDuplicates) {
  const list = columns.join(", ");
  const updates = columns.map((c) => `${c} = excluded.${c}`).join(", ");
  return `insert into public.history (${list})
          select ${list} from json_populate_recordset(null::public.history, $1)
          on conflict (${KEY}) ${ignoreDuplicates ? "do nothing" : `do update set ${updates}`}`;
}
const CHAPTER_COLUMNS = [
  "user_id",
  "kind",
  "translation",
  "book_id",
  "book_name",
  "chapter",
  "verse",
  "verse_text",
  "viewed_at",
];
const chapterRow = (userId, chapter, viewedAt, translation = "KJAV") => ({
  user_id: userId,
  kind: "chapter",
  translation,
  book_id: "romans",
  book_name: "Romans",
  chapter,
  verse: null,
  verse_text: "",
  viewed_at: viewedAt,
});
const verseRow = (userId, verse, viewedAt) => ({
  user_id: userId,
  kind: "verse",
  translation: "KJAV",
  book_id: "john",
  book_name: "John",
  chapter: 3,
  verse,
  verse_text: "text",
  viewed_at: viewedAt,
});
const upsert = (client, userId, rows, ignore = false) =>
  asUser(client, userId, upsertSql(CHAPTER_COLUMNS, ignore), [JSON.stringify(rows)]);
const count = async (where, params) =>
  Number((await q(`select count(*)::int n from public.history where ${where}`, params))[0].n);

// ---------- 3. existing verse History keeps working (current app write path) ----------
await asUser(
  db,
  A,
  `delete from public.history where user_id = $1 and translation = 'KJAV' and book_id = 'john' and chapter = 3 and verse = 16`,
  [A],
);
await asUser(
  db,
  A,
  `insert into public.history (user_id, translation, book_id, book_name, chapter, verse, verse_text) values ($1, 'KJAV', 'john', 'John', 3, 16, 'For God so loved')`,
  [A],
);
check(
  "current app: verse delete-then-insert still works and the new row is a verse entry",
  (await count(
    `user_id = $1 and book_id = 'john' and verse = 16 and translation = 'KJAV' and kind = 'verse'`,
    [A],
  )) === 1,
);
check(
  "current app: reading history (select *) still returns every row",
  (await asUser(db, A, `select * from public.history order by viewed_at desc limit 100`)).rows
    .length === 3,
);

// ---------- 4. signed-in chapter History ----------
await upsert(db, A, [chapterRow(A, 12, "2026-03-01T10:00:00Z")]);
await upsert(db, A, [chapterRow(A, 12, "2026-03-02T10:00:00Z")]);
const chapterRows = await q(
  `select verse, kind, viewed_at from public.history where user_id = $1 and kind = 'chapter'`,
  [A],
);
check(
  "chapter visit: stored with no verse, and reading it again updates the time without a duplicate",
  chapterRows.length === 1 &&
    chapterRows[0].verse === null &&
    chapterRows[0].viewed_at.toISOString() === "2026-03-02T10:00:00.000Z",
  JSON.stringify(chapterRows),
);
await upsert(db, A, [chapterRow(A, 12, "2026-03-03T10:00:00Z", "WEB")]);
check(
  "chapter visit: another translation is its own entry",
  (await count(`user_id = $1 and kind = 'chapter'`, [A])) === 2,
);
check(
  "chapter and verse entries of the same chapter coexist",
  (await count(`user_id = $1 and book_id = 'romans' and chapter = 12 and translation = 'KJAV'`, [
    A,
  ])) === 2,
);

// ---------- 5. new verse write path: one atomic upsert ----------
await upsert(db, A, [verseRow(A, 16, "2026-03-04T10:00:00Z")]);
const verseRows = await q(
  `select viewed_at from public.history where user_id = $1 and translation = 'KJAV' and book_id = 'john' and verse = 16`,
  [A],
);
check(
  "verse upsert: moves the existing verse to the top without a second row",
  verseRows.length === 1 && verseRows[0].viewed_at.toISOString() === "2026-03-04T10:00:00.000Z",
);

// ---------- 6. the database rejects invalid entries ----------
const badChapter = await expectError(
  () => upsert(db, A, [{ ...chapterRow(A, 5, "2026-03-05T10:00:00Z"), verse: 3 }]),
  /history_kind_verse_check/,
);
const badVerse = await expectError(
  () => upsert(db, A, [{ ...verseRow(A, 1, "2026-03-05T10:00:00Z"), verse: null }]),
  /history_kind_verse_check/,
);
const badKind = await expectError(
  () => upsert(db, A, [{ ...verseRow(A, 2, "2026-03-05T10:00:00Z"), kind: "book" }]),
  /history_kind_verse_check/,
);
const oldChapter = await expectError(
  () =>
    asUser(
      db,
      A,
      `insert into public.history (user_id, book_id, book_name, chapter, verse) values ($1, 'acts', 'Acts', 2, null)`,
      [A],
    ),
  /history_kind_verse_check/,
);
check("rejects a chapter entry with a verse number", badChapter === true, String(badChapter));
check("rejects a verse entry without a verse number", badVerse === true, String(badVerse));
check("rejects an unknown kind", badKind === true, String(badKind));
check(
  "rejects a null verse written without kind (old app can't create chapter rows)",
  oldChapter === true,
  String(oldChapter),
);

// ---------- 7. two-user isolation (RLS) ----------
await upsert(db, B, [chapterRow(B, 12, "2026-03-06T10:00:00Z")]);
check(
  "B's visit to the same chapter is B's own row",
  (await count(`kind = 'chapter' and chapter = 12 and translation = 'KJAV'`)) === 2,
);
const bSees = (await asUser(db, B, `select user_id from public.history`)).rows;
check("B sees only B's history", bSees.length > 0 && bSees.every((row) => row.user_id === B));
const asA = await expectError(
  () => upsert(db, B, [chapterRow(A, 7, "2026-03-07T10:00:00Z")]),
  /row-level security/,
);
check("B cannot write a chapter entry as A (RLS WITH CHECK)", asA === true, String(asA));
const aChapterBefore = JSON.stringify(
  await q(`select * from public.history where user_id = $1 order by id`, [A]),
);
const touched =
  (await asUser(db, B, `update public.history set viewed_at = now() where user_id = $1`, [A]))
    .rowCount +
  (await asUser(db, B, `delete from public.history where user_id = $1`, [A])).rowCount;
check(
  "B cannot update or delete A's rows, and A's rows are unchanged",
  touched === 0 &&
    JSON.stringify(await q(`select * from public.history where user_id = $1 order by id`, [A])) ===
      aChapterBefore,
);
const anon = await expectError(async () => {
  await db.query("begin");
  await db.query("set local role anon");
  try {
    await db.query("select * from public.history");
  } finally {
    await db.query("rollback");
  }
}, /permission denied/);
check("signed-out (anon) requests can't read history", anon === true, String(anon));

// ---------- 8. guest-to-account chapter merge (insert-or-ignore) ----------
const merge = [
  chapterRow(A, 12, "2026-01-15T10:00:00Z"),
  chapterRow(A, 13, "2026-01-16T10:00:00Z"),
  chapterRow(A, 13, "2026-01-16T10:00:00Z"),
];
await upsert(db, A, merge, true);
await upsert(db, A, merge, true); // retry after an interruption
const merged = await q(
  `select chapter, viewed_at from public.history where user_id = $1 and kind = 'chapter' and translation = 'KJAV' order by chapter`,
  [A],
);
check(
  "merge: new chapters added once; the account's existing chapter (and its time) is kept; retry adds nothing",
  merged.length === 2 &&
    merged[0].viewed_at.toISOString() === "2026-03-02T10:00:00.000Z" &&
    merged[1].viewed_at.toISOString() === "2026-01-16T10:00:00.000Z",
  JSON.stringify(merged),
);

// ---------- 9. concurrent duplicate prevention (separate connections) ----------
const clients = await Promise.all(Array.from({ length: 16 }, () => connect()));
const settle = (tasks) => Promise.allSettled(tasks);
let results = await settle(
  clients.map((client, i) =>
    upsert(client, A, [chapterRow(A, 20, `2026-04-01T10:00:${String(i).padStart(2, "0")}Z`)]),
  ),
);
check(
  "16 simultaneous chapter writes: all succeed, exactly one row",
  results.every((r) => r.status === "fulfilled") &&
    (await count(`user_id = $1 and kind = 'chapter' and chapter = 20`, [A])) === 1,
  results
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason.message)
    .join("; "),
);
results = await settle(
  clients.map((client, i) =>
    upsert(client, A, [verseRow(A, 17, `2026-04-02T10:00:${String(i).padStart(2, "0")}Z`)]),
  ),
);
check(
  "16 simultaneous verse writes: all succeed, exactly one row",
  results.every((r) => r.status === "fulfilled") &&
    (await count(`user_id = $1 and book_id = 'john' and verse = 17`, [A])) === 1,
);
results = await settle(
  clients.map((client) => upsert(client, A, [chapterRow(A, 21, "2026-04-03T10:00:00Z")], true)),
);
check(
  "16 simultaneous merges of one chapter: all succeed, exactly one row",
  results.every((r) => r.status === "fulfilled") &&
    (await count(`user_id = $1 and kind = 'chapter' and chapter = 21`, [A])) === 1,
);
// For comparison: the current two-step verse write under the same race.
results = await settle(
  clients.map((client) =>
    asUser(
      client,
      A,
      `
      with gone as (delete from public.history where user_id = '${A}' and translation = 'KJAV' and book_id = 'john' and chapter = 3 and verse = 18)
      select 1`,
    ).then(() =>
      asUser(
        client,
        A,
        `insert into public.history (user_id, translation, book_id, book_name, chapter, verse) values ($1, 'KJAV', 'john', 'John', 3, 18)`,
        [A],
      ),
    ),
  ),
);
const oldPathErrors = results.filter((r) => r.status === "rejected").length;
check(
  `old two-step verse write under the same race: still one row (${oldPathErrors}/16 requests got a duplicate-key error, which the app ignores)`,
  (await count(`user_id = $1 and book_id = 'john' and verse = 18`, [A])) === 1,
);
await Promise.all(clients.map((client) => client.end()));

// ---------- 10. the existing verification scripts pass on the migrated schema ----------
const lastRows = (result) => (Array.isArray(result) ? result[result.length - 1] : result).rows;
const structure = lastRows(await db.query(read("supabase/verification/01_structure_checks.sql")));
const behaviour = lastRows(await db.query(read("supabase/verification/02_behavior_checks.sql")));
const overall = (rows) => rows.find((row) => /^OVERALL/.test(row.check_name ?? row.test));
const failing = (rows) =>
  rows
    .filter((row) => (row.pass ?? row.passed) === false)
    .map((row) => row.check_name ?? `${row.test}: ${row.detail}`);
check(
  "01_structure_checks.sql passes after the migration",
  overall(structure)?.pass === true,
  failing(structure).join("; "),
);
check(
  "02_behavior_checks.sql passes after the migration",
  overall(behaviour)?.passed === true,
  failing(behaviour).join("; "),
);

const historyChecks = lastRows(
  await db.query(read("supabase/verification/05_history_chapter_checks.sql")),
);
check(
  "05_history_chapter_checks.sql passes and leaves nothing behind",
  overall(historyChecks)?.passed === true,
  failing(historyChecks).join("; "),
);

// ---------- 11. rollback ----------
const versesBefore = JSON.stringify(
  await q(
    `select id, user_id, translation, book_id, book_name, chapter, verse, verse_text, viewed_at from public.history where kind = 'verse' order by id`,
  ),
);
await q(read(DOWN));
check(
  "rollback restores the original schema exactly (columns, constraints, indexes, RLS, grants)",
  (await snapshot()) === original,
);
check(
  "rollback keeps every verse entry unchanged and removes only chapter entries",
  JSON.stringify(await q(`select * from public.history order by id`)) === versesBefore,
);
const structureBefore = lastRows(
  await db.query(read("supabase/verification/01_structure_checks.sql")),
);
check(
  "01_structure_checks.sql passes on the rolled-back schema",
  overall(structureBefore)?.pass === true,
  failing(structureBefore).join("; "),
);
await q(read(UP));
check("the migration can be applied again after a rollback", (await count(`kind = 'verse'`)) > 0);

console.log(`\n${passed} passed, ${failed} failed`);
await shutdown(failed ? 1 : 0);
