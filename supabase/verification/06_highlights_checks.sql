-- Verse Snap: VERSE HIGHLIGHT CHECKS  (leaves NOTHING behind)
--
-- DEV PROJECT ONLY (ref shoztcflucpnfenohgcr), after 20261021000000_verse_highlights.
--
-- Every test runs inside one PL/pgSQL block that is rolled back at the end (a deliberate
-- exception), so the two disposable accounts and all their rows never persist, whatever happens.
-- Accounts use fixed ids and .invalid emails; the pre-flight refuses to run if either is in use.
--
-- Covers: structure and grants, set / change / remove a highlight, one per verse, translation
-- isolation, colour and position checks, merge-style insert-or-ignore, two-user RLS isolation,
-- signed-out access, and that nobody else's highlights change.
-- Read the last row: "OVERALL: all tests pass" = true -> success.
-- (Concurrent writes are covered by scripts/db/highlights-migration-test.mjs on a local database.)

create or replace function pg_temp.vs_highlights_checks()
returns table (step bigint, test text, passed boolean, detail text)
language plpgsql
as $fn$
declare
  a  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000007';
  b  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000008';
  ea constant text := 'highlight-verify-a@example.invalid';
  eb constant text := 'highlight-verify-b@example.invalid';
  res jsonb := '[]'::jsonb;
  others_before text;
  others_after  text;
  n   int;
  c   text;
  ok  boolean;
begin
  if exists (select 1 from auth.users where id in (a, b) or email in (ea, eb)) then
    return query select 1::bigint, 'pre-flight: a test id or email is already in use', false,
      'Refusing to run. Nothing was changed.'::text;
    return;
  end if;

  -- Structure (read-only) ------------------------------------------------------------
  res := res || jsonb_build_object('test', 'table has RLS enabled and one own-row policy for authenticated',
    'passed', coalesce((select relrowsecurity from pg_class where oid = 'public.highlights'::regclass), false)
      and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'highlights') = 1
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'highlights'
                   and cmd = 'ALL' and roles = '{authenticated}'
                   and qual like '%auth.uid()%user_id%' and with_check like '%auth.uid()%user_id%'));
  res := res || jsonb_build_object('test', 'unique key is (user_id, translation, book_id, chapter, verse)',
    'passed', exists (select 1 from pg_constraint where conrelid = 'public.highlights'::regclass
                       and conname = 'highlights_verse_key'
                       and pg_get_constraintdef(oid) = 'UNIQUE (user_id, translation, book_id, chapter, verse)'));
  select string_agg(privilege_type, ',' order by privilege_type) into c
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'highlights' and grantee = 'authenticated';
  res := res || jsonb_build_object('test', 'signed-in grants are exactly SELECT, INSERT, UPDATE, DELETE; signed-out none',
    'passed', c = 'DELETE,INSERT,SELECT,UPDATE'
      and not exists (select 1 from information_schema.role_table_grants
                       where table_schema = 'public' and table_name = 'highlights' and grantee = 'anon'),
    'detail', c);

  select md5(coalesce(string_agg(h::text, '|' order by h.id), '')) into others_before from public.highlights h;

  begin
    insert into auth.users (id, aud, role, email, raw_user_meta_data) values
      (a, 'authenticated', 'authenticated', ea, '{}'),
      (b, 'authenticated', 'authenticated', eb, '{}');

    -- 1. set, change, remove ------------------------------------------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if auth.uid() is distinct from a or current_user <> 'authenticated' then
        raise exception 'role/JWT simulation not in effect';
      end if;
      insert into public.highlights (user_id, translation, book_id, chapter, verse, color)
      values (a, 'KJAV', 'john', 3, 16, 'amber')
      on conflict (user_id, translation, book_id, chapter, verse) do update set color = excluded.color, updated_at = excluded.updated_at;
      insert into public.highlights (user_id, translation, book_id, chapter, verse, color)
      values (a, 'KJAV', 'john', 3, 16, 'sage')
      on conflict (user_id, translation, book_id, chapter, verse) do update set color = excluded.color, updated_at = excluded.updated_at;
      select count(*), max(color) into n, c from public.highlights where user_id = a;
      ok := n = 1 and c = 'sage';
      delete from public.highlights where user_id = a and translation = 'KJAV' and book_id = 'john' and chapter = 3 and verse = 16;
      select count(*) into n from public.highlights where user_id = a;
      reset role;
      res := res || jsonb_build_object('test', 'set, change (one row, new colour) and remove a highlight', 'passed', ok and n = 0);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'set, change (one row, new colour) and remove a highlight', 'passed', false, 'detail', sqlerrm);
    end;

    -- 2. one per verse; translations are separate ---------------------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values
        (a, 'KJAV', 'john', 3, 16, 'rose'), (a, 'WEB', 'john', 3, 16, 'sky');
      ok := false;
      begin
        insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values (a, 'KJAV', 'john', 3, 16, 'lilac');
      exception when unique_violation then ok := true;
      end;
      select count(*) into n from public.highlights where user_id = a;
      reset role;
      res := res || jsonb_build_object('test', 'one highlight per verse; the same verse in another translation is separate',
        'passed', ok and n = 2, 'detail', format('rows=%s', n));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'one highlight per verse; the same verse in another translation is separate', 'passed', false, 'detail', sqlerrm);
    end;

    -- 3. invalid values are rejected ----------------------------------------------------
    ok := true;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values (a, 'KJAV', 'acts', 2, 1, 'clear');
        ok := false;
      exception when check_violation then null;
      end;
      begin
        insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values (a, 'KJAV', 'acts', 2, 0, 'amber');
        ok := false;
      exception when check_violation then null;
      end;
      begin
        insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values (a, 'KJAV', 'acts', 2, 1, null);
        ok := false;
      exception when not_null_violation then null;
      end;
      reset role;
      res := res || jsonb_build_object('test', 'unknown colour, verse 0 and a missing colour are rejected', 'passed', ok);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'unknown colour, verse 0 and a missing colour are rejected', 'passed', false, 'detail', sqlerrm);
    end;

    -- 4. merge-style insert-or-ignore keeps the account's colour ---------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values
        (a, 'KJAV', 'john', 3, 16, 'amber'), (a, 'KJAV', 'john', 3, 17, 'amber')
      on conflict (user_id, translation, book_id, chapter, verse) do nothing;
      select color into c from public.highlights where user_id = a and translation = 'KJAV' and verse = 16;
      select count(*) into n from public.highlights where user_id = a;
      reset role;
      res := res || jsonb_build_object('test', 'merge insert-or-ignore: adds new verses, keeps the account''s existing colour',
        'passed', c = 'rose' and n = 3, 'detail', format('colour=%s rows=%s', c, n));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'merge insert-or-ignore: adds new verses, keeps the account''s existing colour', 'passed', false, 'detail', sqlerrm);
    end;

    -- 5. two-user isolation ---------------------------------------------------------------
    begin
      select count(*) into n from public.highlights where user_id = a;  -- positive control
      if n <> 3 then raise exception 'positive control: expected 3 of A''s rows, found %', n; end if;

      perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if auth.uid() is distinct from b then raise exception 'not running as B'; end if;
      insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values (b, 'KJAV', 'john', 3, 16, 'lilac');
      select count(*) into n from public.highlights where user_id = a;
      if n <> 0 then raise exception 'B can see % of A''s highlights', n; end if;
      update public.highlights set color = 'amber' where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B changed % of A''s highlights', n; end if;
      delete from public.highlights where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B deleted % of A''s highlights', n; end if;
      begin
        insert into public.highlights (user_id, translation, book_id, chapter, verse, color) values (a, 'KJAV', 'acts', 1, 1, 'amber');
        raise exception 'B wrote a highlight as A';
      exception when insufficient_privilege then null;
      end;
      reset role;

      select count(*), max(color) filter (where verse = 16 and translation = 'KJAV') into n, c from public.highlights where user_id = a;
      if n <> 3 or c <> 'rose' then raise exception 'A''s highlights changed (rows=%, colour=%)', n, c; end if;
      res := res || jsonb_build_object('test', 'two users: own rows only; B cannot read, change, delete or write as A', 'passed', true);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'two users: own rows only; B cannot read, change, delete or write as A', 'passed', false, 'detail', sqlerrm);
    end;

    -- 6. signed out ----------------------------------------------------------------------
    ok := false;
    begin
      set local role anon;
      perform 1 from public.highlights limit 1;
      reset role;
    exception when insufficient_privilege then
      reset role;
      ok := true;
    end;
    res := res || jsonb_build_object('test', 'signed-out (anon) requests cannot read highlights', 'passed', ok);

    -- 7. account deletion removes that account's highlights -------------------------------
    delete from auth.users where id = b and email = eb;
    select count(*) into n from public.highlights where user_id = b;
    res := res || jsonb_build_object('test', 'deleting an account deletes its highlights', 'passed', n = 0);

    -- 8. nobody else's highlights were touched ---------------------------------------------
    select md5(coalesce(string_agg(h::text, '|' order by h.id), '')) into others_after
      from public.highlights h where h.user_id not in (a, b);
    res := res || jsonb_build_object('test', 'existing users'' highlights are unchanged', 'passed', others_after = others_before);

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
           coalesce(bool_and((e ->> 'passed')::boolean), false) and count(*) = 11
           and not exists (select 1 from auth.users where id in (a, b)),
           'test accounts present afterwards: ' || exists (select 1 from auth.users where id in (a, b))
    from jsonb_array_elements(res) as e
    order by 1;
end
$fn$;

select * from pg_temp.vs_highlights_checks();
