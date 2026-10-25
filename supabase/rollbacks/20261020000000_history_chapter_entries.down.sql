-- ROLLBACK for supabase/migrations/20261020000000_history_chapter_entries.sql
--
-- Kept outside supabase/migrations so the CLI never applies it by accident. Run only after
-- approval, and only in this order:
--
--   1. Switch the app back first: set ACCOUNT_HISTORY_V2 = false in src/lib/history-schema.ts and
--      deploy. (The new write path sends `kind` and upserts on history_entry_key; both stop working
--      once this file runs.)
--   2. Optional: export chapter entries before they are removed (step 3 below):
--        select * from public.history where kind = 'chapter';
--   3. Run this file.
--   4. If the migration was applied with the Supabase CLI, mark it reverted in the CLI's history:
--        supabase migration repair --status reverted 20261020000000
--
-- Data: verse entries are kept exactly. Chapter entries are DELETED, because the original table
-- requires a verse number and none may be invented. That is the only data this rollback removes.

begin;

set local lock_timeout = '5s';
lock table public.history in access exclusive mode;

delete from public.history where kind = 'chapter';

alter table public.history
  drop constraint if exists history_entry_key,
  drop constraint if exists history_kind_verse_check,
  drop column if exists kind,
  alter column verse set not null;

create index if not exists history_user_verse_idx
  on public.history (user_id, translation, book_id, chapter, verse);

commit;
