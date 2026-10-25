-- Verse Snap: BIBLE SEARCH STRUCTURE + SECURITY CHECKS  (READ-ONLY)
--
-- For 20261023000000_bible_search_index and 20261023000100_free_search_rate_limit. Creates, changes
-- and deletes nothing. DEV PROJECT ONLY (ref shoztcflucpnfenohgcr), after both migrations are
-- applied. Returns ONE result table; read the last row:
--   "OVERALL: all checks pass" = true  -> success.
-- Any row with pass = false names the broken rule.
-- It is valid both before the import (no verses) and after it; the licence rules hold either way.

with checks(sort, check_name, pass) as (

  select 10, 'fuzzystrmatch is installed in the extensions schema',
         exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                  where e.extname = 'fuzzystrmatch' and n.nspname = 'extensions')

  -- RLS, policies and privileges on every new table --------------------------------------------
  union all
  select 20, t.name || ': RLS is enabled',
         coalesce((select c.relrowsecurity from pg_class c
                    where c.oid = to_regclass('public.' || t.name)), false)
  from (values ('bible_sources'), ('bible_verses'), ('bible_words'), ('free_search_usage')) as t(name)

  union all
  select 21, 'no RLS policies on any new table (API roles get nothing)',
         not exists (select 1 from pg_policies where schemaname = 'public'
                      and tablename in ('bible_sources', 'bible_verses', 'bible_words', 'free_search_usage'))

  union all
  select 22, p.r || ' has no privilege on ' || t.name,
         not (has_table_privilege(p.r, 'public.' || t.name, 'select')
              or has_table_privilege(p.r, 'public.' || t.name, 'insert')
              or has_table_privilege(p.r, 'public.' || t.name, 'update')
              or has_table_privilege(p.r, 'public.' || t.name, 'delete')
              or has_table_privilege(p.r, 'public.' || t.name, 'truncate'))
  from (values ('anon'), ('authenticated')) as p(r)
  cross join (values ('bible_sources'), ('bible_verses'), ('bible_words'), ('free_search_usage')) as t(name)

  union all
  select 23, 'service_role can read and write ' || t.name,
         has_table_privilege('service_role', 'public.' || t.name, 'select')
         and has_table_privilege('service_role', 'public.' || t.name, 'insert')
         and has_table_privilege('service_role', 'public.' || t.name, 'update')
         and has_table_privilege('service_role', 'public.' || t.name, 'delete')
  from (values ('bible_sources'), ('bible_verses'), ('bible_words'), ('free_search_usage')) as t(name)

  -- Functions: service_role only; invoker/definer and search_path as designed ----------------
  union all
  select 30, f.sig || ': only the owner and service_role can execute it',
         coalesce((select array_agg(distinct r.rolname::text order by r.rolname::text)
                     from pg_proc p
                     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     join pg_roles r on r.oid = a.grantee
                    where p.oid = to_regprocedure(f.sig) and a.privilege_type = 'EXECUTE'
                      and r.oid <> p.proowner) = array['service_role'], false)
         and not exists (select 1 from pg_proc p
                           cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                          where p.oid = to_regprocedure(f.sig) and a.grantee = 0
                            and a.privilege_type = 'EXECUTE')
  from (values ('public.search_bible(text,text[],integer,integer,boolean)'),
               ('public.refresh_bible_words()'),
               ('public.consume_free_search_quota(text,integer,integer,integer)')) as f(sig)

  union all
  select 31, f.sig || ': search_path is pinned to empty',
         coalesce((select 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = to_regprocedure(f.sig)), false)
  from (values ('public.search_bible(text,text[],integer,integer,boolean)'),
               ('public.refresh_bible_words()'),
               ('public.consume_free_search_quota(text,integer,integer,integer)')) as f(sig)

  union all
  select 32, 'search_bible and refresh_bible_words run as the caller (security invoker)',
         not exists (select 1 from pg_proc p
                      where p.oid in (to_regprocedure('public.search_bible(text,text[],integer,integer,boolean)'),
                                      to_regprocedure('public.refresh_bible_words()'))
                        and p.prosecdef)

  -- Indexes and constraints -----------------------------------------------------------------
  union all
  select 40, 'bible_verses has the GIN full-text index',
         exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'bible_verses'
                  and indexdef ilike '%using gin (tsv)%')

  union all
  select 42, 'bible_verses primary key is the native verse key (edition, book, chapter, verse)',
         coalesce((select array_agg(a.attname::text order by k.ord)
                     from pg_constraint c
                     cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                    where c.conrelid = 'public.bible_verses'::regclass and c.contype = 'p')
                  = array['edition_code', 'book', 'chapter', 'verse'], false)

  union all
  select 43, 'bible_verses is tied to approved sources by foreign key',
         exists (select 1 from pg_constraint
                  where conrelid = 'public.bible_verses'::regclass and contype = 'f'
                    and pg_get_constraintdef(oid) like '%(edition_code, license_status)%bible_sources%')

  union all
  select 44, 'an active source must be approved (check constraint)',
         exists (select 1 from pg_constraint
                  where conrelid = 'public.bible_sources'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) like '%active%approved%')

  -- Source records: licence gate as agreed ---------------------------------------------------
  union all
  select 50, 'WEB, BSB and ASV are approved',
         (select count(*) = 3 from public.bible_sources
           where edition_code in ('WEB', 'BSB', 'ASV') and license_status = 'approved')

  union all
  select 51, 'KJAV is still pending',
         exists (select 1 from public.bible_sources where edition_code = 'KJAV' and license_status = 'pending')

  union all
  select 52, 'BBE and FBV are excluded',
         (select count(*) = 2 from public.bible_sources
           where edition_code in ('BBE', 'FBV') and license_status = 'excluded')

  union all
  select 53, 'every source records identifier, URLs, notice, status and the listed checksum; approved sources pin a verified file hash',
         not exists (select 1 from public.bible_sources
                      where helloao_id is null or source_url is null or license_url is null
                         or license_notice is null or publisher_sha256 is null
                         or (license_status = 'approved' and source_sha256 is null))

  union all
  select 54, 'only approved editions are active, and only approved editions have verses',
         not exists (select 1 from public.bible_sources where status = 'active' and license_status <> 'approved')
         and not exists (select 1 from public.bible_verses v
                           join public.bible_sources s on s.edition_code = v.edition_code
                          where s.license_status <> 'approved')

  union all
  select 55, 'no verses exist for BBE, FBV or KJAV',
         not exists (select 1 from public.bible_verses where edition_code in ('BBE', 'FBV', 'KJAV'))

  -- Privacy: statements and their parameters (the search text) must not reach the logs.
  union all
  select 60, 'log_statement is not "all" or "mod"',
         current_setting('log_statement') in ('none', 'ddl')

  union all
  select 61, 'log_min_duration_statement is off (-1)',
         current_setting('log_min_duration_statement') = '-1'

  union all
  select 62, 'log_parameter_max_length_on_error is 0',
         coalesce(current_setting('log_parameter_max_length_on_error', true), '0') = '0'
)
select sort, check_name, pass from checks
union all
select 999, 'OVERALL: all checks pass', coalesce(bool_and(pass), false) from checks
order by sort, check_name;
