/**
 * Whether the account `highlights` table exists
 * (supabase/migrations/20261021000000_verse_highlights.sql).
 *
 * Applied to the independent project (shoztcflucpnfenohgcr) on 2026-10-21 and verified with
 * supabase/verification/01, 02, 05 and 06. When true, signed-in highlights are saved to the
 * account and the guest-to-account merge offers the device's highlights. When false, guests'
 * highlights are still kept on their device, and a signed-in person's highlights are a preview for
 * the visit (never stored on the device, because account data isn't kept locally).
 * To roll back, set it to false and deploy BEFORE running the rollback SQL.
 */
export const ACCOUNT_HIGHLIGHTS_ENABLED = true;
