-- =============================================================================
-- 0005: Thread RPCs
--   start_direct_thread(p_other)  — find-or-create a 1:1 direct thread
--   my_threads_detailed()         — enriched inbox feed for MessagesScreen
-- =============================================================================

-- ---------- start_direct_thread ---------------------------------------------
-- Idempotent: returns the existing direct thread if one already exists between
-- the caller and the target; otherwise creates a new thread + 2 participants.
-- security definer so we can insert into thread_participants for both users
-- in one transaction (the RLS "tp insert self" policy would only allow the
-- caller to insert their own row).
create or replace function public.start_direct_thread(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if v_me = p_other then
    raise exception 'cannot start a thread with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'target profile not found';
  end if;

  -- Existing direct thread that has BOTH of us as the only participants
  select t.id into v_thread
  from public.threads t
  where t.kind = 'direct'
    and exists (select 1 from public.thread_participants tp
                where tp.thread_id = t.id and tp.profile_id = v_me)
    and exists (select 1 from public.thread_participants tp
                where tp.thread_id = t.id and tp.profile_id = p_other)
    and (select count(*) from public.thread_participants tp
         where tp.thread_id = t.id) = 2
  limit 1;

  if v_thread is not null then
    return v_thread;
  end if;

  insert into public.threads (kind) values ('direct') returning id into v_thread;
  insert into public.thread_participants (thread_id, profile_id) values (v_thread, v_me);
  insert into public.thread_participants (thread_id, profile_id) values (v_thread, p_other);
  return v_thread;
end;
$$;

grant execute on function public.start_direct_thread(uuid) to authenticated;


-- ---------- my_threads_detailed ---------------------------------------------
-- Inbox feed. One row per thread the caller participates in, with:
--   other party's profile (1:1 case only — group threads return null other)
--   last message body + sender + timestamp
--   caller's last_read_at + unread count
create or replace function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  last_message_at       timestamptz,
  last_message_body     text,
  last_message_sender   uuid,
  last_read_at          timestamptz,
  unread_count          int
)
language sql
stable
set search_path = public
as $$
  with my_threads as (
    select tp.thread_id, tp.last_read_at
    from public.thread_participants tp
    where tp.profile_id = auth.uid()
  ),
  other_party as (
    -- For direct threads pick the single other participant. For group threads
    -- this returns one arbitrary other member (we'll improve when groups ship).
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id          as other_id,
           p.full_name   as other_name,
           p.handle::text as other_handle
    from public.thread_participants tp
    join public.profiles p on p.id = tp.profile_id
    where tp.thread_id in (select thread_id from my_threads)
      and tp.profile_id <> auth.uid()
    order by tp.thread_id, tp.joined_at asc
  ),
  last_msg as (
    select distinct on (m.thread_id)
           m.thread_id, m.body, m.sender_id, m.created_at
    from public.messages m
    where m.thread_id in (select thread_id from my_threads)
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::int as cnt
    from public.messages m
    join my_threads mt on mt.thread_id = m.thread_id
    where m.sender_id <> auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
    group by m.thread_id
  )
  select t.id              as thread_id,
         t.kind,
         op.other_id        as other_profile_id,
         op.other_name      as other_full_name,
         op.other_handle    as other_handle,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op on op.thread_id = t.id
  left join last_msg     lm on lm.thread_id = t.id
  left join unread       u  on u.thread_id  = t.id
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;
