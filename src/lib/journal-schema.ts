/**
 * Whether the account `notebooks` and `reflections` tables exist
 * (supabase/migrations/20261022000000_reflection_journal.sql).
 *
 * Keep false until that migration is approved, applied to the independent project and verified
 * (supabase/verification/07). Until then guests' reflections and notebooks are kept on their
 * device, and a signed-in person's journal stays a preview (never stored on the device, because
 * account data isn't kept locally). When true, signed-in reflections and notebooks are saved to the
 * account and the guest-to-account merge offers the device's journal.
 * To roll back, set it to false and deploy BEFORE running the rollback SQL.
 */
export const ACCOUNT_JOURNAL_ENABLED = true;
