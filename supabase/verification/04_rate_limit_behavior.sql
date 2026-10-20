-- Verse Snap: RATE-LIMIT BEHAVIOUR CHECKS  (leaves NOTHING behind)
--
-- DEV PROJECT ONLY (ref shoztcflucpnfenohgcr). Run after 03_rate_limit_structure.sql passes.
--
-- How it stays clean: every test runs inside ONE database sub-transaction that is always
-- rolled back at the end, and only the results travel out. So no usage rows, and no change
-- to the real shared 'global' counters, survive the run. Nothing is deleted by pattern; no
-- auth users are created or touched; no email, no API call.
--
-- Test subjects are fixed, obviously fake values:
--   user:aaaaaaaa-0000-4000-8000-0000000000f1 / f2 / f3
--   ip:00000000000000f4
-- Global-cap tests use limits RELATIVE to the current real global counts, so they work on a
-- database that already holds real usage.
--
-- It ends NORMALLY with a result table. Read the last row:
--   "OVERALL: all tests pass" = true -> success. A row with passed = false names the test and
--   the database error text in "detail".
--
-- Not covered here (a single SQL session cannot test it): true simultaneous requests. The
-- guarantee comes from Postgres row locking on INSERT ... ON CONFLICT DO UPDATE ... WHERE; the
-- application tests exercise the calling code.
--
-- Two statements: create a throw-away function in pg_temp, then call it. Run the whole file.

create or replace function pg_temp.vs_rate_limit_checks()
returns table (step bigint, test text, passed boolean, detail text)
language plpgsql
as $fn$
declare
  s1 constant text := 'user:aaaaaaaa-0000-4000-8000-0000000000f1';
  s2 constant text := 'user:aaaaaaaa-0000-4000-8000-0000000000f2';
  s3 constant text := 'user:aaaaaaaa-0000-4000-8000-0000000000f3';
  s4 constant text := 'ip:00000000000000f4';
  res     jsonb := '[]'::jsonb;
  r       record;
  n       int;
  m       int;
  g_day   int;
  g_month int;
  v_day   timestamptz := date_trunc('day',   now() at time zone 'utc') at time zone 'utc';
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_detail text;
  bad     text;
begin
  -- Avoid a minute-window rollover in the middle of the run.
  if extract(second from clock_timestamp()) > 50 then
    perform pg_sleep(11);
  end if;
  v_day   := date_trunc('day',   now() at time zone 'utc') at time zone 'utc';
  v_month := date_trunc('month', now() at time zone 'utc') at time zone 'utc';

  begin  -- everything below is rolled back by the deliberate exception at the end

    select coalesce(max(used), 0) into g_day
      from public.ai_search_usage where subject = 'global' and window_kind = 'day' and window_start = v_day;
    select coalesce(max(used), 0) into g_month
      from public.ai_search_usage where subject = 'global' and window_kind = 'month' and window_start = v_month;

    -- 1. Per-minute limit: allows exactly the limit, then denies with a sane retry time ----
    begin
      for i in 1..3 loop
        select * into r from public.consume_ai_search_quota(s1, 3, 100, g_day + 1000, g_month + 1000);
        if not r.allowed then raise exception 'call % was denied (%)', i, r.reason; end if;
      end loop;
      select * into r from public.consume_ai_search_quota(s1, 3, 100, g_day + 1000, g_month + 1000);
      if r.allowed then raise exception '4th call was allowed'; end if;
      if r.reason is distinct from 'minute' then raise exception 'reason was %', r.reason; end if;
      if r.retry_after_seconds < 1 or r.retry_after_seconds > 60 then
        raise exception 'retry_after_seconds was %', r.retry_after_seconds;
      end if;
      res := res || jsonb_build_object('test', 'per-minute limit: 3 allowed, 4th denied with reason "minute" and retry 1-60s', 'passed', true);
    exception when others then
      res := res || jsonb_build_object('test', 'per-minute limit: 3 allowed, 4th denied with reason "minute" and retry 1-60s', 'passed', false, 'detail', sqlerrm);
    end;

    -- 2. A denied request consumes nothing anywhere ----------------------------------------
    begin
      select used into n from public.ai_search_usage where subject = s1 and window_kind = 'minute';
      select used into m from public.ai_search_usage where subject = s1 and window_kind = 'day';
      if n is distinct from 3 then raise exception 'minute counter is % (expected 3)', n; end if;
      if m is distinct from 3 then raise exception 'day counter is % (expected 3; denied call must not count)', m; end if;
      select used into n from public.ai_search_usage
        where subject = 'global' and window_kind = 'day' and window_start = v_day;
      if n is distinct from g_day + 3 then raise exception 'global day counter is % (expected %)', n, g_day + 3; end if;
      res := res || jsonb_build_object('test', 'denied request consumes nothing (subject and global counters exact)', 'passed', true);
    exception when others then
      res := res || jsonb_build_object('test', 'denied request consumes nothing (subject and global counters exact)', 'passed', false, 'detail', sqlerrm);
    end;

    -- 3. Per-day limit, and the rolled-back minute counter ----------------------------------
    begin
      perform * from public.consume_ai_search_quota(s2, 100, 2, g_day + 1000, g_month + 1000);
      perform * from public.consume_ai_search_quota(s2, 100, 2, g_day + 1000, g_month + 1000);
      select * into r from public.consume_ai_search_quota(s2, 100, 2, g_day + 1000, g_month + 1000);
      if r.allowed then raise exception '3rd call was allowed'; end if;
      if r.reason is distinct from 'day' then raise exception 'reason was %', r.reason; end if;
      if r.retry_after_seconds < 1 or r.retry_after_seconds > 86400 then
        raise exception 'retry_after_seconds was %', r.retry_after_seconds;
      end if;
      select used into n from public.ai_search_usage where subject = s2 and window_kind = 'minute';
      if n is distinct from 2 then raise exception 'minute counter is % (expected 2)', n; end if;
      res := res || jsonb_build_object('test', 'per-day limit: 2 allowed, 3rd denied with reason "day"; minute counter not inflated', 'passed', true);
    exception when others then
      res := res || jsonb_build_object('test', 'per-day limit: 2 allowed, 3rd denied with reason "day"; minute counter not inflated', 'passed', false, 'detail', sqlerrm);
    end;

    -- 4. Global daily cap blocks everyone, and refunds the subject's own counters -----------
    begin
      select used into n from public.ai_search_usage
        where subject = 'global' and window_kind = 'day' and window_start = v_day;  -- current, incl. tests above
      select * into r from public.consume_ai_search_quota(s3, 100, 100, n + 1, g_month + 1000);
      if not r.allowed then raise exception 'first call under the cap was denied (%)', r.reason; end if;
      select * into r from public.consume_ai_search_quota(s3, 100, 100, n + 1, g_month + 1000);
      if r.allowed then raise exception 'call over the global daily cap was allowed'; end if;
      if r.reason is distinct from 'global_day' then raise exception 'reason was %', r.reason; end if;
      select used into m from public.ai_search_usage where subject = s3 and window_kind = 'day';
      if m is distinct from 1 then raise exception 'subject day counter is % (expected 1: refused request refunded)', m; end if;
      res := res || jsonb_build_object('test', 'global daily cap: blocks, reason "global_day", subject counters not consumed', 'passed', true);
    exception when others then
      res := res || jsonb_build_object('test', 'global daily cap: blocks, reason "global_day", subject counters not consumed', 'passed', false, 'detail', sqlerrm);
    end;

    -- 5. Global monthly cap ---------------------------------------------------------------------
    begin
      select used into n from public.ai_search_usage
        where subject = 'global' and window_kind = 'month' and window_start = v_month;
      select * into r from public.consume_ai_search_quota(s4, 100, 100, g_day + 1000, n);
      if r.allowed then raise exception 'call over the global monthly cap was allowed'; end if;
      if r.reason is distinct from 'global_month' then raise exception 'reason was %', r.reason; end if;
      if r.retry_after_seconds < 1 then raise exception 'retry_after_seconds was %', r.retry_after_seconds; end if;
      select count(*) into m from public.ai_search_usage where subject = s4;
      if m <> 0 then raise exception 'subject rows were left behind (%)', m; end if;
      res := res || jsonb_build_object('test', 'global monthly cap: blocks with reason "global_month"; nothing left for the subject', 'passed', true);
    exception when others then
      res := res || jsonb_build_object('test', 'global monthly cap: blocks with reason "global_month"; nothing left for the subject', 'passed', false, 'detail', sqlerrm);
    end;

    -- 6. Invalid subjects and limits are rejected (and never reach the counters) ---------------
    begin
      foreach bad in array array['global', 'user:not-a-uuid', 'ip:zz', 'ip:abc', '', 'USER:aaaaaaaa-0000-4000-8000-0000000000f1', 'user:aaaaaaaa-0000-4000-8000-0000000000f1 '] loop
        begin
          perform * from public.consume_ai_search_quota(bad, 3, 3, 3, 3);
          raise exception 'subject "%" was accepted', bad;
        exception when raise_exception then
          if sqlerrm not like 'invalid subject%' then raise exception 'subject "%": unexpected error %', bad, sqlerrm; end if;
        end;
      end loop;
      begin
        perform * from public.consume_ai_search_quota(null, 3, 3, 3, 3);
        raise exception 'null subject was accepted';
      exception when raise_exception then
        if sqlerrm not like 'invalid subject%' then raise exception 'null subject: unexpected error %', sqlerrm; end if;
      end;
      begin
        perform * from public.consume_ai_search_quota(s1, 0, 3, 3, 3);
        raise exception 'zero minute limit was accepted';
      exception when raise_exception then
        if sqlerrm not like 'limits must be positive%' then raise exception 'zero limit: unexpected error %', sqlerrm; end if;
      end;
      res := res || jsonb_build_object('test', 'invalid subjects (incl. "global", case, whitespace, null) and non-positive limits are rejected', 'passed', true);
    exception when others then
      res := res || jsonb_build_object('test', 'invalid subjects (incl. "global", case, whitespace, null) and non-positive limits are rejected', 'passed', false, 'detail', sqlerrm);
    end;

    -- 7. Privileges, exactly as the API roles experience them ------------------------------------
    begin
      set local role anon;
      begin
        perform * from public.consume_ai_search_quota(s1, 3, 3, 3, 3);
        raise exception 'anon could call the function';
      exception when insufficient_privilege then
        if sqlerrm not like 'permission denied for function%' then raise exception 'anon: unexpected error %', sqlerrm; end if;
      end;
      begin
        perform 1 from public.ai_search_usage limit 1;
        raise exception 'anon could read the table';
      exception when insufficient_privilege then
        if sqlerrm not like 'permission denied for table%' then raise exception 'anon: unexpected error %', sqlerrm; end if;
      end;
      reset role;

      set local role authenticated;
      begin
        perform * from public.consume_ai_search_quota(s1, 3, 3, 3, 3);
        raise exception 'authenticated could call the function';
      exception when insufficient_privilege then
        if sqlerrm not like 'permission denied for function%' then raise exception 'authenticated: unexpected error %', sqlerrm; end if;
      end;
      begin
        perform 1 from public.ai_search_usage limit 1;
        raise exception 'authenticated could read the table';
      exception when insufficient_privilege then
        if sqlerrm not like 'permission denied for table%' then raise exception 'authenticated: unexpected error %', sqlerrm; end if;
      end;
      begin
        insert into public.ai_search_usage values ('ip:00000000000000f4', 'day', v_day, 1);
        raise exception 'authenticated could write the table';
      exception when insufficient_privilege then null;
      end;
      reset role;

      set local role service_role;
      select * into r from public.consume_ai_search_quota(s4, 100, 100, g_day + 1000, g_month + 1000);
      if not r.allowed then raise exception 'service_role call was denied (%)', r.reason; end if;
      reset role;

      res := res || jsonb_build_object('test', 'anon and authenticated cannot call the function or touch the table; service_role can call it', 'passed', true);
    exception when others then
      reset role;
      res := res || jsonb_build_object('test', 'anon and authenticated cannot call the function or touch the table; service_role can call it', 'passed', false, 'detail', sqlerrm);
    end;

    -- Always roll back everything above; carry the results out in the exception detail.
    raise exception using message = 'VS_ROLLBACK', detail = res::text;
  exception when raise_exception then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm is distinct from 'VS_ROLLBACK' then
      raise;
    end if;
    res := v_detail::jsonb;
  end;

  return query
    select t.ord, t.e ->> 'test', (t.e ->> 'passed')::boolean, t.e ->> 'detail'
    from jsonb_array_elements(res) with ordinality as t(e, ord)
    union all
    select 999::bigint, 'OVERALL: all tests pass',
           coalesce(bool_and((e ->> 'passed')::boolean), false) and count(*) = 7,
           null::text
    from jsonb_array_elements(res) as e
    order by 1;
end
$fn$;

select * from pg_temp.vs_rate_limit_checks();
