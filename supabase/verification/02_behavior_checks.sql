-- Verse Snap: BEHAVIOUR CHECKS  (creates and deletes DISPOSABLE test data)
--
-- DEV PROJECT ONLY (ref shoztcflucpnfenohgcr). Run after 01_structure_checks.sql passes.
--
-- What it does:
--   * creates two disposable accounts directly in auth.users, with FIXED ids:
--       A  aaaaaaaa-0000-4000-8000-000000000001  phase3-verify-a@example.invalid
--       B  aaaaaaaa-0000-4000-8000-000000000002  phase3-verify-b@example.invalid
--     No email is sent; the .invalid domain can never receive mail. Nobody can
--     sign in as these accounts (no password, no identity rows).
--   * runs nine tests by switching to the authenticated / anon roles, as the API does
--   * deletes ONLY those two ids at the end and checks their data cascaded away
--
-- SAFEGUARDS
--   * Every delete is by exact id AND exact email. Nothing is ever deleted by
--     email pattern, so no other account can be touched.
--   * Pre-flight aborts (no insert, no delete, OVERALL = false) if
--       - either fixed id already exists with a DIFFERENT email, or
--       - either test email already exists under a DIFFERENT id, or
--       - the project holds more than 100 other accounts (does not look like a
--         small dev project).
--   * After each role switch the test asserts current_user and auth.uid(), so a
--     silent failure to switch role cannot make a test pass.
--   * "Must be denied" tests accept only the expected error text, and
--     "must not see" tests first prove the data exists (positive control) and
--     afterwards prove it is unchanged, so a vacuous pass is not possible.
--   * OVERALL requires all nine tests to have run and passed.
--
-- It ends NORMALLY with a result table. Read the last row:
--   "OVERALL: all tests pass" = true -> success. Any row with passed = false
--   names the failing test and the database's error text in "detail".
--
-- Manual clean-up if a run is ever interrupted (id AND email, both required):
--   delete from auth.users
--    where id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002')
--      and email in ('phase3-verify-a@example.invalid','phase3-verify-b@example.invalid');
--
-- Two statements: create a throw-away function in pg_temp (session-local, never
-- stored in any schema), then call it. Run the whole file at once.

create or replace function pg_temp.vs_behavior_checks()
returns table (step bigint, test text, passed boolean, detail text)
language plpgsql
as $fn$
declare
  a  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  b  constant uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  ea constant text := 'phase3-verify-a@example.invalid';
  eb constant text := 'phase3-verify-b@example.invalid';
  res jsonb := '[]'::jsonb;
  n   int;
  m   int;
  v   text;
  cur text;
  uid uuid;
begin
  -- Pre-flight ---------------------------------------------------------------
  if exists (select 1 from auth.users where id in (a, b) and email is distinct from case id when a then ea else eb end) then
    return query select 1::bigint, 'pre-flight: a fixed test id exists with an unexpected email', false,
      'Refusing to run. Nothing was inserted or deleted.'::text;
    return;
  end if;
  if exists (select 1 from auth.users where email in (ea, eb) and id not in (a, b)) then
    return query select 1::bigint, 'pre-flight: a test email exists under a different id', false,
      'Refusing to run. Nothing was inserted or deleted.'::text;
    return;
  end if;
  select count(*) into n from auth.users where id not in (a, b);
  if n > 100 then
    return query select 1::bigint, 'pre-flight: project has more than 100 other accounts', false,
      format('Found %s other accounts; this does not look like a small dev project. Nothing was inserted or deleted.', n);
    return;
  end if;

  -- Leftovers from an interrupted earlier run: exact id AND exact email only.
  delete from auth.users where id = a and email = ea;
  delete from auth.users where id = b and email = eb;

  -- 1. Registration ----------------------------------------------------------
  begin
    insert into auth.users (id, aud, role, email, raw_user_meta_data) values
      (a, 'authenticated', 'authenticated', ea, '{"display_name":"Verify A"}'),
      (b, 'authenticated', 'authenticated', eb, '{}');

    select count(*) into n from public.profiles where id in (a, b);
    if n <> 2 then raise exception 'expected 2 profiles, got %', n; end if;
    select display_name into v from public.profiles where id = a;
    if v is distinct from 'Verify A' then raise exception 'display_name was %', v; end if;
    select translation into v from public.profiles where id = a;
    if v is distinct from 'KJAV' then raise exception 'profile translation default was %', v; end if;

    res := res || jsonb_build_object('test', 'registration trigger creates profile (display name, KJAV default)', 'passed', true);
  exception when others then
    res := res || jsonb_build_object('test', 'registration trigger creates profile (display name, KJAV default)', 'passed', false, 'detail', sqlerrm);
  end;

  -- 2. Saved verse: save as A, default translation KJAV ----------------------
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    cur := current_user; uid := auth.uid();
    if cur <> 'authenticated' or uid is distinct from a then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    insert into public.saved_verses (user_id, book_id, book_name, chapter, verse, verse_text)
    values (a, 'JHN', 'John', 3, 16, 'verification text');
    select translation into v from public.saved_verses where user_id = a;
    if v is distinct from 'KJAV' then raise exception 'default translation was %', v; end if;

    reset role;
    res := res || jsonb_build_object('test', 'A can save a verse; default translation is KJAV', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'A can save a verse; default translation is KJAV', 'passed', false, 'detail', sqlerrm);
  end;

  -- 3. Duplicate save rejected by the unique key (app upserts on this key) ----
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    cur := current_user; uid := auth.uid();
    if cur <> 'authenticated' or uid is distinct from a then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    begin
      insert into public.saved_verses (user_id, translation, book_id, book_name, chapter, verse)
      values (a, 'KJAV', 'JHN', 'John', 3, 16);
      raise exception 'duplicate saved verse was accepted';
    exception when unique_violation then null;
    end;

    reset role;
    select count(*) into n from public.saved_verses where user_id = a and book_id = 'JHN' and chapter = 3 and verse = 16;
    if n <> 1 then raise exception 'expected exactly 1 John 3:16 row for A, found %', n; end if;
    res := res || jsonb_build_object('test', 'duplicate saved verse rejected by unique key', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'duplicate saved verse rejected by unique key', 'passed', false, 'detail', sqlerrm);
  end;

  -- 4. A cannot write rows owned by B (must be an RLS rejection) ----------------
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    cur := current_user; uid := auth.uid();
    if cur <> 'authenticated' or uid is distinct from a then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    begin
      insert into public.saved_verses (user_id, book_id, book_name, chapter, verse)
      values (b, 'GEN', 'Genesis', 1, 1);
      raise exception 'A inserted a saved verse owned by B';
    exception when insufficient_privilege then
      if sqlerrm not like '%row-level security%' then
        raise exception 'rejected, but not by RLS: %', sqlerrm;
      end if;
    end;
    begin
      insert into public.history (user_id, book_id, book_name, chapter, verse)
      values (b, 'GEN', 'Genesis', 1, 1);
      raise exception 'A inserted a history row owned by B';
    exception when insufficient_privilege then
      if sqlerrm not like '%row-level security%' then
        raise exception 'rejected, but not by RLS: %', sqlerrm;
      end if;
    end;

    reset role;
    select (select count(*) from public.saved_verses where user_id = b)
         + (select count(*) from public.history where user_id = b) into n;
    if n <> 0 then raise exception 'B owns % rows that A should not have been able to create', n; end if;
    res := res || jsonb_build_object('test', 'A cannot insert saved verse or history as B (RLS WITH CHECK)', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'A cannot insert saved verse or history as B (RLS WITH CHECK)', 'passed', false, 'detail', sqlerrm);
  end;

  -- 5. History: duplicates tolerated; the app's delete-then-insert leaves one row
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    cur := current_user; uid := auth.uid();
    if cur <> 'authenticated' or uid is distinct from a then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'history' and column_name = 'kind') then
      -- Before 20261020000000_history_chapter_entries: duplicates are tolerated.
      insert into public.history (user_id, book_id, book_name, chapter, verse) values (a, 'PSA', 'Psalms', 23, 1);
      insert into public.history (user_id, book_id, book_name, chapter, verse) values (a, 'PSA', 'Psalms', 23, 1);
      select count(*) into n from public.history where user_id = a;
      if n <> 2 then raise exception 'expected 2 duplicate history rows, got %', n; end if;
    else
      -- After it: a second row for the same verse is rejected by history_entry_key.
      insert into public.history (user_id, book_id, book_name, chapter, verse) values (a, 'PSA', 'Psalms', 23, 1);
      begin
        insert into public.history (user_id, book_id, book_name, chapter, verse) values (a, 'PSA', 'Psalms', 23, 1);
        raise exception 'a duplicate verse row was accepted';
      exception when unique_violation then
        null;
      end;
      -- the atomic write used by library.recordView once switched on
      insert into public.history (user_id, translation, book_id, book_name, chapter, verse, kind)
      values (a, 'KJAV', 'PSA', 'Psalms', 23, 1, 'verse')
      on conflict on constraint history_entry_key do update set viewed_at = excluded.viewed_at;
      select count(*) into n from public.history where user_id = a;
      if n <> 1 then raise exception 'upsert left % rows', n; end if;
    end if;

    -- same two steps as library.recordView before it is switched to the upsert
    delete from public.history
     where user_id = a and translation = 'KJAV' and book_id = 'PSA' and chapter = 23 and verse = 1;
    insert into public.history (user_id, translation, book_id, book_name, chapter, verse)
    values (a, 'KJAV', 'PSA', 'Psalms', 23, 1);
    select count(*) into n from public.history where user_id = a;
    if n <> 1 then raise exception 'delete-then-insert left % rows', n; end if;

    reset role;
    res := res || jsonb_build_object('test', 'history: one row per verse after delete-then-insert (and upsert, when applied)', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'history: one row per verse after delete-then-insert (and upsert, when applied)', 'passed', false, 'detail', sqlerrm);
  end;

  -- 6. A sees and updates only their own profile ---------------------------------
  begin
    -- positive control (as owner): B's profile exists and is untouched
    select count(*) into n from public.profiles where id = b and theme = 'system';
    if n <> 1 then raise exception 'precondition failed: B profile missing or not default'; end if;

    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    cur := current_user; uid := auth.uid();
    if cur <> 'authenticated' or uid is distinct from a then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    select count(*) into n from public.profiles;
    if n <> 1 then raise exception 'A can see % profiles (expected 1)', n; end if;
    update public.profiles set theme = 'dark' where id = a;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'A could not update own profile'; end if;
    update public.profiles set theme = 'dark' where id = b;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'A updated B''s profile'; end if;

    reset role;
    select count(*) into n from public.profiles where id = b and theme = 'system';
    if n <> 1 then raise exception 'B''s profile was changed'; end if;
    res := res || jsonb_build_object('test', 'profiles: A sees and updates only their own row', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'profiles: A sees and updates only their own row', 'passed', false, 'detail', sqlerrm);
  end;

  -- 7. B cannot see or delete A's data -----------------------------------------------
  begin
    -- positive control (as owner): A really has data to protect
    select count(*) into n from public.saved_verses where user_id = a;
    select count(*) into m from public.history where user_id = a;
    if n < 1 or m < 1 then
      raise exception 'precondition failed: A has % saved verses and % history rows', n, m;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    set local role authenticated;
    cur := current_user; uid := auth.uid();
    if cur <> 'authenticated' or uid is distinct from b then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    select count(*) into n from public.saved_verses;
    if n <> 0 then raise exception 'B can see % of A''s saved verses', n; end if;
    select count(*) into n from public.history;
    if n <> 0 then raise exception 'B can see % of A''s history rows', n; end if;
    delete from public.saved_verses where user_id is not null;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'B deleted % of A''s saved verses', n; end if;
    delete from public.history where user_id is not null;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'B deleted % of A''s history rows', n; end if;

    reset role;
    -- A's data must still be intact
    select count(*) into n from public.saved_verses where user_id = a;
    select count(*) into m from public.history where user_id = a;
    if n < 1 or m < 1 then raise exception 'A''s data changed: % saved verses, % history rows', n, m; end if;
    res := res || jsonb_build_object('test', 'B cannot read or delete A''s saved verses and history', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'B cannot read or delete A''s saved verses and history', 'passed', false, 'detail', sqlerrm);
  end;

  -- 8. Signed-out (anon) caller; denials must be permission errors ---------------------
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    cur := current_user; uid := auth.uid();
    if cur <> 'anon' or uid is not null then
      raise exception 'role/JWT simulation not in effect (user=%, uid=%)', cur, uid;
    end if;

    select count(*) into n from public.translations;
    if n <> 6 then raise exception 'anon sees % translations (expected 6)', n; end if;

    begin
      perform 1 from public.saved_verses limit 1;
      raise exception 'anon could query saved_verses';
    exception when insufficient_privilege then
      if sqlerrm not like 'permission denied for table saved_verses%' then
        raise exception 'unexpected error: %', sqlerrm;
      end if;
    end;
    begin
      perform 1 from public.history limit 1;
      raise exception 'anon could query history';
    exception when insufficient_privilege then
      if sqlerrm not like 'permission denied for table history%' then
        raise exception 'unexpected error: %', sqlerrm;
      end if;
    end;
    begin
      perform 1 from public.profiles limit 1;
      raise exception 'anon could query profiles';
    exception when insufficient_privilege then
      if sqlerrm not like 'permission denied for table profiles%' then
        raise exception 'unexpected error: %', sqlerrm;
      end if;
    end;
    begin
      insert into public.translations (code, name) values ('HACK', 'x');
      raise exception 'anon wrote to translations';
    exception when insufficient_privilege then
      if sqlerrm not like 'permission denied for table translations%' then
        raise exception 'unexpected error: %', sqlerrm;
      end if;
    end;

    reset role;
    select count(*) into n from public.translations where code = 'HACK';
    if n <> 0 then raise exception 'a HACK translation row exists'; end if;
    res := res || jsonb_build_object('test', 'anon: reads 6 translations only; no access to user tables', 'passed', true);
  exception when others then
    reset role;
    res := res || jsonb_build_object('test', 'anon: reads 6 translations only; no access to user tables', 'passed', false, 'detail', sqlerrm);
  end;

  -- 9. Clean-up: delete ONLY the two disposable accounts; their data must cascade away
  begin
    delete from auth.users where id = a and email = ea;
    delete from auth.users where id = b and email = eb;
    select (select count(*) from public.profiles where id in (a, b))
         + (select count(*) from public.saved_verses where user_id in (a, b))
         + (select count(*) from public.history where user_id in (a, b))
         + (select count(*) from auth.users where id in (a, b)) into n;
    if n <> 0 then raise exception 'cascade/clean-up left % rows behind', n; end if;
    res := res || jsonb_build_object('test', 'clean-up: accounts deleted; profile, saved verses, history cascaded; nothing left behind', 'passed', true);
  exception when others then
    res := res || jsonb_build_object('test', 'clean-up: accounts deleted; profile, saved verses, history cascaded; nothing left behind', 'passed', false, 'detail', sqlerrm);
  end;

  return query
    select t.ord, t.e ->> 'test', (t.e ->> 'passed')::boolean, t.e ->> 'detail'
    from jsonb_array_elements(res) with ordinality as t(e, ord)
    union all
    select 999::bigint, 'OVERALL: all tests pass',
           coalesce(bool_and((e ->> 'passed')::boolean), false) and count(*) = 9,
           null::text
    from jsonb_array_elements(res) as e
    order by 1;
end
$fn$;

select * from pg_temp.vs_behavior_checks();
