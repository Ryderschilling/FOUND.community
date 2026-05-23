-- =============================================================================
-- 0032_fix_thread_touch_trigger.sql
--
-- The touch_thread_last_message trigger function was defined without
-- SECURITY DEFINER, so its UPDATE on public.threads was blocked by RLS
-- (no UPDATE policy exists). This caused last_message_at to stay null on
-- every thread, breaking the Messages feed sort order and any filter that
-- relied on that column.
--
-- Fix: recreate the function as SECURITY DEFINER so it runs with the
-- privileges of the definer (postgres) and bypasses RLS on threads.
--
-- Also backfill last_message_at for any existing threads that have messages
-- but a null last_message_at.
-- =============================================================================

create or replace function public.touch_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.threads
  set last_message_at = new.created_at
  where id = new.thread_id;
  return new;
end $$;

-- Backfill existing threads whose last_message_at is still null
-- but have at least one message in the messages table.
update public.threads t
set last_message_at = (
  select max(m.created_at)
  from public.messages m
  where m.thread_id = t.id
)
where t.last_message_at is null
  and exists (
    select 1 from public.messages m where m.thread_id = t.id
  );
