-- Verse Snap: persistent verse highlights for signed-in accounts.
--
-- NOT YET APPROVED FOR THE LIVE PROJECT. Apply only after explicit approval, and only to the
-- independent project (ref shoztcflucpnfenohgcr). Rollback: supabase/rollbacks/ (same name).
--
-- One row per user, translation and verse (highlights belong to the edition they were made in).
-- Changing the colour updates that row; clearing a highlight deletes it. The colours are the five
-- approved highlight tones (src/components/verse-annotation-parts.tsx; "clear" is not stored).
--
-- Security
--   - RLS: each person reads and writes only their own rows (auth.uid() = user_id), same rule and
--     form as saved_verses and history.
--   - Grants are explicit: signed-out (anon) gets nothing; signed-in gets only SELECT, INSERT,
--     UPDATE, DELETE (Supabase's default ALL, including TRUNCATE, is revoked for this table).
--
-- The unique key's index (user_id, translation, book_id, chapter, verse) also serves the reader's
-- per-chapter lookup, so no other index is needed. Nothing existing is changed.

begin;

create table public.highlights (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  translation text not null,
  book_id text not null,
  chapter integer not null check (chapter > 0),
  verse integer not null check (verse > 0),
  color text not null check (color in ('amber', 'sage', 'sky', 'rose', 'lilac')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint highlights_verse_key unique (user_id, translation, book_id, chapter, verse)
);

comment on table public.highlights is
  'Verse highlights for signed-in accounts: one per user, translation and verse.';
comment on constraint highlights_verse_key on public.highlights is
  'One highlight per user, translation and verse. Upsert target; also serves per-chapter reads.';

alter table public.highlights enable row level security;

create policy "Users can manage their own highlights" on public.highlights
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.highlights from public, anon, authenticated;
grant select, insert, update, delete on public.highlights to authenticated;
grant all on public.highlights to service_role;

commit;
