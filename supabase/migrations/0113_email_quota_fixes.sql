-- =============================================================================
-- 0113_email_quota_fixes.sql
-- Fixes Resend daily quota bleed from two sources:
--
--   1. trg_welcome_email (0029) was firing on every profile insert, doubling
--      the welcome email already sent by the send-email edge function on auth
--      signup. Dropped here.
--
--   2. notify_team_on_sam_reply was firing on EVERY message a user sent to the
--      Sam bot — not just the first. Heavy testers could generate dozens of
--      alert emails per session. Fixed in 0112 function body (first-reply only).
--
--   3. Add bot_reply_alerted_at column to profiles for future use if needed.
--
-- Applied to prod manually 2026-07-07 via SQL editor.
-- =============================================================================

-- Drop duplicate welcome email trigger (edge function handles this already)
drop trigger if exists trg_welcome_email on public.profiles;

-- Track first bot reply alert per user (informational — dedup logic lives in
-- the trigger function via message count check, not this column)
alter table public.profiles
  add column if not exists bot_reply_alerted_at timestamptz;
