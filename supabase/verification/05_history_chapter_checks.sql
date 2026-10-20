-- Verse Snap: HISTORY CHAPTER-ENTRY CHECKS  (leaves NOTHING behind)
--
-- DEV PROJECT ONLY (ref shoztcflucpnfenohgcr), after 20261020000000_history_chapter_entries.
--
-- Every test runs inside one PL/pgSQL block that is rolled back at the end (a deliberate
-- exception), so the two disposable accounts and all their rows never persist, whatever happens.
-- Accounts use fixed ids and .invalid emails; the pre-flight refuses to run if either id or email
-- is already used by something else.
--
-- Tests run as the authenticated role with the JWT subject set, as the API does:
--   chapter upsert (null verse, no duplicates), verse upsert, duplicate rejection, the
--   verse/chapter check, merge-style insert-or-ignore, two-user isolation, other users' rows
--   untouched.
-- Read the last row: "OVERALL: all tests pass" = true -> success.
-- (Concurrent writes are covered by scripts/db/history-migration-test.mjs on a local database.)

create or replace function pg_temp.vs_history_chapter_checks()
returns table (step bigint, test text, passed boolean, detail text)
language plpgsql
as $fn$
declare
  a  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000005';
  b  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000006';
  ea constant text := 'history-verify-a@example.invalid';
  eb constant text := 'history-verify-b@example.invalid';
  res jsonb := '[]'::jsonb;
  others_before text;
  others_after  text;
  n   int;
  t1  timestamptz;
  t2  timestamptz;
  vv  int;
  kk  text;
  ok  boolean;
begin
  if exists (select 1 from auth.users where id in (a, b) or email in (ea, eb)) then
    return query select 1::bigint, 'pre-flight: a test id or email is already in use', false,
      'Refusing to run. Nothing was changed.'::text;
    return;
  end if;

  select md5(coalesce(string_agg(h::text, '|' order by h.id), '')) into others_before from public.history h;

  begin
    insert into auth.users (id, aud, role, email, raw_user_meta_data) values
      (a, 'authenticated', 'authenticated', ea, '{}'),
      (b, 'authenticated', 'authenticated', eb, '{}');

    -- 1. A records a chapter visit twice: one row, null verse, newest time --------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if auth.uid() is distinct from a or current_user <> 'authenticated' then
        raise exception 'role/JWT simulation not in effect';
      end if;
      insert into public.history (user_id, kind, translation, book_id, book_name, chapter, verse, verse_text, viewed_at)
      values (a, 'chapter', 'KJAV', 'romans', 'Romans', 12, null, '', '2026-03-01T10:00:00Z')
      on conflict (user_id, translation, book_id, chapter, verse) do update
        set viewed_at = excluded.viewed_at, book_name = excluded.book_name;
      insert into public.history (user_id, kind, translation, book_id, book_name, chapter, verse, verse_text, viewed_at)
      values (a, 'chapter', 'KJAV', 'romans', 'Romans', 12, null, '', '2026-03-02T10:00:00Z')
      on conflict (user_id, translation, book_id, chapter, verse) do update
        set viewed_at = excluded.viewed_at, book_name = excluded.book_name;
      select count(*), max(viewed_at), max(verse), max(kind) into n, t1, vv, kk
        from public.history where user_id = a and kind = 'chapter';
      reset role;
      ok := n = 1 and vv is null and kk = 'chapter' and t1 = '2026-03-02T10:00:00Z';
      res := res || jsonb_build_object('test', 'chapter visit: null verse, upsert keeps one row with the newest time',
        'passed', ok, 'detail', format('rows=%s verse=%s time=%s', n, vv, t1));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'chapter visit: null verse, upsert keeps one row with the newest time', 'passed', false, 'detail', sqlerrm);
    end;

    -- 2. A views a verse twice via the atomic upsert: one row ------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.history (user_id, kind, translation, book_id, book_name, chapter, verse, verse_text, viewed_at)
      values (a, 'verse', 'KJAV', 'romans', 'Romans', 12, 2, 'x', '2026-03-03T10:00:00Z')
      on conflict (user_id, translation, book_id, chapter, verse) do update set viewed_at = excluded.viewed_at;
      insert into public.history (user_id, kind, translation, book_id, book_name, chapter, verse, verse_text, viewed_at)
      values (a, 'verse', 'KJAV', 'romans', 'Romans', 12, 2, 'x', '2026-03-04T10:00:00Z')
      on conflict (user_id, translation, book_id, chapter, verse) do update set viewed_at = excluded.viewed_at;
      select count(*), max(viewed_at) into n, t1 from public.history where user_id = a and kind = 'verse';
      reset role;
      res := res || jsonb_build_object('test', 'verse view: atomic upsert keeps one row, coexisting with the chapter entry',
        'passed', n = 1 and t1 = '2026-03-04T10:00:00Z', 'detail', format('rows=%s', n));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'verse view: atomic upsert keeps one row, coexisting with the chapter entry', 'passed', false, 'detail', sqlerrm);
    end;

    -- 3. Plain duplicates are rejected (chapter and verse) ----------------------------
    ok := true;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        insert into public.history (user_id, kind, book_id, book_name, chapter, verse) values (a, 'chapter', 'romans', 'Romans', 12, null);
        ok := false;
      exception when unique_violation then null;
      end;
      begin
        insert into public.history (user_id, book_id, book_name, chapter, verse) values (a, 'romans', 'Romans', 12, 2);
        ok := false;
      exception when unique_violation then null;
      end;
      reset role;
      res := res || jsonb_build_object('test', 'a second chapter or verse row for the same key is rejected', 'passed', ok);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'a second chapter or verse row for the same key is rejected', 'passed', false, 'detail', sqlerrm);
    end;

    -- 4. Invalid verse/chapter combinations are rejected -------------------------------
    ok := true;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        insert into public.history (user_id, kind, book_id, book_name, chapter, verse) values (a, 'chapter', 'acts', 'Acts', 2, 1);
        ok := false;
      exception when check_violation then null;
      end;
      begin
        insert into public.history (user_id, kind, book_id, book_name, chapter, verse) values (a, 'verse', 'acts', 'Acts', 2, null);
        ok := false;
      exception when check_violation then null;
      end;
      begin
        insert into public.history (user_id, book_id, book_name, chapter, verse) values (a, 'acts', 'Acts', 2, null);
        ok := false;
      exception when check_violation then null;
      end;
      reset role;
      res := res || jsonb_build_object('test', 'chapter with a verse, verse without one, and kind-less null verse are rejected', 'passed', ok);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'chapter with a verse, verse without one, and kind-less null verse are rejected', 'passed', false, 'detail', sqlerrm);
    end;

    -- 5. Merge-style insert-or-ignore keeps the account's own entry --------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.history (user_id, kind, translation, book_id, book_name, chapter, verse, verse_text, viewed_at)
      values (a, 'chapter', 'KJAV', 'romans', 'Romans', 12, null, '', '2026-01-01T10:00:00Z'),
             (a, 'chapter', 'KJAV', 'romans', 'Romans', 13, null, '', '2026-01-02T10:00:00Z')
      on conflict (user_id, translation, book_id, chapter, verse) do nothing;
      select viewed_at into t1 from public.history where user_id = a and kind = 'chapter' and chapter = 12;
      select count(*) into n from public.history where user_id = a and kind = 'chapter';
      reset role;
      res := res || jsonb_build_object('test', 'merge insert-or-ignore: adds new chapters, keeps the existing one unchanged',
        'passed', n = 2 and t1 = '2026-03-02T10:00:00Z', 'detail', format('chapters=%s time=%s', n, t1));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'merge insert-or-ignore: adds new chapters, keeps the existing one unchanged', 'passed', false, 'detail', sqlerrm);
    end;

    -- 6. Two-user isolation ----------------------------------------------------------
    begin
      select count(*) into n from public.history where user_id = a;  -- positive control as owner
      if n < 3 then raise exception 'positive control: expected A''s rows, found %', n; end if;
      select max(viewed_at) into t2 from public.history where user_id = a;

      perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if auth.uid() is distinct from b then raise exception 'not running as B'; end if;
      insert into public.history (user_id, kind, translation, book_id, book_name, chapter, verse, verse_text)
      values (b, 'chapter', 'KJAV', 'romans', 'Romans', 12, null, '')
      on conflict (user_id, translation, book_id, chapter, verse) do update set viewed_at = excluded.viewed_at;
      select count(*) into n from public.history where user_id = a;
      if n <> 0 then raise exception 'B can see % of A''s rows', n; end if;
      update public.history set viewed_at = now() where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B updated % of A''s rows', n; end if;
      delete from public.history where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B deleted % of A''s rows', n; end if;
      begin
        insert into public.history (user_id, kind, book_id, book_name, chapter, verse) values (a, 'chapter', 'john', 'John', 1, null);
        raise exception 'B wrote a row as A';
      exception when insufficient_privilege then null;
      end;
      reset role;

      select count(*) into n from public.history where user_id = b and kind = 'chapter';
      if n <> 1 then raise exception 'B''s own chapter row missing (%)', n; end if;
      select max(viewed_at) into t1 from public.history where user_id = a;
      if t1 is distinct from t2 then raise exception 'A''s rows changed'; end if;
      res := res || jsonb_build_object('test', 'two users: own chapter rows; B cannot read, change, delete or write as A', 'passed', true);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'two users: own chapter rows; B cannot read, change, delete or write as A', 'passed', false, 'detail', sqlerrm);
    end;

    -- 7. Nobody else's history was touched -------------------------------------------
    select md5(coalesce(string_agg(h::text, '|' order by h.id), '')) into others_after
      from public.history h where h.user_id not in (a, b);
    res := res || jsonb_build_object('test', 'existing users'' history rows are unchanged', 'passed', others_after = others_before);

    raise exception 'vs_rollback';  -- undo everything above, keep the results
  exception when others then
    if sqlerrm <> 'vs_rollback' then
      res := res || jsonb_build_object('test', 'unexpected error (everything was rolled back)', 'passed', false, 'detail', sqlerrm);
    end if;
  end;

  return query
    select t.ord, t.e ->> 'test', (t.e ->> 'passed')::boolean, t.e ->> 'detail'
    from jsonb_array_elements(res) with ordinality as t(e, ord)
    union all
    select 999::bigint, 'OVERALL: all tests pass',
           coalesce(bool_and((e ->> 'passed')::boolean), false) and count(*) = 7
           and not exists (select 1 from auth.users where id in (a, b)),
           'test accounts present afterwards: ' || exists (select 1 from auth.users where id in (a, b))
    from jsonb_array_elements(res) as e
    order by 1;
end
$fn$;

select * from pg_temp.vs_history_chapter_checks();
