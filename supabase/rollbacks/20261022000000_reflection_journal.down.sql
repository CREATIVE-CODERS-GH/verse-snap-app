-- ROLLBACK for supabase/migrations/20261022000000_reflection_journal.sql
--
-- Kept outside supabase/migrations so the CLI never applies it by accident. Run only after
-- approval, and only in this order:
--
--   1. Switch the app back first: set ACCOUNT_JOURNAL_ENABLED = false in
--      src/lib/journal-schema.ts and deploy (signed-in reflections then stop being read or written).
--   2. Export the journal first:  select * from public.notebooks;  select * from public.reflections;
--   3. Run this file. It removes both tables and the trigger function, and therefore EVERY
--      signed-in notebook and reflection; nothing else is touched.
--   4. If the migration was applied with the Supabase CLI:
--        supabase migration repair --status reverted 20261022000000

begin;
drop table if exists public.reflections;
drop table if exists public.notebooks;
drop function if exists public.notebooks_move_reflections();
commit;
