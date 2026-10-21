-- ROLLBACK for supabase/migrations/20261023000000_bible_search_index.sql
--
-- Kept outside supabase/migrations so the CLI never applies it by accident. Run only after
-- approval, and only in this order:
--
--   0. Cheapest first, no rollback needed: set FREE_SEARCH_ENABLED=false (or update the source
--      rows to status = 'retired'). Search then shows "being prepared" and references still work.
--   1. To remove ONE edition only:  delete from public.bible_verses where edition_code = 'WEB';
--      then  select public.refresh_bible_words();
--   2. Run this file to remove the whole feature. It drops the functions and the three tables
--      (every indexed verse, the vocabulary and the source records). Nothing else is touched:
--      no user data, no reading translations, no other migration's objects.
--   3. The fuzzystrmatch extension is NOT dropped (another feature may use it). Drop it by hand only if
--      nothing else does:  drop extension fuzzystrmatch;
--   4. If the migration was applied with the Supabase CLI:
--        supabase migration repair --status reverted 20261023000000
--
-- Drop 20261023000100_free_search_rate_limit.down.sql separately; the two are independent.

begin;
drop function if exists public.search_bible(text, text[], integer, integer, boolean);
drop function if exists public.refresh_bible_words();
drop table if exists public.bible_words;
drop table if exists public.bible_verses;
drop table if exists public.bible_sources;
commit;
