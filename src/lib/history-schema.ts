/**
 * Whether the account's `history` table has chapter entries and the atomic entry key
 * (supabase/migrations/20261020000000_history_chapter_entries.sql).
 *
 * Applied to the independent project (shoztcflucpnfenohgcr) on 2026-10-20 and verified with
 * supabase/verification/01, 02 and 05. When true:
 *   - signed-in chapter visits are saved to the account (one row per chapter and translation);
 *   - signed-in verse views are one atomic upsert instead of delete-then-insert;
 *   - the guest-to-account merge also adds chapter visits.
 * Turning it on before the migration would make those writes fail (unknown column `kind`).
 * To roll back, set it to false and deploy BEFORE running the rollback SQL.
 */
export const ACCOUNT_HISTORY_V2 = true;

/** The table's unique entry key: the upsert conflict target once the migration is applied. */
export const HISTORY_ENTRY_KEY = "user_id,translation,book_id,chapter,verse";
