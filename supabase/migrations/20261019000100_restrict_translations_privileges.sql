-- Verse Snap: make public.translations read-only for the API roles.
--
-- Supabase's default privileges gave `authenticated` write access to new tables in
-- public, and the earlier migrations only revoked it from `anon`. Row Level
-- Security already blocked writes (the table has no write policy), so this closes
-- the gap at the privilege layer as well (defence in depth).
--
-- RLS policies are not touched. service_role keeps ALL (it bypasses RLS and is
-- used only server-side).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.translations FROM authenticated, anon;

-- Restate the intended read access so the end state is explicit and correct on its own.
GRANT SELECT ON public.translations TO anon, authenticated;
