-- =============================================================================
-- 0015_unread_messages_count.sql
-- Tab-badge counter for the Messages tab.
--
-- Returns the total number of messages across all my threads where:
--   - I'm a participant
--   - I am NOT the sender
--   - either I've never read the thread (last_read_at IS NULL)
--     or the message arrived after my last_read_at
--
-- Polled from the FloatingTabBar every ~45s; cheap thanks to the
-- (thread_id, created_at) index on messages.
-- =============================================================================

create or replace function public.unread_messages_count()
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.messages m
  join public.thread_participants tp
    on tp.thread_id  = m.thread_id
   and tp.profile_id = auth.uid()
  where m.sender_id <> auth.uid()
    and (tp.last_read_at is null or m.created_at > tp.last_read_at);
$$;

grant execute on function public.unread_messages_count() to authenticated;
