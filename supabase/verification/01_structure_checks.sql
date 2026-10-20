-- Verse Snap: STRUCTURE + RLS CHECKS  (READ-ONLY)
--
-- Creates, changes and deletes nothing. Safe to run any time on the dev project.
-- Run in the Supabase SQL editor after the migrations are applied.
--
-- Returns ONE result table (the SQL editor only shows the last result set, so
-- everything is a single query). Read the last row:
--   "OVERALL: all checks pass" = true  -> success
-- Any row with pass = false names the broken rule.
--
-- Data-creating tests live in 02_behavior_checks.sql, kept separate on purpose.

with checks(sort, check_name, pass) as (

  -- 1. Tables exist and have RLS enabled
  select 10, 'table exists + RLS enabled: ' || t,
         coalesce((select c.relrowsecurity
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = t), false)
  from unnest(array['profiles','translations','saved_verses','history']) t

  union all
  -- 2. Translation defaults are KJAV
  select 20, 'default is KJAV: ' || t,
         coalesce((select column_default like '%KJAV%'
                   from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'translation'), false)
  from unnest(array['profiles','saved_verses','history']) t

  union all
  -- 3. Seeded translations are exactly the six supported editions, in order
  select 30, 'translations seed = KJAV,BSB,WEB,ASV,BBE,FBV',
         coalesce((select array_agg(code order by sort_order) from public.translations)
                  = array['KJAV','BSB','WEB','ASV','BBE','FBV'], false)

  union all
  -- 4. Policies: own-row, authenticated-only, using (select auth.uid())
  select 40, 'policy ok: ' || tablename || ' / ' || policyname,
         (tablename = 'translations'
          or (roles = '{authenticated}' and cmd = 'ALL'
              and qual ilike '%select auth.uid()%' and with_check ilike '%select auth.uid()%'))
  from pg_policies where schemaname = 'public'

  union all
  select 41, 'exactly 4 policies in public',
         (select count(*) = 4 from pg_policies where schemaname = 'public')

  union all
  -- 5. Trigger and hardened function
  select 50, 'trigger on_auth_user_created exists',
         exists (select 1 from pg_trigger t where t.tgname = 'on_auth_user_created' and not t.tgisinternal)

  union all
  select 51, 'handle_new_user is SECURITY DEFINER with empty search_path',
         exists (select 1
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'handle_new_user' and p.prosecdef
                   and exists (select 1 from unnest(p.proconfig) c
                               where c in ('search_path=""', 'search_path=')))

  union all
  select 52, 'handle_new_user not executable by anon or authenticated',
         not has_function_privilege('anon', 'public.handle_new_user()', 'execute')
         and not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')

  union all
  -- 6. Table privileges
  select 60, 'anon has no access to ' || t,
         not has_table_privilege('anon', 'public.' || t, 'select')
         and not has_table_privilege('anon', 'public.' || t, 'insert')
  from unnest(array['profiles','saved_verses','history']) t

  union all
  select 61, 'anon can read translations but not write',
         has_table_privilege('anon', 'public.translations', 'select')
         and not has_table_privilege('anon', 'public.translations', 'insert')
         and not has_table_privilege('anon', 'public.translations', 'update')
         and not has_table_privilege('anon', 'public.translations', 'delete')

  union all
  select 62, 'authenticated has CRUD on ' || t,
         has_table_privilege('authenticated', 'public.' || t, 'select')
         and has_table_privilege('authenticated', 'public.' || t, 'insert')
         and has_table_privilege('authenticated', 'public.' || t, 'update')
         and has_table_privilege('authenticated', 'public.' || t, 'delete')
  from unnest(array['profiles','saved_verses','history']) t

  union all
  select 63, 'authenticated cannot write translations',
         not has_table_privilege('authenticated', 'public.translations', 'insert')
         and not has_table_privilege('authenticated', 'public.translations', 'update')
         and not has_table_privilege('authenticated', 'public.translations', 'delete')

  union all
  -- 7. Constraints and indexes the app relies on
  select 70, 'saved_verses has its unique key',
         exists (select 1 from pg_constraint where conrelid = 'public.saved_verses'::regclass and contype = 'u')

  union all
  select 71, 'history has NO unique constraint (by design)',
         not exists (select 1 from pg_constraint where conrelid = 'public.history'::regclass and contype = 'u')

  union all
  select 72, 'index present: ' || i,
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
  from unnest(array['saved_verses_user_created_idx','history_user_viewed_idx','history_user_verse_idx']) i

  union all
  -- 8. Defaults on the old Lovable data path are gone: no KJV seed row
  select 80, 'no legacy KJV row in translations',
         not exists (select 1 from public.translations where code = 'KJV')
)
select sort, check_name, pass from checks
union all
select 999, 'OVERALL: all checks pass', coalesce(bool_and(pass), false) from checks
order by sort, check_name;
