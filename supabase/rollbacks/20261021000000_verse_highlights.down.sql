-- ROLLBACK for supabase/migrations/20261021000000_verse_highlights.sql
--
-- Kept outside supabase/migrations so the CLI never applies it by accident. Run only after
-- approval, and only in this order:
--
--   1. Switch the app back first: set ACCOUNT_HIGHLIGHTS_ENABLED = false in
--      src/lib/highlights-schema.ts and deploy (signed-in highlights then stop being read or written).
--   2. Optional: export the highlights first:  select * from public.highlights;
--   3. Run this file. It removes the table and therefore EVERY signed-in highlight; nothing else
--      is touched.
--   4. If the migration was applied with the Supabase CLI:
--        supabase migration repair --status reverted 20261021000000

begin;
drop table if exists public.highlights;
commit;
