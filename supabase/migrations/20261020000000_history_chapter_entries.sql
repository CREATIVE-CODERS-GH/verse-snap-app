-- Verse Snap: chapter entries in History, and atomic History writes.
--
-- NOT YET APPROVED FOR THE LIVE PROJECT. Apply only after explicit approval, and only to the
-- independent project (ref shoztcflucpnfenohgcr). Rollback: supabase/rollbacks/ (same name).
--
-- What it changes in public.history
--   1. kind text NOT NULL DEFAULT 'verse'        every existing row becomes a verse entry, unchanged
--   2. verse becomes nullable                    a chapter entry has no verse (none is invented)
--   3. CHECK history_kind_verse_check            verse entry <=> verse present; chapter <=> verse null
--   4. UNIQUE NULLS NOT DISTINCT history_entry_key (user_id, translation, book_id, chapter, verse)
--        one row per verse and one row per chapter, per user and translation. NULLS NOT DISTINCT
--        (PostgreSQL 15+; the project runs 17) makes the null verse of chapter rows count as equal,
--        so a chapter can't be stored twice. Being a plain (non-partial) unique key, it is a valid
--        ON CONFLICT target for supabase-js upsert(), which makes both chapter and verse History
--        writes a single atomic statement and safe under concurrent requests.
--   5. history_user_verse_idx is dropped         the unique key's index has the same columns in
--        the same order, so it serves the same lookups.
--
-- Unchanged: the RLS policy ("Users can manage their own history", auth.uid() = user_id on every
-- command), grants, the viewed_at index, and the foreign key to auth.users.
--
-- Compatibility with the app version before this migration: it inserts without `kind` (the default
-- makes those verse rows), deletes and reads verse rows by verse number (chapter rows never match),
-- and only the new app version writes chapter rows. The new app keeps using the old write path
-- until it is switched on (src/lib/history-schema.ts), so the order is: apply this, verify, then
-- switch the app on.
--
-- Fails safe: if any user already has two rows for the same verse (possible in theory with the old
-- delete-then-insert write), the migration stops before changing anything and names the problem.
-- Nothing is deleted or merged automatically.

begin;

-- Don't queue behind a long-running statement and stall app traffic; retry later instead.
set local lock_timeout = '5s';

-- Taken first so no row can be written between the duplicate check and the new unique key.
lock table public.history in access exclusive mode;

do $$
declare
  duplicates bigint;
begin
  select count(*) into duplicates
    from (
      select 1
        from public.history
       group by user_id, translation, book_id, chapter, verse
      having count(*) > 1
    ) as repeated;
  if duplicates > 0 then
    raise exception
      'history_chapter_entries: % verse key(s) have more than one history row. Nothing was changed. Resolve them (keep the newest viewed_at per key) and run this migration again.',
      duplicates;
  end if;
end;
$$;

alter table public.history
  add column kind text not null default 'verse',
  alter column verse drop not null,
  add constraint history_kind_verse_check
    check ((kind = 'verse' and verse is not null) or (kind = 'chapter' and verse is null)),
  add constraint history_entry_key
    unique nulls not distinct (user_id, translation, book_id, chapter, verse);

drop index if exists public.history_user_verse_idx;

comment on column public.history.kind is
  'verse: a single verse was opened (verse is set). chapter: a chapter was read (verse is null).';
comment on constraint history_entry_key on public.history is
  'One row per user, translation and verse, and one per chapter (null verse). Upsert target.';

commit;
