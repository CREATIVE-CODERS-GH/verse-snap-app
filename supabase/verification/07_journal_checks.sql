-- Verse Snap: REFLECTION JOURNAL CHECKS  (leaves NOTHING behind)
--
-- DEV PROJECT ONLY (ref shoztcflucpnfenohgcr), after 20261022000000_reflection_journal.
--
-- Every test runs inside one PL/pgSQL block that is rolled back at the end (a deliberate
-- exception), so the two disposable accounts and all their rows never persist, whatever happens.
-- Accounts use fixed ids and .invalid emails; the pre-flight refuses to run if either is in use.
--
-- Covers: structure, grants (table and column), the default notebook rules, unique names, one
-- reflection per verse, cross-user notebook refusal, edit change detection, safe notebook delete,
-- retry-safe import, two-user RLS isolation, signed-out access, account deletion, and that nobody
-- else's journal changes.
-- Read the last row: "OVERALL: all tests pass" = true -> success.
-- (Concurrent writes are covered by scripts/db/journal-migration-test.mjs on a local database.)

create or replace function pg_temp.vs_journal_checks()
returns table (step bigint, test text, passed boolean, detail text)
language plpgsql
as $fn$
declare
  a  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000009';
  b  constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  ea constant text := 'journal-verify-a@example.invalid';
  eb constant text := 'journal-verify-b@example.invalid';
  res jsonb := '[]'::jsonb;
  others_before text;
  others_after  text;
  general_a uuid := gen_random_uuid();
  notebook_a uuid := gen_random_uuid();
  general_b uuid := gen_random_uuid();
  note_a uuid := gen_random_uuid();
  guest_note uuid := gen_random_uuid();
  stamp timestamptz;
  n   int;
  c   text;
  ok  boolean;
begin
  if exists (select 1 from auth.users where id in (a, b) or email in (ea, eb)) then
    return query select 1::bigint, 'pre-flight: a test id or email is already in use', false,
      'Refusing to run. Nothing was changed.'::text;
    return;
  end if;

  -- Structure (read-only) ------------------------------------------------------------------
  res := res || jsonb_build_object('test', 'RLS on and one own-row policy on notebooks and reflections',
    'passed', (select bool_and(relrowsecurity) from pg_class where oid in ('public.notebooks'::regclass, 'public.reflections'::regclass))
      and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('notebooks', 'reflections')
            and cmd = 'ALL' and roles = '{authenticated}'
            and qual like '%auth.uid()%user_id%' and with_check like '%auth.uid()%user_id%') = 2
      and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('notebooks', 'reflections')) = 2);
  select string_agg(table_name || ':' || privilege_type, ',' order by table_name, privilege_type) into c
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('notebooks', 'reflections') and grantee in ('anon', 'authenticated');
  res := res || jsonb_build_object('test', 'table grants: signed-in SELECT/INSERT/DELETE only, signed-out none',
    'passed', c = 'notebooks:DELETE,notebooks:INSERT,notebooks:SELECT,reflections:DELETE,reflections:INSERT,reflections:SELECT',
    'detail', c);
  select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) into c
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('notebooks', 'reflections')
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  res := res || jsonb_build_object('test', 'signed-in may update only the editable columns',
    'passed', c = 'notebooks.name,notebooks.updated_at,reflections.body,reflections.is_private,reflections.notebook_id,reflections.posture,reflections.tags,reflections.title,reflections.updated_at',
    'detail', c);

  select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) into others_before from public.reflections r;

  begin
    insert into auth.users (id, aud, role, email, raw_user_meta_data) values
      (a, 'authenticated', 'authenticated', ea, '{}'),
      (b, 'authenticated', 'authenticated', eb, '{}');

    -- 1. notebooks: one default, unique names, rename; default flag locked -------------------------
    ok := true;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if auth.uid() is distinct from a or current_user <> 'authenticated' then
        raise exception 'role/JWT simulation not in effect';
      end if;
      insert into public.notebooks (id, user_id, name, is_default) values (general_a, a, 'General Reflections', true);
      insert into public.notebooks (id, user_id, name) values (notebook_a, a, 'Prayer Journal');
      begin
        insert into public.notebooks (user_id, name, is_default) values (a, 'Second default', true);
        ok := false;
      exception when unique_violation then null;
      end;
      begin
        insert into public.notebooks (user_id, name) values (a, 'PRAYER JOURNAL');
        ok := false;
      exception when unique_violation then null;
      end;
      update public.notebooks set name = 'Prayer & Praise', updated_at = now() where id = notebook_a;
      begin
        update public.notebooks set is_default = true where id = notebook_a;
        ok := false;
      exception when insufficient_privilege then null;
      end;
      select name into c from public.notebooks where id = notebook_a;
      reset role;
      res := res || jsonb_build_object('test', 'notebooks: one default, unique names (any case), rename works, default flag locked',
        'passed', ok and c = 'Prayer & Praise', 'detail', c);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'notebooks: one default, unique names (any case), rename works, default flag locked', 'passed', false, 'detail', sqlerrm);
    end;

    -- 2. reflections: one per verse; own notebooks only; edits with change detection ---------------
    ok := true;
    begin
      insert into public.notebooks (id, user_id, name, is_default) values (general_b, b, 'General Reflections', true);
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.reflections (id, user_id, notebook_id, translation, book_id, chapter, verse, title, body, tags, posture)
      values (note_a, a, notebook_a, 'KJAV', 'john', 3, 16, 'Love', 'God so loved', '{#Faith}', 'grateful')
      returning updated_at into stamp;
      insert into public.reflections (user_id, notebook_id, translation, book_id, chapter, verse, body)
      values (a, general_a, 'WEB', 'john', 3, 16, 'Same verse, other translation');
      begin
        insert into public.reflections (user_id, notebook_id, translation, book_id, chapter, verse, body)
        values (a, general_a, 'KJAV', 'john', 3, 16, 'Duplicate');
        ok := false;
      exception when unique_violation then null;
      end;
      begin
        insert into public.reflections (user_id, notebook_id, translation, book_id, chapter, verse, body)
        values (a, general_b, 'KJAV', 'john', 3, 17, 'In B''s notebook');
        ok := false;
      exception when foreign_key_violation then null;
      end;
      begin
        insert into public.reflections (user_id, notebook_id, translation, book_id, chapter, verse, title, body)
        values (a, general_a, 'KJAV', 'john', 3, 18, ' ', ' ');
        ok := false;
      exception when check_violation then null;
      end;
      update public.reflections set body = 'Edited', updated_at = now() where id = note_a and updated_at = stamp;
      get diagnostics n = row_count;
      if n <> 1 then ok := false; end if;
      update public.reflections set body = 'Stale', updated_at = now() where id = note_a and updated_at = stamp - interval '1 second';
      get diagnostics n = row_count;
      if n <> 0 then ok := false; end if;
      begin
        update public.reflections set verse = 99 where id = note_a;
        ok := false;
      exception when insufficient_privilege then null;
      end;
      select body into c from public.reflections where id = note_a;
      reset role;
      res := res || jsonb_build_object('test', 'reflections: one per verse+translation, own notebooks only, not empty, stale edits change nothing',
        'passed', ok and c = 'Edited', 'detail', c);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'reflections: one per verse+translation, own notebooks only, not empty, stale edits change nothing', 'passed', false, 'detail', sqlerrm);
    end;

    -- 3. safe notebook delete -------------------------------------------------------------------
    ok := false;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        delete from public.notebooks where id = general_a;
      exception when raise_exception then ok := true;
      end;
      delete from public.notebooks where id = notebook_a;
      select notebook_id::text into c from public.reflections where id = note_a;
      select count(*) into n from public.reflections where user_id = a;
      reset role;
      res := res || jsonb_build_object('test', 'default notebook can''t be deleted; deleting another moves its reflections to General',
        'passed', ok and c = general_a::text and n = 2, 'detail', format('rows=%s', n));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'default notebook can''t be deleted; deleting another moves its reflections to General', 'passed', false, 'detail', sqlerrm);
    end;

    -- 4. retry-safe guest import ---------------------------------------------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      for i in 1..2 loop
        insert into public.reflections (id, user_id, notebook_id, translation, book_id, chapter, verse, body)
        values (guest_note, a, general_a, 'KJAV', 'john', 3, 20, 'From the device'),
               (gen_random_uuid(), a, general_a, 'KJAV', 'john', 3, 16, 'Conflicts with the account note')
        on conflict (user_id, translation, book_id, chapter, verse) do nothing;
      end loop;
      select count(*) into n from public.reflections where user_id = a;
      select body into c from public.reflections where user_id = a and translation = 'KJAV' and verse = 16;
      reset role;
      res := res || jsonb_build_object('test', 'import adds new notes once and keeps the account''s note where the verse already has one',
        'passed', n = 3 and c = 'Edited', 'detail', format('rows=%s body=%s', n, c));
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'import adds new notes once and keeps the account''s note where the verse already has one', 'passed', false, 'detail', sqlerrm);
    end;

    -- 5. two-user isolation ----------------------------------------------------------------------
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
      set local role authenticated;
      if auth.uid() is distinct from b then raise exception 'not running as B'; end if;
      select count(*) into n from public.reflections where user_id = a;
      if n <> 0 then raise exception 'B can see % of A''s reflections', n; end if;
      select count(*) into n from public.notebooks where user_id = a;
      if n <> 0 then raise exception 'B can see % of A''s notebooks', n; end if;
      update public.reflections set body = 'x' where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B changed % of A''s reflections', n; end if;
      delete from public.reflections where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B deleted % of A''s reflections', n; end if;
      delete from public.notebooks where user_id = a;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'B deleted % of A''s notebooks', n; end if;
      begin
        insert into public.reflections (user_id, notebook_id, translation, book_id, chapter, verse, body)
        values (a, general_a, 'KJAV', 'acts', 1, 1, 'As A');
        raise exception 'B wrote a reflection as A';
      exception when insufficient_privilege then null;
      end;
      reset role;
      select count(*) into n from public.reflections where user_id = a;
      if n <> 3 then raise exception 'A''s reflections changed (%)', n; end if;
      res := res || jsonb_build_object('test', 'two users: B cannot read, change, delete or write A''s journal', 'passed', true);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'two users: B cannot read, change, delete or write A''s journal', 'passed', false, 'detail', sqlerrm);
    end;

    -- 6. signed out -------------------------------------------------------------------------------
    ok := false;
    begin
      set local role anon;
      perform 1 from public.reflections limit 1;
      reset role;
    exception when insufficient_privilege then
      reset role;
      ok := true;
    end;
    res := res || jsonb_build_object('test', 'signed-out (anon) requests cannot read reflections', 'passed', ok);

    -- 7. account deletion -----------------------------------------------------------------------
    delete from auth.users where id = a and email = ea;
    select (select count(*) from public.notebooks where user_id = a) + (select count(*) from public.reflections where user_id = a) into n;
    res := res || jsonb_build_object('test', 'deleting an account deletes its notebooks and reflections', 'passed', n = 0);

    -- 8. nobody else's journal was touched ----------------------------------------------------------
    select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) into others_after
      from public.reflections r where r.user_id not in (a, b);
    res := res || jsonb_build_object('test', 'existing users'' reflections are unchanged', 'passed', others_after = others_before);

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

select * from pg_temp.vs_journal_checks();
