-- ROLLBACK for supabase/migrations/20261023000100_free_search_rate_limit.sql
--
-- Kept outside supabase/migrations so the CLI never applies it by accident. Run only after
-- approval, and only after the server no longer calls consume_free_search_quota (switch free search
-- off first). Removes the counters (nothing else). The AI quota (ai_search_usage) is untouched.
-- If the migration was applied with the Supabase CLI:
--   supabase migration repair --status reverted 20261023000100

begin;
drop function if exists public.consume_free_search_quota(text, integer, integer, integer);
drop table if exists public.free_search_usage;
commit;
