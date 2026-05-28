-- 0051: Add other_avatar_url to my_threads_detailed
-- Threads list needs the other person's photo for the chat header.

create or replace function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  group_id              uuid,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  other_avatar_url      text,
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
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id             as other_id,
           p.full_name      as other_name,
           p.handle::text   as other_handle,
           p.avatar_url     as other_avatar_url
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
  select t.id                                                             as thread_id,
         t.kind,
         t.group_id,
         case when t.kind = 'group' then null else op.other_id end        as other_profile_id,
         case when t.kind = 'group' then g.name else op.other_name end    as other_full_name,
         case when t.kind = 'group' then null else op.other_handle end    as other_handle,
         case when t.kind = 'group' then null else op.other_avatar_url end as other_avatar_url,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread       u   on u.thread_id  = t.id
  left join public.groups g  on g.id = t.group_id
  where t.kind = 'group'
     or op.other_id is null
     or not exists (
       select 1 from public.connections b
       where b.kind = 'block'
         and (
           (b.from_profile = auth.uid() and b.to_profile = op.other_id)
           or (b.from_profile = op.other_id and b.to_profile = auth.uid())
         )
     )
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;
