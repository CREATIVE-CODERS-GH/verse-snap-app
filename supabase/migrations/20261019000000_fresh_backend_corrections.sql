-- Verse Snap: corrective migration for the independent Supabase backend.
--
-- Applies on top of the three original migrations (which are left untouched).
-- Written for a FRESH database: it performs no data backfill. If it is ever run
-- against a database that already holds 'KJV' rows, update those rows separately
-- after checking the saved_verses unique key for collisions.
--
-- 1. KJV -> KJAV default mismatch
-- 2. Seed the exact translations supported by src/lib/bible/translations.ts
-- 3. Harden the profile-creation trigger function
-- 4. Optimise RLS policies (evaluate auth.uid() once per statement)
--
-- Deliberately NOT included: a unique constraint on public.history.
-- library.recordView deletes then inserts (two statements, not atomic), so two
-- concurrent views of one verse could make a unique constraint reject an insert
-- and surface an error in the app. A non-unique lookup index is added instead.

-- 1. Defaults -----------------------------------------------------------------
ALTER TABLE public.profiles     ALTER COLUMN translation SET DEFAULT 'KJAV';
ALTER TABLE public.saved_verses ALTER COLUMN translation SET DEFAULT 'KJAV';
ALTER TABLE public.history      ALTER COLUMN translation SET DEFAULT 'KJAV';

-- 2. Translations -------------------------------------------------------------
-- Mirrors BIBLE_TRANSLATIONS (code, name, language). Order matches that list.
DELETE FROM public.translations WHERE code = 'KJV';

INSERT INTO public.translations (code, name, language, sort_order) VALUES
  ('KJAV', 'King James (Authorized) Version',  'English', 1),
  ('BSB',  'Berean Standard Bible',            'English', 2),
  ('WEB',  'World English Bible',              'English', 3),
  ('ASV',  'American Standard Version (1901)', 'English', 4),
  ('BBE',  'Bible in Basic English',           'English', 5),
  ('FBV',  'Free Bible Version',               'English', 6)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      language = EXCLUDED.language,
      sort_order = EXCLUDED.sort_order;

-- 3. Profile trigger function --------------------------------------------------
-- Empty search_path plus fully qualified names: a SECURITY DEFINER function must
-- not resolve objects through a caller-controlled path.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE keeps existing privileges, but restate them so this file is
-- correct on its own.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 4. RLS policies --------------------------------------------------------------
-- Same rules as before; (select auth.uid()) lets Postgres evaluate the function
-- once per statement instead of once per row.
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.profiles;
CREATE POLICY "Users can manage their own profile" ON public.profiles
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can manage their own saved verses" ON public.saved_verses;
CREATE POLICY "Users can manage their own saved verses" ON public.saved_verses
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage their own history" ON public.history;
CREATE POLICY "Users can manage their own history" ON public.history
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- The "Anyone can read translations" policy (USING true) needs no change.

-- 5. History lookup index (non-unique) -----------------------------------------
-- Supports the per-verse delete in library.recordView.
CREATE INDEX IF NOT EXISTS history_user_verse_idx
  ON public.history (user_id, translation, book_id, chapter, verse);
