-- Verse Snap: BIBLE SEARCH PRE-FLIGHT  (READ-ONLY)
--
-- Run on the DEV project (ref shoztcflucpnfenohgcr) BEFORE applying
-- 20261023000000_bible_search_index and 20261023000100_free_search_rate_limit.
-- Creates, changes and deletes nothing. Returns ONE result table; read the last row:
--   "OVERALL: ready to apply" = true  -> nothing found that would stop the migrations.
-- Any row with pass = false names the problem. Rows 40+ are privacy settings.

with checks(sort, check_name, pass) as (

  select 10, 'PostgreSQL 15 or newer',
         current_setting('server_version_num')::int >= 150000

  union all
  select 11, 'fuzzystrmatch is available on this server',
         exists (select 1 from pg_available_extensions where name = 'fuzzystrmatch')

  union all
  select 12, 'fuzzystrmatch is not installed in a schema other than "extensions"',
         not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                      where e.extname = 'fuzzystrmatch' and n.nspname <> 'extensions')

  union all
  select 13, 'the extensions schema exists, or can be created (the migration creates it if missing)',
         true

  union all
  select 14, 'the API roles exist: anon, authenticated, service_role',
         (select count(*) = 3 from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))

  union all
  select 20, 'none of the new tables exists yet',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public'
                        and c.relname in ('bible_sources', 'bible_verses', 'bible_words', 'free_search_usage'))

  union all
  select 21, 'none of the new functions exists yet',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and p.proname in ('search_bible', 'refresh_bible_words', 'consume_free_search_quota'))

  union all
  select 22, 'the earlier AI rate limit (migration 6) is in place, so the two limiters stay separate',
         to_regclass('public.ai_search_usage') is not null

  union all
  select 30, 'database size leaves room for about 60 MB (under 400 MB used; the plan limit is not visible from SQL)',
         pg_database_size(current_database()) < 400 * 1024 * 1024

  -- Privacy: how the project logs statements (search text is a bound parameter).
  union all
  select 40, 'log_statement is not "all" or "mod" (statements, with their parameters, would be logged)',
         current_setting('log_statement') in ('none', 'ddl')

  union all
  select 41, 'log_min_duration_statement is off (-1): slow searches are not written to the log with parameters',
         current_setting('log_min_duration_statement') = '-1'

  union all
  select 42, 'log_parameter_max_length_on_error is 0: a failing search does not log its bound parameters',
         coalesce(current_setting('log_parameter_max_length_on_error', true), '0') = '0'
)
select sort, check_name, pass from checks
union all
select 999, 'OVERALL: ready to apply', coalesce(bool_and(pass), false) from checks
order by sort, check_name;
