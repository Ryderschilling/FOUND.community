-- =============================================================================
-- 0092_fix_notifications_data_column.sql
--
-- BUG: Migration 0091_church_powerhouse.sql created a trigger
--      (on_profile_church_set) that inserts into notifications with a `data`
--      jsonb column, but that column was never added to the notifications table.
--
-- EFFECT: Any time an app user selects a church (set_profile_church RPC), the
--         trigger fires and the entire transaction fails with:
--         ERROR: column "data" of relation "notifications" does not exist
--         This completely breaks the church membership flow.
--
-- FIX: Add the missing `data jsonb` column to the notifications table.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.
-- =============================================================================

alter table public.notifications
  add column if not exists data jsonb;

-- =============================================================================
-- VERIFY:
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'notifications' and column_name = 'data';
--   → should return 1 row
-- =============================================================================
