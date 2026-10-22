// Tests supabase/migrations/20261022000000_reflection_journal.sql on a THROWAWAY local
// PostgreSQL 17 (never on Supabase): structure and grants, notebooks (default, unique names,
// rename, safe delete), reflections (one per verse, edit with change detection, cross-user
// notebook refused), the guest import (retry-safe), two-user RLS isolation, concurrency from
// separate connections, account deletion, verification 07, and the rollback.
// Setup and run: see scripts/db/lib.mjs, then  DB_TEST_DEPS=<folder> npm run test:db:journal
import { randomUUID } from "node:crypto";
import { read, startDatabase } from "./lib.mjs";

const UP = "supabase/migrations/20261022000000_reflection_journal.sql";
const DOWN = "supabase/rollbacks/20261022000000_reflection_journal.down.sql";
const t = await startDatabase({ port: Number(process.env.DB_TEST_PORT ?? 54331) });
const { db, q, connect, check, shutdown, applyMigrations, asUser, expectError, lastRows } = t;

await applyMigrations("20261022000000");
check("existing migrations (through highlights) apply", true);

const otherSchema = async () =>
  JSON.stringify(
    await q(`
      select 'col' k, c.relname || '.' || attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull v
        from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and c.relname not in ('notebooks', 'reflections') and attnum > 0 and not attisdropped
      union all select 'con', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        from pg_constraint where connamespace = 'public'::regnamespace
         and conrelid::regclass::text not in ('notebooks', 'reflections')
      union all select 'idx', indexdef from pg_indexes where schemaname = 'public' and tablename not in ('notebooks', 'reflections')
      union all select 'pol', tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, '')
        from pg_policies where schemaname = 'public' and tablename not in ('notebooks', 'reflections')
      union all select 'grant', table_name || grantee || privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name not in ('notebooks', 'reflections')
      union all select 'fn', proname from pg_proc where pronamespace = 'public'::regnamespace
      order by 1, 2`),
  );
const before = await otherSchema();
await q(read(UP));
check("migration applies", true);
const afterOthers = JSON.parse(await otherSchema()).filter(
  (r) => !(r.k === "fn" && r.v === "notebooks_move_reflections"),
);
check(
  "no other table, constraint, index, policy, grant or function changed",
  JSON.stringify(afterOthers) === before,
);

// ---------- structure and grants ----------
const policies = await q(
  `select tablename, cmd, roles::text, qual, with_check from pg_policies where tablename in ('notebooks', 'reflections') order by 1`,
);
check(
  "RLS on both tables, one own-row policy each for authenticated",
  (
    await q(
      `select bool_and(relrowsecurity) r from pg_class where oid in ('public.notebooks'::regclass, 'public.reflections'::regclass)`,
    )
  )[0].r === true &&
    policies.length === 2 &&
    policies.every(
      (p) =>
        p.cmd === "ALL" &&
        p.roles === "{authenticated}" &&
        /auth\.uid\(\).*user_id/.test(p.qual) &&
        /auth\.uid\(\).*user_id/.test(p.with_check),
    ),
  JSON.stringify(policies),
);
const tableGrants = await q(`
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) p
    from information_schema.role_table_grants
   where table_name in ('notebooks', 'reflections') and grantee in ('anon', 'authenticated')
   group by 1, 2 order by 1, 2`);
check(
  "signed-in table grants are SELECT, INSERT, DELETE only (UPDATE is per column); signed-out none",
  JSON.stringify(tableGrants) ===
    JSON.stringify([
      { table_name: "notebooks", grantee: "authenticated", p: "DELETE,INSERT,SELECT" },
      { table_name: "reflections", grantee: "authenticated", p: "DELETE,INSERT,SELECT" },
    ]),
  JSON.stringify(tableGrants),
);
const columnGrants = await q(`
  select table_name, string_agg(column_name, ',' order by column_name) c
    from information_schema.column_privileges
   where table_name in ('notebooks', 'reflections') and grantee = 'authenticated' and privilege_type = 'UPDATE'
   group by 1 order by 1`);
check(
  "signed-in can update only the editable columns",
  JSON.stringify(columnGrants) ===
    JSON.stringify([
      { table_name: "notebooks", c: "name,updated_at" },
      { table_name: "reflections", c: "body,is_private,notebook_id,posture,tags,title,updated_at" },
    ]),
  JSON.stringify(columnGrants),
);

// ---------- requests as the app makes them ----------
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
await q(
  `insert into auth.users (id, email) values ($1, 'a@example.invalid'), ($2, 'b@example.invalid')`,
  [A, B],
);
const one = async (client, user, sql, params) => (await asUser(client, user, sql, params)).rows;
const addNotebook = (client, user, name, { id = randomUUID(), isDefault = false } = {}) =>
  one(
    client,
    user,
    `insert into public.notebooks (id, user_id, name, is_default) values ($1, $2, $3, $4) returning *`,
    [id, user, name, isDefault],
  ).then((r) => r[0]);
const addReflection = (client, user, notebookId, verse, fields = {}, translation = "KJAV") =>
  one(
    client,
    user,
    `insert into public.reflections (id, user_id, notebook_id, translation, book_id, chapter, verse, title, body, tags, posture)
     values ($1, $2, $3, $4, 'john', 3, $5, $6, $7, $8, $9) returning *`,
    [
      fields.id ?? randomUUID(),
      user,
      notebookId,
      translation,
      verse,
      fields.title ?? "",
      fields.body ?? "A note",
      fields.tags ?? [],
      fields.posture ?? null,
    ],
  ).then((r) => r[0]);

// Notebooks
const generalA = await addNotebook(db, A, "General Reflections", { isDefault: true });
const secondDefault = await expectError(
  () => addNotebook(db, A, "Another", { isDefault: true }),
  /notebooks_user_default_key/,
);
check("one default notebook per person", secondDefault === true, String(secondDefault));
const prayer = await addNotebook(db, A, "Prayer Journal");
const sameName = await expectError(
  () => addNotebook(db, A, "prayer journal"),
  /notebooks_user_name_key/,
);
check("notebook names are unique per person, ignoring case", sameName === true, String(sameName));
const generalB = await addNotebook(db, B, "General Reflections", { isDefault: true });
await addNotebook(db, B, "Prayer Journal");
check("another person can use the same notebook names", true);
for (const [label, name] of [
  ["empty", ""],
  ["only spaces", "   "],
  ["padded", " Prayer "],
  ["over 60 characters", "x".repeat(61)],
]) {
  const bad = await expectError(() => addNotebook(db, A, name), /check/);
  check(`a notebook name that is ${label} is rejected`, bad === true, String(bad));
}
await one(
  db,
  A,
  `update public.notebooks set name = 'Prayer & Praise', updated_at = now() where id = $1`,
  [prayer.id],
);
check(
  "renaming a notebook works",
  (await q(`select name from public.notebooks where id = $1`, [prayer.id]))[0].name ===
    "Prayer & Praise",
);
const flipDefault = await expectError(
  () => one(db, A, `update public.notebooks set is_default = true where id = $1`, [prayer.id]),
  /permission denied/,
);
check("the default flag can't be changed by the app", flipDefault === true, String(flipDefault));
const moveOwner = await expectError(
  () => one(db, A, `update public.notebooks set user_id = $2 where id = $1`, [prayer.id, B]),
  /permission denied/,
);
check("a notebook can't be given to someone else", moveOwner === true, String(moveOwner));

// Reflections
const r16 = await addReflection(db, A, prayer.id, 16, {
  title: "Love",
  tags: ["#Faith"],
  posture: "grateful",
});
await addReflection(db, A, generalA.id, 17);
await addReflection(db, A, generalA.id, 16, {}, "WEB");
check(
  "reflections are stored per verse and translation",
  (await q(`select count(*)::int n from public.reflections where user_id = $1`, [A]))[0].n === 3,
);
const dupVerse = await expectError(
  () => addReflection(db, A, generalA.id, 16),
  /reflections_verse_key/,
);
check(
  "a second reflection for the same verse and translation is rejected",
  dupVerse === true,
  String(dupVerse),
);
const emptyNote = await expectError(
  () => addReflection(db, A, generalA.id, 20, { title: " ", body: "  " }),
  /reflections_not_empty/,
);
check("an empty reflection is rejected", emptyNote === true, String(emptyNote));
const foreignNotebook = await expectError(
  () => addReflection(db, A, generalB.id, 21),
  /reflections_notebook_fkey/,
);
check(
  "a reflection can't be put in someone else's notebook",
  foreignNotebook === true,
  String(foreignNotebook),
);
const tooManyTags = await expectError(
  () =>
    addReflection(db, A, generalA.id, 22, { tags: Array.from({ length: 21 }, (_, i) => `#t${i}`) }),
  /check/,
);
check("more than 20 tags is rejected", tooManyTags === true, String(tooManyTags));

// Editing with change detection (the app sends the updated_at it loaded).
// The exact text the API returns (microseconds), as the app keeps it; a JS Date would drop them.
const loaded = (
  await q(`select updated_at::text t from public.reflections where id = $1`, [r16.id])
)[0].t;
const firstEdit = await asUser(
  db,
  A,
  `update public.reflections set body = 'Edited', updated_at = now() where id = $1 and updated_at = $2`,
  [r16.id, loaded],
);
const staleEdit = await asUser(
  db,
  A,
  `update public.reflections set body = 'Stale overwrite', updated_at = now() where id = $1 and updated_at = $2`,
  [r16.id, loaded],
);
check(
  "an edit based on the latest version saves; an edit based on an older version changes nothing",
  firstEdit.rowCount === 1 &&
    staleEdit.rowCount === 0 &&
    (await q(`select body from public.reflections where id = $1`, [r16.id]))[0].body === "Edited",
);
const moveVerse = await expectError(
  () => one(db, A, `update public.reflections set verse = 99 where id = $1`, [r16.id]),
  /permission denied/,
);
check(
  "a reflection's verse, translation and owner can't be changed",
  moveVerse === true,
  String(moveVerse),
);
await one(
  db,
  A,
  `update public.reflections set notebook_id = $2, updated_at = now() where id = $1`,
  [r16.id, generalA.id],
);
await one(
  db,
  A,
  `update public.reflections set notebook_id = $2, updated_at = now() where id = $1`,
  [r16.id, prayer.id],
);
check(
  "a reflection can be moved between the person's notebooks",
  (await q(`select notebook_id from public.reflections where id = $1`, [r16.id]))[0].notebook_id ===
    prayer.id,
);
const moveToB = await expectError(
  () =>
    one(db, A, `update public.reflections set notebook_id = $2 where id = $1`, [
      r16.id,
      generalB.id,
    ]),
  /reflections_notebook_fkey/,
);
check("…but not into someone else's notebook", moveToB === true, String(moveToB));

// Safe notebook delete
const deleteDefault = await expectError(
  () => one(db, A, `delete from public.notebooks where id = $1`, [generalA.id]),
  /can't be deleted/,
);
check("the default notebook can't be deleted", deleteDefault === true, String(deleteDefault));
await one(db, A, `delete from public.notebooks where id = $1`, [prayer.id]);
check(
  "deleting a notebook moves its reflections to General (nothing is lost)",
  (await q(`select notebook_id from public.reflections where id = $1`, [r16.id]))[0].notebook_id ===
    generalA.id &&
    (await q(`select count(*)::int n from public.reflections where user_id = $1`, [A]))[0].n === 3,
);

// ---------- two-user isolation ----------
check(
  "B sees only B's notebooks",
  (await one(db, B, `select user_id from public.notebooks`)).every((r) => r.user_id === B),
);
check(
  "B sees none of A's reflections",
  (await one(db, B, `select * from public.reflections where user_id = $1`, [A])).length === 0,
);
const aBefore = JSON.stringify(
  await q(`select * from public.reflections where user_id = $1 order by id`, [A]),
);
const touched =
  (await asUser(db, B, `update public.reflections set body = 'x' where user_id = $1`, [A]))
    .rowCount +
  (await asUser(db, B, `delete from public.reflections where user_id = $1`, [A])).rowCount +
  (await asUser(db, B, `delete from public.notebooks where user_id = $1`, [A])).rowCount;
check(
  "B cannot change or delete A's reflections or notebooks",
  touched === 0 &&
    JSON.stringify(
      await q(`select * from public.reflections where user_id = $1 order by id`, [A]),
    ) === aBefore,
);
const writeAsA = await expectError(
  () =>
    addNotebook(db, B, "Sneaky").then(() =>
      one(db, B, `insert into public.notebooks (user_id, name) values ($1, 'As A')`, [A]),
    ),
  /row-level security/,
);
check("B cannot create a notebook as A (RLS WITH CHECK)", writeAsA === true, String(writeAsA));
for (const table of ["notebooks", "reflections"]) {
  const anon = await expectError(async () => {
    await db.query("begin");
    await db.query("set local role anon");
    try {
      await db.query(`select * from public.${table}`);
    } finally {
      await db.query("rollback");
    }
  }, /permission denied/);
  check(`signed-out (anon) requests can't read ${table}`, anon === true, String(anon));
}
const truncate = await expectError(
  () => asUser(db, A, `truncate public.reflections`),
  /permission denied/,
);
check("signed-in requests can't TRUNCATE", truncate === true, String(truncate));

// ---------- guest import (what the merge sends) ----------
const guestNotebook = randomUUID();
const importNotebooks = (client) =>
  asUser(
    client,
    A,
    `insert into public.notebooks (id, user_id, name) values ($1, $2, 'Sermon Notes') on conflict (id) do nothing`,
    [guestNotebook, A],
  );
const guestReflections = [
  { id: randomUUID(), notebook: () => guestNotebook, verse: 30 },
  { id: randomUUID(), notebook: () => generalA.id, verse: 16 }, // the account already has John 3:16 (KJAV)
];
const importReflections = (client) =>
  asUser(
    client,
    A,
    `insert into public.reflections (id, user_id, notebook_id, translation, book_id, chapter, verse, body, created_at, updated_at)
     select x.id, $1, x.notebook_id, 'KJAV', 'john', 3, x.verse, 'From the device', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
       from jsonb_to_recordset($2) as x(id uuid, notebook_id uuid, verse int)
     on conflict (user_id, translation, book_id, chapter, verse) do nothing`,
    [
      A,
      JSON.stringify(
        guestReflections.map((g) => ({ id: g.id, notebook_id: g.notebook(), verse: g.verse })),
      ),
    ],
  );
await importNotebooks(db);
await importReflections(db);
await importNotebooks(db); // retry after an interruption
await importReflections(db);
const imported = (
  await one(db, A, `select id from public.reflections where id = any($1::uuid[])`, [
    guestReflections.map((g) => g.id),
  ])
).map((r) => r.id);
check(
  "guest import is retry-safe: the new note is added once, the verse the account already has keeps the account's note",
  imported.length === 1 &&
    imported[0] === guestReflections[0].id &&
    (
      await q(
        `select body from public.reflections where user_id = $1 and translation = 'KJAV' and verse = 16`,
        [A],
      )
    )[0].body === "Edited" &&
    (await q(`select count(*)::int n from public.notebooks where id = $1`, [guestNotebook]))[0]
      .n === 1,
);

// ---------- concurrency (separate connections) ----------
const C = "cccccccc-0000-4000-8000-00000000000c";
await q(`insert into auth.users (id, email) values ($1, 'c@example.invalid')`, [C]);
const clients = await Promise.all(Array.from({ length: 16 }, () => connect()));
let results = await Promise.allSettled(
  clients.map((client) => addNotebook(client, C, "General Reflections", { isDefault: true })),
);
const defaults = (
  await q(`select count(*)::int n from public.notebooks where user_id = $1 and is_default`, [C])
)[0].n;
check(
  "16 devices creating the default notebook at once: exactly one exists, the rest get a duplicate error to re-read",
  defaults === 1 &&
    results
      .filter((r) => r.status === "rejected")
      .every((r) => /notebooks_user_(default|name)_key/.test(r.reason.message)),
);
const generalC = (
  await q(`select id from public.notebooks where user_id = $1 and is_default`, [C])
)[0].id;
results = await Promise.allSettled(clients.map((client) => addReflection(client, C, generalC, 5)));
check(
  "16 simultaneous first saves of one verse: exactly one reflection",
  (
    await q(`select count(*)::int n from public.reflections where user_id = $1 and verse = 5`, [C])
  )[0].n === 1,
);
results = await Promise.allSettled(clients.map((client) => importReflections(client)));
check(
  "16 simultaneous retries of the guest import: all succeed, nothing duplicated",
  results.every((r) => r.status === "fulfilled") &&
    (
      await q(`select count(*)::int n from public.reflections where id = any($1::uuid[])`, [
        guestReflections.map((g) => g.id),
      ])
    )[0].n === 1,
);
await Promise.all(clients.map((client) => client.end()));

// ---------- account deletion ----------
await q(`delete from auth.users where id = $1`, [A]);
check(
  "deleting an account deletes its notebooks and reflections (the default-notebook rule doesn't block it)",
  (
    await q(
      `select (select count(*) from public.notebooks where user_id = $1) + (select count(*) from public.reflections where user_id = $1) n`,
      [A],
    )
  )[0].n === "0",
);
check(
  "…and nobody else's journal is touched",
  (await q(`select count(*)::int n from public.notebooks where user_id = $1`, [B]))[0].n === 3,
);

// ---------- verification scripts ----------
const runCheck = async (file, nameColumn, passColumn) => {
  const rows = lastRows(await db.query(read(file)));
  return {
    ok: rows.find((r) => /^OVERALL/.test(r[nameColumn]))?.[passColumn] === true,
    failing: rows
      .filter((r) => !r[passColumn])
      .map((r) => `${r[nameColumn]}${r.detail ? `: ${r.detail}` : ""}`)
      .join("; "),
  };
};
let result = await runCheck("supabase/verification/07_journal_checks.sql", "test", "passed");
check("07_journal_checks.sql passes and leaves nothing behind", result.ok, result.failing);
result = await runCheck("supabase/verification/01_structure_checks.sql", "check_name", "pass");
check("01_structure_checks.sql passes with the journal tables", result.ok, result.failing);

// ---------- rollback ----------
await q(read(DOWN));
check(
  "rollback removes the journal and leaves everything else exactly as before",
  (await otherSchema()) === before,
);
result = await runCheck("supabase/verification/01_structure_checks.sql", "check_name", "pass");
check("01_structure_checks.sql passes after the rollback", result.ok, result.failing);
await q(read(UP));
check(
  "the migration can be applied again after a rollback",
  (await q(`select to_regclass('public.reflections') r`))[0].r !== null,
);

await shutdown();
