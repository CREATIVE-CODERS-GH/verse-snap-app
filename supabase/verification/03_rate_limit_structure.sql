-- Verse Snap: RATE-LIMIT STRUCTURE + PRIVILEGE CHECKS  (READ-ONLY)
--
-- For migration 6 (ai_search_usage + consume_ai_search_quota). Creates, changes and
-- deletes nothing. Run in the Supabase SQL editor AFTER migration 6 has been applied.
--
-- Returns ONE result table. Read the last row:
--   "OVERALL: all checks pass" = true  -> success.
-- Any row with pass = false names the broken rule.

with checks(sort, check_name, pass) as (

  select 10, 'table exists with RLS enabled',
         coalesce((select c.relrowsecurity
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'ai_search_usage'), false)

  union all
  select 11, 'table has exactly the 4 expected columns',
         coalesce((select array_agg(column_name::text order by column_name)
                   from information_schema.columns
                   where table_schema = 'public' and table_name = 'ai_search_usage')
                  = array['subject','used','window_kind','window_start'], false)

  union all
  select 12, 'primary key is (subject, window_kind, window_start)',
         coalesce((select array_agg(a.attname::text order by k.ord)
                   from pg_constraint c
                   cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                   where c.conrelid = 'public.ai_search_usage'::regclass and c.contype = 'p')
                  = array['subject','window_kind','window_start'], false)

  union all
  select 13, 'check constraints present (subject length, window_kind, used >= 0)',
         (select count(*) >= 3 from pg_constraint
          where conrelid = 'public.ai_search_usage'::regclass and contype = 'c')

  union all
  select 14, 'cleanup index on window_start exists',
         exists (select 1 from pg_indexes
                 where schemaname = 'public' and tablename = 'ai_search_usage'
                   and indexname = 'ai_search_usage_window_start_idx')

  union all
  select 20, 'no RLS policies on the table (API roles get nothing)',
         not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'ai_search_usage')

  union all
  select 21, p.r || ' has no privileges on the table',
         not (has_table_privilege(p.r, 'public.ai_search_usage', 'select')
              or has_table_privilege(p.r, 'public.ai_search_usage', 'insert')
              or has_table_privilege(p.r, 'public.ai_search_usage', 'update')
              or has_table_privilege(p.r, 'public.ai_search_usage', 'delete')
              or has_table_privilege(p.r, 'public.ai_search_usage', 'truncate'))
  from (values ('anon'), ('authenticated')) as p(r)

  union all
  select 22, 'service_role can read and write the table',
         has_table_privilege('service_role', 'public.ai_search_usage', 'select')
         and has_table_privilege('service_role', 'public.ai_search_usage', 'insert')
         and has_table_privilege('service_role', 'public.ai_search_usage', 'update')
         and has_table_privilege('service_role', 'public.ai_search_usage', 'delete')

  union all
  select 30, 'function exists with the expected signature',
         to_regprocedure('public.consume_ai_search_quota(text,integer,integer,integer,integer)') is not null

  union all
  select 31, 'function is SECURITY DEFINER',
         coalesce((select p.prosecdef from pg_proc p
                   where p.oid = to_regprocedure('public.consume_ai_search_quota(text,integer,integer,integer,integer)')), false)

  union all
  select 32, 'function search_path is empty',
         coalesce((select exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
                   from pg_proc p
                   where p.oid = to_regprocedure('public.consume_ai_search_quota(text,integer,integer,integer,integer)')), false)

  union all
  select 33, p.r || ' cannot execute the function',
         not has_function_privilege(p.r, 'public.consume_ai_search_quota(text,integer,integer,integer,integer)', 'execute')
  from (values ('anon'), ('authenticated')) as p(r)

  union all
  select 34, 'PUBLIC pseudo-role cannot execute the function',
         not exists (select 1
                     from pg_proc p
                     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = to_regprocedure('public.consume_ai_search_quota(text,integer,integer,integer,integer)')
                       and a.grantee = 0 and a.privilege_type = 'EXECUTE')

  union all
  select 35, 'service_role can execute the function',
         has_function_privilege('service_role', 'public.consume_ai_search_quota(text,integer,integer,integer,integer)', 'execute')

  union all
  select 36, 'the only roles with EXECUTE are the owner and service_role',
         coalesce((select array_agg(distinct r.rolname::text order by r.rolname::text)
                   from pg_proc p
                   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   join pg_roles r on r.oid = a.grantee
                   where p.oid = to_regprocedure('public.consume_ai_search_quota(text,integer,integer,integer,integer)')
                     and a.privilege_type = 'EXECUTE'
                     and r.oid <> p.proowner)
                  = array['service_role'], false)
)
select sort, check_name, pass from checks
union all
select 999, 'OVERALL: all checks pass', coalesce(bool_and(pass), false) from checks
order by sort, check_name;
