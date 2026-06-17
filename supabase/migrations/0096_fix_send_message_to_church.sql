-- =============================================================================
-- 0096_fix_send_message_to_church.sql
--
-- BUG: send_message_to_church (migration 0095) inserts a notification row for
--      each church admin when a member messages the church. But church admins
--      intentionally have no `profiles` row (migration 0090 prevents it), and
--      notifications.user_id references profiles(id). This causes a FK
--      constraint violation that crashes every message send.
--
-- FIX: Remove the notification insert. Church admins see incoming messages via
--      the dashboard Inbox page (church_inbox RPC + unread_church_messages_count
--      badge). They never use the app and have no notifications feed there.
--
-- Safe to re-run: OR REPLACE.
-- =============================================================================

create or replace function public.send_message_to_church(
  p_church_id  uuid,
  p_body       text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_mid  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if btrim(p_body) = '' then raise exception 'message body cannot be empty'; end if;

  insert into public.church_messages (church_id, from_profile_id, body)
  values (p_church_id, v_uid, btrim(p_body))
  returning id into v_mid;

  -- Church admins have no profiles row (migration 0090 intentionally prevents
  -- it to keep them out of the consumer app). notifications.user_id references
  -- profiles(id), so we cannot insert a notification for church admin users.
  -- Church admins see new messages via the dashboard Inbox page — the
  -- church_inbox RPC and unread_church_messages_count badge are the signal.

  return v_mid;
end;
$$;

grant execute on function public.send_message_to_church(uuid, text) to authenticated;
