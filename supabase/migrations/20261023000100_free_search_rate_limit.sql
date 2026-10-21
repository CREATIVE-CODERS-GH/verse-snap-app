-- Rate limiting for FREE Bible search (separate from AI search).
--   * Own table and function: the AI quota (ai_search_usage) is not read or changed.
--   * Counters only: no search text, no raw IP addresses, no user agents.
--   * Subjects are 'user:<uuid>' (verified Supabase user) or 'ip:<hex>' (keyed hash of the client
--     IP, computed by the server with a secret salt); 'global' is the internal shared ceiling.
--   * One call atomically checks the per-subject minute and day windows, then the global minute
--     ceiling. If ANY window is full nothing is counted (the whole attempt is rolled back).
--   * Only service_role (our server) can call the function; API roles cannot read or write.
-- There is no monthly cap: free search costs no money, the ceiling only protects the database.

create table public.free_search_usage (
  subject      text        not null check (char_length(subject) between 1 and 128),
  window_kind  text        not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  used         integer     not null default 0 check (used >= 0),
  primary key (subject, window_kind, window_start)
);

create index free_search_usage_window_start_idx on public.free_search_usage (window_start);

alter table public.free_search_usage enable row level security;
-- Deliberately no policies: with RLS on and no policy, anon/authenticated see and change nothing.

revoke all on public.free_search_usage from public, anon, authenticated;
grant select, insert, update, delete on public.free_search_usage to service_role;

create or replace function public.consume_free_search_quota(
  p_subject                text,
  p_minute_limit           integer,
  p_day_limit              integer,
  p_global_minute_limit    integer
)
returns table (allowed boolean, reason text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '1s'
as $$
declare
  v_now    timestamptz := now();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day    timestamptz := date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  v_used   integer;
begin
  if p_subject is null
     or p_subject !~ '^(user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ip:[0-9a-f]{16,64})$'
  then
    raise exception 'invalid subject';
  end if;
  if least(p_minute_limit, p_day_limit, p_global_minute_limit) < 1 then
    raise exception 'limits must be positive';
  end if;

  -- Housekeeping: occasionally drop old windows (about 1% of calls).
  if random() < 0.01 then
    delete from public.free_search_usage where window_start < v_now - interval '3 days';
  end if;

  begin
    v_used := null;
    insert into public.free_search_usage as t (subject, window_kind, window_start, used)
    values (p_subject, 'minute', v_minute, 1)
    on conflict (subject, window_kind, window_start)
    do update set used = t.used + 1 where t.used < p_minute_limit
    returning t.used into v_used;
    if v_used is null then raise exception using message = 'minute'; end if;

    v_used := null;
    insert into public.free_search_usage as t (subject, window_kind, window_start, used)
    values (p_subject, 'day', v_day, 1)
    on conflict (subject, window_kind, window_start)
    do update set used = t.used + 1 where t.used < p_day_limit
    returning t.used into v_used;
    if v_used is null then raise exception using message = 'day'; end if;

    v_used := null;
    insert into public.free_search_usage as t (subject, window_kind, window_start, used)
    values ('global', 'minute', v_minute, 1)
    on conflict (subject, window_kind, window_start)
    do update set used = t.used + 1 where t.used < p_global_minute_limit
    returning t.used into v_used;
    if v_used is null then raise exception using message = 'global_minute'; end if;

    return query select true, null::text, 0;
  exception when raise_exception then
    if sqlerrm not in ('minute', 'day', 'global_minute') then
      raise;  -- unexpected error: surface it (the server fails closed)
    end if;
    return query select
      false,
      sqlerrm,
      case sqlerrm
        when 'day' then greatest(1, ceil(extract(epoch from ((v_day + interval '1 day') - v_now)))::integer)
        else greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - v_now)))::integer)
      end;
  end;
end;
$$;

revoke execute on function public.consume_free_search_quota(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_free_search_quota(text, integer, integer, integer)
  to service_role;
