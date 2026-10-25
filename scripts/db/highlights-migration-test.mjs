// Tests supabase/migrations/20261021000000_verse_highlights.sql on a THROWAWAY local
// PostgreSQL 17 (never on Supabase): structure and grants, set / change / remove, one highlight per
// verse, translation isolation, value checks, two-user RLS isolation, concurrent writes from
// separate connections, the merge's insert-or-ignore, account deletion, verification 06, rollback.
// Setup and run: see scripts/db/lib.mjs, then  DB_TEST_DEPS=<folder> npm run test:db:highlights
import { read, startDatabase } from "./lib.mjs";

const UP = "supabase/migrations/20261021000000_verse_highlights.sql";
const DOWN = "supabase/rollbacks/20261021000000_verse_highlights.down.sql";
const t = await startDatabase();
const { db, q, connect, check, shutdown, applyMigrations, asUser, expectError, lastRows } = t;

await applyMigrations("20261021000000");
check("existing migrations (through History chapter entries) apply", true);

// Everything else in public, to prove the migration changes nothing but its own table.
const otherSchema = async () =>
  JSON.stringify(
    await q(`
      select 'col' k, c.relname || '.' || attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull v
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'highlights' and attnum > 0 and not attisdropped
      union all select 'con', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> coalesce(to_regclass('public.highlights'), 0)
      union all select 'idx', indexdef from pg_indexes where schemaname = 'public' and tablename <> 'highlights'
      union all select 'pol', tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, '')
        from pg_policies where schemaname = 'public' and tablename <> 'highlights'
      union all select 'grant', table_name || grantee || privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name <> 'highlights'
      order by 1, 2`),
  );
const before = await otherSchema();

await q(read(UP));
check("migration applies", true);
check(
  "no other table, constraint, index, policy or grant changed",
  (await otherSchema()) === before,
);

// ---------- structure ----------
const policy = await q(
  `select cmd, roles::text, qual, with_check from pg_policies where tablename = 'highlights'`,
);
check(
  "RLS on, one own-row policy for authenticated",
  (await q(`select relrowsecurity r from pg_class where oid = 'public.highlights'::regclass`))[0]
    .r === true &&
    policy.length === 1 &&
    policy[0].cmd === "ALL" &&
    policy[0].roles === "{authenticated}" &&
    /auth\.uid\(\).*user_id/.test(policy[0].qual) &&
    /auth\.uid\(\).*user_id/.test(policy[0].with_check),
  JSON.stringify(policy),
);
const grants = await q(`
  select grantee, string_agg(privilege_type, ',' order by privilege_type) p
    from information_schema.role_table_grants where table_name = 'highlights' group by grantee order by 1`);
const grantOf = (role) => grants.find((g) => g.grantee === role)?.p;
check(
  "Supabase's default grants are replaced: signed-in gets only SELECT/INSERT/UPDATE/DELETE, signed-out nothing",
  grantOf("authenticated") === "DELETE,INSERT,SELECT,UPDATE" && grantOf("anon") === undefined,
  JSON.stringify(grants),
);

// ---------- the requests the app makes (PostgREST SQL) ----------
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
await q(
  `insert into auth.users (id, email) values ($1, 'a@example.invalid'), ($2, 'b@example.invalid')`,
  [A, B],
);
const COLUMNS = ["user_id", "translation", "book_id", "chapter", "verse", "color", "updated_at"];
const MERGE_COLUMNS = [
  "user_id",
  "translation",
  "book_id",
  "chapter",
  "verse",
  "color",
  "created_at",
  "updated_at",
];
const KEY = "user_id, translation, book_id, chapter, verse";
function upsertSql(columns, ignore) {
  const list = columns.join(", ");
  const updates = columns.map((c) => `${c} = excluded.${c}`).join(", ");
  return `insert into public.highlights (${list})
          select ${list} from json_populate_recordset(null::public.highlights, $1)
          on conflict (${KEY}) ${ignore ? "do nothing" : `do update set ${updates}`}`;
}
const row = (user, verse, color, translation = "KJAV", at = "2026-05-01T10:00:00Z") => ({
  user_id: user,
  translation,
  book_id: "john",
  chapter: 3,
  verse,
  color,
  created_at: at,
  updated_at: at,
});
const set = (client, user, rows) =>
  asUser(client, user, upsertSql(COLUMNS, false), [JSON.stringify(rows)]);
const merge = (client, user, rows) =>
  asUser(client, user, upsertSql(MERGE_COLUMNS, true), [JSON.stringify(rows)]);
const remove = (client, user, translation, verse) =>
  asUser(
    client,
    user,
    `delete from public.highlights where user_id = $1 and translation = $2 and book_id = 'john' and chapter = 3 and verse = $3`,
    [user, translation, verse],
  );
const readChapter = async (client, user, translation) =>
  (
    await asUser(
      client,
      user,
      `select verse, color from public.highlights where translation = $1 and book_id = 'john' and chapter = 3 order by verse`,
      [translation],
    )
  ).rows;

await set(db, A, [row(A, 16, "amber")]);
await set(db, A, [row(A, 16, "sage", "KJAV", "2026-05-02T10:00:00Z")]);
let rows = await readChapter(db, A, "KJAV");
check(
  "changing a highlight's colour updates the one row",
  rows.length === 1 && rows[0].color === "sage",
  JSON.stringify(rows),
);
await remove(db, A, "KJAV", 16);
check("removing a highlight deletes it", (await readChapter(db, A, "KJAV")).length === 0);

await set(db, A, [row(A, 16, "rose", "KJAV"), row(A, 17, "sky", "KJAV")]);
await set(db, A, [row(A, 16, "lilac", "WEB")]);
check(
  "highlights belong to their translation",
  JSON.stringify(await readChapter(db, A, "KJAV")) ===
    JSON.stringify([
      { verse: 16, color: "rose" },
      { verse: 17, color: "sky" },
    ]) &&
    JSON.stringify(await readChapter(db, A, "WEB")) ===
      JSON.stringify([{ verse: 16, color: "lilac" }]),
);
const plainDuplicate = await expectError(
  () =>
    asUser(
      db,
      A,
      `insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values ($1, 'KJAV', 'john', 3, 16, 'amber')`,
      [A],
    ),
  /highlights_verse_key/,
);
check(
  "a second highlight for the same verse is rejected",
  plainDuplicate === true,
  String(plainDuplicate),
);
for (const [label, bad, pattern] of [
  ["the 'clear' tone isn't stored", { color: "clear" }, /check/],
  ["an unknown colour is rejected", { color: "neon" }, /check/],
  ["verse 0 is rejected", { verse: 0 }, /check/],
  ["a missing colour is rejected", { color: null }, /null value/],
]) {
  const result = await expectError(() => set(db, A, [{ ...row(A, 30, "amber"), ...bad }]), pattern);
  check(label, result === true, String(result));
}

// ---------- two-user isolation ----------
await set(db, B, [row(B, 16, "amber")]);
check(
  "B's highlight of the same verse is B's own row",
  (await readChapter(db, B, "KJAV")).length === 1,
);
const bSees = (await asUser(db, B, `select user_id from public.highlights`)).rows;
check("B sees only B's highlights", bSees.length === 1 && bSees.every((r) => r.user_id === B));
const aBefore = JSON.stringify(
  await q(`select * from public.highlights where user_id = $1 order by id`, [A]),
);
const touched =
  (await asUser(db, B, `update public.highlights set color = 'amber' where user_id = $1`, [A]))
    .rowCount +
  (await asUser(db, B, `delete from public.highlights where user_id = $1`, [A])).rowCount;
check(
  "B cannot change or delete A's highlights",
  touched === 0 &&
    JSON.stringify(
      await q(`select * from public.highlights where user_id = $1 order by id`, [A]),
    ) === aBefore,
);
const asA = await expectError(() => set(db, B, [row(A, 40, "amber")]), /row-level security/);
check("B cannot write a highlight as A (RLS WITH CHECK)", asA === true, String(asA));
const anon = await expectError(async () => {
  await db.query("begin");
  await db.query("set local role anon");
  try {
    await db.query("select * from public.highlights");
  } finally {
    await db.query("rollback");
  }
}, /permission denied/);
check("signed-out (anon) requests can't read highlights", anon === true, String(anon));
const truncate = await expectError(
  () => asUser(db, A, `truncate public.highlights`),
  /permission denied/,
);
check("signed-in requests can't TRUNCATE the table", truncate === true, String(truncate));

// ---------- guest-to-account merge: insert-or-ignore ----------
const mergeRows = [row(A, 16, "amber"), row(A, 18, "amber"), row(A, 18, "amber")];
await merge(db, A, mergeRows);
await merge(db, A, mergeRows); // retry
rows = await readChapter(db, A, "KJAV");
check(
  "merge keeps the account's colour, adds new verses once, and a retry adds nothing",
  JSON.stringify(rows) ===
    JSON.stringify([
      { verse: 16, color: "rose" },
      { verse: 17, color: "sky" },
      { verse: 18, color: "amber" },
    ]),
  JSON.stringify(rows),
);

// ---------- concurrency (separate connections) ----------
const clients = await Promise.all(Array.from({ length: 16 }, () => connect()));
const colors = ["amber", "sage", "sky", "rose", "lilac"];
let results = await Promise.allSettled(
  clients.map((client, i) => set(client, A, [row(A, 50, colors[i % 5])])),
);
const v50 = await q(`select color from public.highlights where user_id = $1 and verse = 50`, [A]);
check(
  "16 simultaneous colour changes on one verse: all succeed, exactly one row",
  results.every((r) => r.status === "fulfilled") &&
    v50.length === 1 &&
    colors.includes(v50[0].color),
  results
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason.message)
    .join("; "),
);
results = await Promise.allSettled(clients.map((client) => merge(client, A, [row(A, 51, "sky")])));
check(
  "16 simultaneous merges of one highlight: all succeed, exactly one row",
  results.every((r) => r.status === "fulfilled") &&
    (
      await q(`select count(*)::int n from public.highlights where user_id = $1 and verse = 51`, [
        A,
      ])
    )[0].n === 1,
);
await Promise.all(clients.map((client) => client.end()));

// ---------- account deletion ----------
await q(`delete from auth.users where id = $1`, [B]);
check(
  "deleting an account deletes its highlights",
  (await q(`select count(*)::int n from public.highlights where user_id = $1`, [B]))[0].n === 0,
);

// ---------- verification script 06 ----------
const checks06 = lastRows(await db.query(read("supabase/verification/06_highlights_checks.sql")));
const overall = checks06.find((r) => /^OVERALL/.test(r.test));
check(
  "06_highlights_checks.sql passes and leaves nothing behind",
  overall?.passed === true,
  checks06
    .filter((r) => !r.passed)
    .map((r) => `${r.test}: ${r.detail}`)
    .join("; "),
);

const structure = async () => {
  const rows = lastRows(await db.query(read("supabase/verification/01_structure_checks.sql")));
  return {
    ok: rows.find((r) => /^OVERALL/.test(r.check_name))?.pass === true,
    failing: rows
      .filter((r) => !r.pass)
      .map((r) => r.check_name)
      .join("; "),
  };
};
let s01 = await structure();
check("01_structure_checks.sql passes with the highlights table", s01.ok, s01.failing);

// ---------- rollback ----------
await q(read(DOWN));
check(
  "rollback removes the table and leaves everything else exactly as before",
  (await q(`select to_regclass('public.highlights') r`))[0].r === null &&
    (await otherSchema()) === before,
);
s01 = await structure();
check("01_structure_checks.sql passes after the rollback", s01.ok, s01.failing);
await q(read(UP));
check(
  "the migration can be applied again after a rollback",
  (await q(`select to_regclass('public.highlights') r`))[0].r !== null,
);

await shutdown();
