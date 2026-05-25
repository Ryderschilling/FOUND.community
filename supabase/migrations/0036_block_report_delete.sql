-- =============================================================================
-- 0036_block_report_delete.sql
-- App Store compliance pack. Three mandatory features for any app with
-- user-generated content:
--
--   * Block a user        — Apple Guideline 1.2
--   * Report a user/content — Apple Guideline 1.2
--   * Delete your account  — Apple Guideline 5.1.1(v)
--
-- Single-pass. No enum changes ('block' already exists in connection_kind).
-- Safe to run once on top of 0001..0035. Idempotent where possible.
--
-- Sections:
--   1.  block_user / unblock_user / list_blocked_users
--   2.  Defensive block filters in inbound_connections, my_connections,
--       messageable_contacts, my_threads_detailed
--   3.  reports table + RLS
--   4.  report_content() RPC
--   5.  delete_account() RPC
-- =============================================================================


-- =============================================================================
-- 1. BLOCK
--   A block is a connections row with kind='block'. block_user also wipes any
--   like/wave/skip rows in BOTH directions, so the blocked pair drops out of
--   every mutual-connection RPC for free. The explicit block row is what the
--   filters in section 2 (and top_matches from 0026) key off of.
--   SECURITY DEFINER: needs to delete the other user's rows too, which the
--   "connections write own" RLS policy would block.
-- =============================================================================
create or replace function public.block_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_target is null then raise exception 'no target'; end if;
  if p_target = v_me then raise exception 'cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'that profile does not exist';
  end if;

  -- Wipe every non-block connection between the two of us, both directions.
  delete from public.connections
   where kind <> 'block'
     and (
       (from_profile = v_me     and to_profile = p_target)
       or (from_profile = p_target and to_profile = v_me)
     );

  -- Record the block (idempotent).
  insert into public.connections (from_profile, to_profile, kind)
    values (v_me, p_target, 'block')
  on conflict (from_profile, to_profile, kind) do nothing;
end;
$$;

grant execute on function public.block_user(uuid) to authenticated;


create or replace function public.unblock_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.connections
   where from_profile = v_me
     and to_profile   = p_target
     and kind = 'block';
end;
$$;

grant execute on function public.unblock_user(uuid) to authenticated;


-- People I have blocked — backs the "Blocked Users" settings screen.
create or replace function public.list_blocked_users()
returns table (
  profile_id  uuid,
  full_name   text,
  handle      text,
  avatar_url  text,
  blocked_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id            as profile_id,
    p.full_name,
    p.handle::text  as handle,
    p.avatar_url,
    c.created_at    as blocked_at
  from public.connections c
  join public.profiles p on p.id = c.to_profile
  where c.from_profile = auth.uid()
    and c.kind = 'block'
  order by c.created_at desc;
$$;

grant execute on function public.list_blocked_users() to authenticated;


-- =============================================================================
-- 2. DEFENSIVE BLOCK FILTERS
--   block_user already deletes the like/wave rows the mutual-connection RPCs
--   rely on, so blocked pairs mostly drop out on their own. These filters are
--   belt-and-suspenders — and for my_threads_detailed they are REQUIRED:
--   blocking does not delete an existing direct thread, so without this filter
--   a blocked person would still show up in the Messages list.
--   None of these change signature/return type → plain CREATE OR REPLACE.
-- =============================================================================

-- ---- inbound_connections — drop senders I've blocked / who've blocked me ----
create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c.from_profile)
            or (b.from_profile = c.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.bio,
    p.avatar_url,
    ls.label                              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end        as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end       as state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;

grant execute on function public.inbound_connections() to authenticated;


-- ---- my_connections — drop anyone in a block relationship with me -----------
create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;


-- ---- messageable_contacts — drop anyone in a block relationship with me -----
create or replace function public.messageable_contacts()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  is_match          boolean,
  last_touch        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  related as (
    select c.to_profile as other, max(c.created_at) as last_touch
    from public.connections c
    where c.from_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.to_profile
    union
    select c.from_profile as other, max(c.created_at)
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.from_profile
  ),
  collapsed as (
    select other, max(last_touch) as last_touch
    from related
    group by other
  )
  select
    p.id              as profile_id,
    p.full_name,
    p.handle::text    as handle,
    p.avatar_url,
    ls.label          as life_stage_label,
    p.city,
    p.state,
    (
      exists (select 1 from public.connections cn
              where cn.from_profile = (select id from me)
                and cn.to_profile = p.id and cn.kind = 'like')
      and
      exists (select 1 from public.connections cn
              where cn.from_profile = p.id
                and cn.to_profile = (select id from me) and cn.kind = 'like')
    ) as is_match,
    c.last_touch
  from collapsed c
  join public.profiles p on p.id = c.other
  left join public.life_stages ls on ls.id = p.life_stage_id
  where not exists (
    select 1 from public.connections b
    where b.kind = 'block'
      and (
        (b.from_profile = (select id from me) and b.to_profile = p.id)
        or (b.from_profile = p.id and b.to_profile = (select id from me))
      )
  )
  order by is_match desc, c.last_touch desc;
$$;

grant execute on function public.messageable_contacts() to authenticated;


-- ---- my_threads_detailed — hide DIRECT threads with a blocked person -------
--   Group threads are not filtered here — leaving a group is the way out of a
--   group chat. Direct threads survive a block, so they MUST be filtered.
create or replace function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  group_id              uuid,
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
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id           as other_id,
           p.full_name    as other_name,
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
         t.group_id,
         case when t.kind = 'group' then null else op.other_id end      as other_profile_id,
         case when t.kind = 'group' then g.name else op.other_name end   as other_full_name,
         case when t.kind = 'group' then null else op.other_handle end   as other_handle,
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


-- =============================================================================
-- 3. REPORTS TABLE
--   One row per report. target_kind tells a reviewer what target_id points at.
--   target_id is intentionally NOT a foreign key — it is polymorphic and we
--   want the report to survive even if the offending content is deleted.
-- =============================================================================
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('profile','message','group','group_post')),
  target_id   uuid not null,
  reason      text not null check (reason in ('spam','harassment','inappropriate','safety','fake','other')),
  details     text,
  status      text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_reports_status  on public.reports (status, created_at desc);
create index if not exists idx_reports_target  on public.reports (target_kind, target_id);

alter table public.reports enable row level security;

-- A user can see the reports they filed; nobody else can read them.
-- Review happens via the Supabase dashboard / service role, which bypasses RLS.
drop policy if exists "reports: read own" on public.reports;
create policy "reports: read own"
  on public.reports for select
  using (reporter_id = auth.uid());

-- Inserts go through report_content() (SECURITY DEFINER), but allow a direct
-- self-insert too so the table is usable without the RPC.
drop policy if exists "reports: insert own" on public.reports;
create policy "reports: insert own"
  on public.reports for insert
  with check (reporter_id = auth.uid());


-- =============================================================================
-- 4. report_content — validated insert into reports.
-- =============================================================================
create or replace function public.report_content(
  p_target_kind text,
  p_target_id   uuid,
  p_reason      text,
  p_details     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_target_kind not in ('profile','message','group','group_post') then
    raise exception 'invalid target kind';
  end if;
  if p_target_id is null then raise exception 'no target'; end if;
  if p_reason not in ('spam','harassment','inappropriate','safety','fake','other') then
    raise exception 'invalid reason';
  end if;
  if p_target_kind = 'profile' and p_target_id = v_me then
    raise exception 'cannot report yourself';
  end if;

  insert into public.reports (reporter_id, target_kind, target_id, reason, details)
    values (v_me, p_target_kind, p_target_id, p_reason,
            nullif(btrim(coalesce(p_details, '')), ''))
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.report_content(text, uuid, text, text) to authenticated;


-- =============================================================================
-- 5. delete_account — Apple Guideline 5.1.1(v): in-app account deletion.
--   Removes everything the user owns, then deletes the auth.users row, which
--   cascades profiles -> profile_activities/goals/values, group_members,
--   messages, thread_participants, connections, group_posts, reports.
--
--   Hand-cleaned first (no FK cascade reaches them):
--     * photos rows for the user's profile (polymorphic table, no FK)
--     * groups the user OWNS — deleted outright (a group can't survive losing
--       its owner). Their photos rows are polymorphic too, so removed first.
--
--   Storage objects (avatars / profile-photos / group photo buckets) are NOT
--   touched here — the client purges its own storage before calling this,
--   mirroring delete_group(). Any miss is an orphaned file, not leaked data.
-- =============================================================================
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- Profile photo rows (polymorphic table, no FK to profiles).
  delete from public.photos
   where owner_kind = 'profile' and owner_id = v_me;

  -- Groups this user owns: purge their photo rows, then delete the groups.
  -- Deleting a group cascades its members, threads, messages, posts, activities.
  delete from public.photos
   where owner_kind = 'group'
     and owner_id in (
       select gm.group_id from public.group_members gm
       where gm.profile_id = v_me and gm.role = 'owner'
     );

  delete from public.groups
   where id in (
     select gm.group_id from public.group_members gm
     where gm.profile_id = v_me and gm.role = 'owner'
   );

  -- Remove the auth user. FK cascades from auth.users -> profiles take the rest.
  delete from auth.users where id = v_me;
end;
$$;

grant execute on function public.delete_account() to authenticated;


-- Force PostgREST to pick up the new functions immediately.
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE.
-- =============================================================================
