-- =============================================================================
-- 0053_mark_thread_notifs_read.sql
--
-- Adds an RPC so ChatScreen can clear the direct_message notification rows
-- for a given thread when the user reads it. Previously, markRead() only
-- updated thread_participants.last_read_at (clearing the Messages tab badge)
-- but left notifications.read_at = null, keeping the bell badge on Discover
-- lit up even after the message was viewed.
-- =============================================================================

create or replace function public.mark_thread_notifications_read(p_thread_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id   = auth.uid()
    and read_at   is null
    and entity_id = p_thread_id
    and entity_type = 'thread';
$$;

grant execute on function public.mark_thread_notifications_read(uuid) to authenticated;
