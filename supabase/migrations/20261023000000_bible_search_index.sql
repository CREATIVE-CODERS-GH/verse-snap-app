-- Bible full-text search index (free search, no AI).
--
-- ADDITIVE ONLY: creates new objects, alters and deletes nothing that exists. Contains NO Bible
-- text: the only rows it inserts are six source records (metadata and licence notices). Verses are
-- loaded later by a separate, reviewed import (Stage D2).
--
--   bible_sources  one row per edition: where it comes from, its licence notice and status, checksum.
--   bible_verses   one row per verse in the edition's OWN numbering; a stored tsvector for search.
--   bible_words    the Bible's vocabulary, used to repair typos and to recognise unknown words.
--   search_bible() phrase, all-words and some-words search with exact paging; typo repair.
--
-- Licence gate: a verse row can only exist for a source whose licence_status is 'approved'
-- (composite foreign key), so an unapproved edition cannot be imported, and an edition that already
-- has verses cannot be un-approved until its verses are removed.
--
-- Access: server only. RLS is on with NO policies, and every privilege is revoked from public,
-- anon and authenticated; only service_role (our server) can read, write or call the functions.
-- Search text is a function argument only: nothing here stores or logs it.
--
-- Verse mapping is deliberately NOT part of this migration (see docs/audit/BATCH_1D_D1.md):
-- results open the verse in the edition where it was found, in that edition's own numbering.

-- Edit distance (typo repair). Supabase keeps extensions in the "extensions" schema; refuse to
-- continue if fuzzystrmatch already lives somewhere else, because the functions below name that schema.
create schema if not exists extensions;
create extension if not exists fuzzystrmatch with schema extensions;
do $$
begin
  if (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
       where e.extname = 'fuzzystrmatch') <> 'extensions' then
    raise exception 'fuzzystrmatch is installed outside the "extensions" schema; adjust this migration first';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Sources and licensing
-- ---------------------------------------------------------------------------------------------
create table public.bible_sources (
  edition_code        text primary key check (edition_code ~ '^[A-Z0-9]{2,8}$'),
  helloao_id          text not null check (char_length(helloao_id) between 2 and 40),
  name                text not null check (char_length(name) between 2 and 120),
  language            text not null default 'English',
  source_url          text not null check (source_url ~ '^https://'),
  license_name        text not null,
  license_url         text not null check (license_url ~ '^https://'),
  license_notice      text not null check (char_length(license_notice) between 10 and 2000),
  license_status      text not null check (license_status in ('approved', 'pending', 'excluded')),
  license_checked_on  date not null,
  -- SHA-256 and size of the exact source file that was verified and imported (NULL until a file has
  -- been downloaded and checked). The import refuses to run unless this matches the file's hash.
  source_sha256       text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes        integer check (source_bytes > 0),
  -- The checksum HelloAO lists for the edition in available_translations.json. Informational only:
  -- it does not match the hash of complete.json (it appears to describe HelloAO's own inputs), so it
  -- cannot be used to verify the download.
  publisher_sha256    text check (publisher_sha256 ~ '^[0-9a-f]{64}$'),
  expected_verse_count integer not null check (expected_verse_count > 0),
  -- staging: loaded but not searchable; active: searchable; retired: searchable no more.
  status              text not null default 'staging' check (status in ('staging', 'active', 'retired')),
  imported_at         timestamptz,
  notes               text,
  -- Only an approved edition may ever be searchable.
  constraint bible_sources_active_needs_approval check (status <> 'active' or license_status = 'approved'),
  -- Only a source whose file has been verified can be searchable.
  constraint bible_sources_active_needs_checksum check (status <> 'active' or source_sha256 is not null),
  -- Target of the verse table's licence-gate foreign key.
  constraint bible_sources_code_license_key unique (edition_code, license_status)
);

-- ---------------------------------------------------------------------------------------------
-- Verses (native numbering of each edition; full-text vector stored)
-- ---------------------------------------------------------------------------------------------
create table public.bible_verses (
  edition_code   text not null,
  -- Always 'approved'. Together with the foreign key below it makes "import for an unapproved
  -- edition" impossible, however the rows are written.
  license_status text not null default 'approved' check (license_status = 'approved'),
  book           text not null check (book ~ '^[A-Z0-9]{3}$'),         -- USFM id, as in HelloAO files
  book_order     smallint not null check (book_order between 1 and 66),
  chapter        smallint not null check (chapter > 0),
  verse          smallint not null check (verse > 0),
  verse_text     text not null check (char_length(btrim(verse_text)) between 1 and 4000),
  tsv            tsvector generated always as (to_tsvector('english'::regconfig, verse_text)) stored,
  primary key (edition_code, book, chapter, verse),               -- no duplicates, native numbering kept
  constraint bible_verses_source_fkey foreign key (edition_code, license_status)
    references public.bible_sources (edition_code, license_status) on update restrict on delete restrict
);

create index bible_verses_tsv_idx on public.bible_verses using gin (tsv);

-- ---------------------------------------------------------------------------------------------
-- Vocabulary for typo repair (rebuilt by refresh_bible_words() after each import)
-- ---------------------------------------------------------------------------------------------
create table public.bible_words (
  word      text primary key check (word ~ '^[a-z]{2,40}$'),
  doc_freq  integer not null check (doc_freq > 0)
);

-- ---------------------------------------------------------------------------------------------
-- Security: RLS on, no policies, nothing for API roles.
-- ---------------------------------------------------------------------------------------------
alter table public.bible_sources enable row level security;
alter table public.bible_verses  enable row level security;
alter table public.bible_words   enable row level security;

revoke all on public.bible_sources, public.bible_verses, public.bible_words
  from public, anon, authenticated;
grant select, insert, update, delete on public.bible_sources, public.bible_verses, public.bible_words
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- Vocabulary refresh (one statement; safe to run while searches are running)
-- ---------------------------------------------------------------------------------------------
create or replace function public.refresh_bible_words()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with fresh as (
    select s.word::text as word, s.ndoc::integer as doc_freq
      from ts_stat(
        'select to_tsvector(''simple'', v.verse_text)
           from public.bible_verses v
           join public.bible_sources b on b.edition_code = v.edition_code
          where b.license_status = ''approved''') s
     where s.word ~ '^[a-z]{2,40}$'
  ),
  gone as (
    delete from public.bible_words w
     where not exists (select 1 from fresh f where f.word = w.word)
  )
  insert into public.bible_words (word, doc_freq)
  select f.word, f.doc_freq from fresh f
  on conflict (word) do update set doc_freq = excluded.doc_freq;

  select count(*)::integer into v_count from public.bible_words;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Search
--
--   p_query     2-200 characters; control characters and runs of spaces are normalised.
--   p_editions  edition codes to search; NULL = every active, approved edition. Anything else
--               (unknown, staging, retired, unapproved) is ignored, never searched.
--   p_limit     1-25 rows per page (clamped).   p_offset  0-1000; a larger offset returns no rows.
--   p_repair    false searches the words exactly as typed (no typo repair): the "search instead for
--               my original wording" choice. NULL counts as true.
--
-- Matching, strongest first:
--   tier 3  the query's words appear consecutively (a phrase);
--   tier 2  every word appears;
--   tier 1  some words appear -- used ONLY when no verse contains all of them; verses with more of
--           the words rank first, then by ts_rank_cd.
-- Words of 5+ letters that the Bible never uses are replaced (at most 3 per query) by, in order:
--   1. a vocabulary word one adjacent-letter swap away ("beleive" -> "believe"), the commonest first;
--   2. else the nearest vocabulary word within 1 edit (5 letters) or 2 (6+), nearest first,
--      then the commonest. (Weighing frequency against distance was tried and made results worse:
--      "tounge" became "young", "coffee" became "offer".)
-- The repaired text comes back in corrected_query (NULL when nothing changed).
--
-- Paging: total_count is the exact number of matching verses (not just this page), the order is
-- fully determined (tier, rank, Bible order, edition), so consecutive pages neither repeat nor skip
-- a verse. An offset at or past the end returns no rows (the caller knows the total from page one).
-- ---------------------------------------------------------------------------------------------
create or replace function public.search_bible(
  p_query    text,
  p_editions text[]  default null,
  p_limit    integer default 10,
  p_offset   integer default 0,
  p_repair   boolean default true
)
returns table (
  edition_code    text,
  book            text,
  book_order      smallint,
  chapter         smallint,
  verse           smallint,
  verse_text      text,
  tier            smallint,
  rank            real,
  total_count     integer,
  corrected_query text
)
language plpgsql
stable
security invoker
set search_path = ''
-- A database-side limit on one search. Tested through PostgREST: a function-level statement_timeout
-- cancels the statement (57014); a caller hanging up does NOT (docs/audit/BATCH_1D_D4.md).
set statement_timeout = '2s'
as $$
#variable_conflict use_column
declare
  v_q        text := regexp_replace(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g');
  v_limit    integer := least(greatest(coalesce(p_limit, 10), 1), 25);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_cq       text;
  v_editions text[];
  v_phrase   tsquery;
  v_all      tsquery;
  v_any      tsquery;
  v_lex      text[];
  v_match    tsquery;
  v_has_all  boolean;
  w          text;
  fix        text;
begin
  v_q := btrim(v_q);
  -- Deeper than 1,000 rows is not served (and is never clamped back onto an earlier page).
  if v_offset > 1000 then
    return;
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 200 then
    raise exception 'invalid query length' using errcode = '22023';
  end if;
  v_cq := v_q;

  select coalesce(array_agg(s.edition_code order by s.edition_code), '{}')
    into v_editions
    from public.bible_sources s
   where s.status = 'active' and s.license_status = 'approved'
     and (p_editions is null or s.edition_code = any (p_editions));
  if cardinality(v_editions) = 0 then
    return;
  end if;

  -- Typo repair: only words of 5+ letters that the Bible never uses, at most 3 per query (each costs about 70 ms).
  -- Skipped entirely when the caller asked for its original wording (p_repair = false).
  for w in select d.u
             from (select distinct lower(m[1]) as u from regexp_matches(v_q, '([A-Za-z]{5,})', 'g') as m) d
            where coalesce(p_repair, true)
              and not exists (select 1 from public.bible_words bw where bw.word = d.u)
            limit 3 loop
    if not exists (select 1 from public.bible_words bw where bw.word = w) then
      fix := null;
      -- 1. one adjacent-letter swap away
      select bw.word into fix
        from public.bible_words bw
       where bw.word in (select substr(w, 1, i - 1) || substr(w, i + 1, 1) || substr(w, i, 1) || substr(w, i + 2)
                           from generate_series(1, char_length(w) - 1) as i)
       order by bw.doc_freq desc, bw.word
       limit 1;
      -- 2. else the nearest word within a small edit distance
      if fix is null then
        select c.word into fix
          from (select bw.word, bw.doc_freq,
                       extensions.levenshtein_less_equal(bw.word, w, k.max_d) as d
                  from public.bible_words bw
                 cross join (select case when char_length(w) <= 5 then 1
                                         when char_length(w) <= 8 then 2 else 2 end as max_d) k
                 where abs(char_length(bw.word) - char_length(w)) <= k.max_d) c
         where c.d <= case when char_length(w) <= 5 then 1 when char_length(w) <= 8 then 2 else 2 end
         order by c.d, c.doc_freq desc, c.word
         limit 1;
      end if;
      if fix is not null then
        v_cq := regexp_replace(v_cq, '\m' || w || '\M', fix, 'gi');
      end if;
    end if;
  end loop;

  v_phrase := phraseto_tsquery('english', v_cq);
  v_all    := plainto_tsquery('english', v_cq);
  if numnode(v_all) = 0 then
    return;   -- nothing but stop words
  end if;
  v_any := replace(v_all::text, ' & ', ' | ')::tsquery;
  v_lex := string_to_array(replace(v_all::text, '''', ''), ' & ');

  select exists (select 1 from public.bible_verses v
                  where v.edition_code = any (v_editions) and v.tsv @@ v_all)
    into v_has_all;
  v_match := case when v_has_all then v_all else v_any end;

  return query
  with hits as (
    select v.edition_code, v.book, v.book_order, v.chapter, v.verse, v.verse_text,
           (case when numnode(v_phrase) > 1 and v.tsv @@ v_phrase then 3
                 when v_has_all then 2
                 else 1 end)::smallint as tier,
           ts_rank_cd(v.tsv, v_match, 1) as rank,
           -- Some-words fallback: how many of the query's words this verse has (a verse with two of
           -- three words beats one that repeats a single word).
           (case when v_has_all then 0
                 else (select count(*) from unnest(v_lex) as l(w) where l.w = any (tsvector_to_array(v.tsv)))
            end)::integer as matched
      from public.bible_verses v
     where v.edition_code = any (v_editions)
       and v.tsv @@ v_match
  )
  select h.edition_code, h.book, h.book_order, h.chapter, h.verse, h.verse_text, h.tier, h.rank,
         (count(*) over ())::integer,
         case when v_cq is distinct from v_q then v_cq end
    from hits h
   order by h.tier desc, h.matched desc, h.rank desc, h.book_order, h.chapter, h.verse, h.edition_code
   limit v_limit offset v_offset;
end;
$$;

revoke execute on function public.refresh_bible_words() from public, anon, authenticated;
revoke execute on function public.search_bible(text, text[], integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.refresh_bible_words() to service_role;
grant execute on function public.search_bible(text, text[], integer, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Source records: metadata and licence notices only (checked 2026-10-21 from each publisher's
-- own page; see docs/audit/BATCH_1D_D0.md). No Bible text. Nothing is searchable yet.
-- source_sha256 / source_bytes are the verified HelloAO complete.json files downloaded 2026-10-21
-- (docs/audit/BATCH_1D_D2.md); KJAV, BBE and FBV have no verified file because none was downloaded.
--   approved  WEB, BSB, ASV          pending   KJAV (UK Crown letters patent question)
--   excluded  BBE, FBV
-- ---------------------------------------------------------------------------------------------
insert into public.bible_sources
  (edition_code, helloao_id, name, source_url, license_name, license_url, license_notice,
   license_status, license_checked_on, source_sha256, source_bytes, publisher_sha256,
   expected_verse_count, notes)
values
  ('WEB', 'ENGWEBP', 'World English Bible',
   'https://bible.helloao.org/api/ENGWEBP/complete.json',
   'Public Domain', 'https://ebible.org/engwebp/copyright.htm',
   'The World English Bible is in the Public Domain. You may copy, publish, proclaim, distribute, redistribute, sell, give away. If you change the actual text, do not call the result the World English Bible (trademark of eBible.org).',
   'approved', date '2026-10-21',
   'afa177afbcf775b294bee9b13059090b548e4d996679cf53214bfaaea9e427fd', 6293463,
   '72b3e6d83b3cd1c0a0e02a8b2254244d7568ca6c3235f52f93c71764590b8042', 31103,
   'Keep the text unmodified in wording. Contains one verse with empty text (Romans 16:25); the import skips empty verses.'),
  ('BSB', 'BSB', 'Berean Standard Bible',
   'https://bible.helloao.org/api/BSB/complete.json',
   'Public Domain', 'https://berean.bible/terms.htm',
   'The Berean Bible and Majority Bible texts are officially dedicated to the public domain as of April 30, 2023. All uses are freely permitted. Attribution is appreciated but not required; for changed text we respectfully request the Berean name is not used.',
   'approved', date '2026-10-21',
   'd02b81e78441f5ae5dadec0688ad8596cde6793c28f52ab711d901a855698b6a', 8155925,
   '6cc5238e442b4204b0f617cc5c932bc04f3bae4a0658e6393b0e319653ebe37f', 31086,
   'Native numbering differs from KJV in places; the import runs a per-chapter check and keeps BSB numbering.'),
  ('ASV', 'eng_asv', 'American Standard Version (1901)',
   'https://bible.helloao.org/api/eng_asv/complete.json',
   'Public Domain', 'https://ebible.org/Scriptures/details.php?id=eng-asv',
   'Licence field: public domain. This public domain Bible translation is brought to you courtesy of eBible.org. No conditions beyond a donation request.',
   'approved', date '2026-10-21',
   '125acd86760f362fe5a8b47791057e546c26dcd0cde628f6017af146752cc69a', 6152058,
   '154967f9f68504bdf9a8d7abaae4ef6a93f20f779df84e62c1c8828427731839', 31102,
   'The details page is the only notice found (the copyright page returned 404).'),
  ('KJAV', 'eng_kjv', 'King James (Authorized) Version',
   'https://bible.helloao.org/api/eng_kjv/complete.json',
   'Public Domain (UK Crown letters patent applies to printing)', 'https://ebible.org/Scriptures/details.php?id=eng-kjv2006',
   'Licence field: public domain. To print this translation in the United Kingdom or import printed copies into the UK you need permission from the patentees (Cambridge University Press, Oxford University Press, Collins). This royal decree has no effect outside of the UK, where this work is firmly in the Public Domain.',
   'pending', date '2026-10-21',
   null, null,
   'a847712eeaae26124d3f9db80a1a9274742981261961b49715f43809774eb43c', 31102,
   'PENDING: whether the patent covers digital storage and search in the UK is unresolved. Approve with an UPDATE only after that decision.'),
  ('BBE', 'eng_bbe', 'Bible in Basic English',
   'https://bible.helloao.org/api/eng_bbe/complete.json',
   'Public Domain (United States only, as stated)', 'https://ebible.org/Scriptures/details.php?id=engBBE',
   'Licence field: public domain, on the basis that the work was published without a copyright notice in America and fell into the public domain in the United States.',
   'excluded', date '2026-10-21',
   null, null,
   '1e0aa1bf1410a062c63599f28e87d4022822ea078b3719da775b9996d2aa7bf9', 31102,
   'EXCLUDED from indexing: the notice rests on US status only. Still readable in the app.'),
  ('FBV', 'eng_fbv', 'Free Bible Version',
   'https://bible.helloao.org/api/eng_fbv/complete.json',
   'CC BY-SA 4.0', 'https://ebible.org/Scriptures/details.php?id=engfbv',
   'Made available under the Creative Commons Attribution Share-Alike license 4.0. Copyright 2018 Dr. Jonathan Gallagher. Include the copyright and source information, indicate any changes, and distribute contributions under the same license.',
   'excluded', date '2026-10-21',
   null, null,
   'b6a81b2c74849d20111277998cfbd87ef8b7e3b1fd8734a0905c2490e0bb5a6e', 31104,
   'EXCLUDED from indexing: share-alike terms need a decision. Still readable in the app.')
on conflict (edition_code) do nothing;
