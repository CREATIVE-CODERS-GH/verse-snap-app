import { supabase } from "@/integrations/supabase/client";

/**
 * A change made by one person can run after they sign out or someone else signs in (writes can be
 * queued or slow). RLS already rejects a row for anyone but the signed-in owner; this also skips
 * the request entirely when the session no longer belongs to the person who made the change.
 */
export async function assertStillSignedInAs(userId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== userId) throw new Error("account changed");
}
