-- =============================================================================
-- FOUND App — Migration Fix
-- Fixes two root failures from the initial migration bundle run:
--   1. Missing `events` + `event_invites` tables (no migration ever created them)
--   2. `my_group_invites()` referenced `g.cover_path` which doesn't exist
--      (cover_path is derived from the photos table, not a column on groups)
--
-- Then re-runs all the functions that failed as a cascade of those two issues.
-- Safe to re-run — all DDL is idempotent.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Create events + event_invites tables (were never in any migration)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.events (
  id             uuid        primary key default gen_random_uuid(),
  creator_id     uuid        not null references public.profiles(id) on delete cascade,
  title          text        not null,
  event_time     timestamptz not null,
  location_name  text,
  location_lat   double precision,
  location_lng   double precision,
  description    text,
  group_id       uuid        references public.groups(id) on delete cascade,
  recurrence     text        check (recurrence in ('weekly','biweekly','monthly','monthly_nth')),
  recurrence_rule jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_events_creator   on public.events (creator_id);
create index if not exists idx_events_group     on public.events (group_id);
create index if not exists idx_events_time      on public.events (event_time);

alter table public.events enable row level security;

drop policy if exists "events: select participant" on public.events;
create policy "events: select participant" on public.events
  for select using (
    creator_id = auth.uid()
    or exists (
      select 1 from public.event_invites ei
      where ei.event_id = id and ei.invitee_id = auth.uid()
    )
    or (
      group_id is not null and exists (
        select 1 from public.group_members gm
        where gm.group_id = public.events.group_id and gm.profile_id = auth.uid()
      )
    )
  );

create table if not exists public.event_invites (
  event_id    uuid not null references public.events(id)   on delete cascade,
  invitee_id  uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending','accepted','declined')),
  created_at  timestamptz not null default now(),
  primary key (event_id, invitee_id)
);

create index if not exists idx_event_invites_invitee on public.event_invites (invitee_id);

alter table public.event_invites enable row level security;

drop policy if exists "event_invites: select own" on public.event_invites;
create policy "event_invites: select own" on public.event_invites
  for select using (invitee_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: Re-run 0048 with cover_path fixed
-- The original used `g.cover_path` (column doesn't exist); replaced with
-- a subquery on photos identical to how every later migration handles it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.group_invites (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id)   on delete cascade,
  inviter_id    uuid not null references public.profiles(id) on delete cascade,
  invitee_id    uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined','revoked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (group_id, invitee_id)
);

create index if not exists idx_group_invites_invitee_pending
  on public.group_invites (invitee_id) where status = 'pending';

create index if not exists idx_group_invites_group
  on public.group_invites (group_id);

alter table public.group_invites enable row level security;

drop policy if exists "group_invites: select own" on public.group_invites;
create policy "group_invites: select own"
  on public.group_invites for select
  using (invitee_id = auth.uid() or inviter_id = auth.uid());

create or replace function public.invite_to_group(
  p_group     uuid,
  p_invitees  uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_is_member  boolean;
  v_group_name text;
  v_actor_name text;
  v_invitee    uuid;
  v_count      int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_invitees is null or array_length(p_invitees, 1) is null then
    return 0;
  end if;

  select exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_uid
  ) into v_is_member;
  if not v_is_member then
    raise exception 'not a group member';
  end if;

  select name into v_group_name from public.groups where id = p_group;
  if v_group_name is null then
    raise exception 'group not found';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;

  foreach v_invitee in array p_invitees loop
    if v_invitee = v_uid then continue; end if;
    if exists (
      select 1 from public.group_members
      where group_id = p_group and profile_id = v_invitee
    ) then continue; end if;

    insert into public.group_invites (group_id, inviter_id, invitee_id, status)
    values (p_group, v_uid, v_invitee, 'pending')
    on conflict (group_id, invitee_id)
      do update set status = 'pending', responded_at = null, inviter_id = excluded.inviter_id;

    insert into public.notifications
      (user_id, type, actor_id, entity_type, entity_id, title, body)
    values
      (v_invitee,
       'group_invite',
       v_uid,
       'group',
       p_group,
       coalesce(v_actor_name, 'Someone') || ' invited you to a group',
       'Join "' || v_group_name || '" on FOUND.');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.invite_to_group(uuid, uuid[]) to authenticated;

create or replace function public.respond_to_group_invite(
  p_invite uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_group   uuid;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select group_id, status into v_group, v_status
  from public.group_invites
  where id = p_invite and invitee_id = v_uid;

  if v_group is null then
    raise exception 'invite not found';
  end if;
  if v_status <> 'pending' then
    return v_status;
  end if;

  if p_accept then
    update public.group_invites
       set status = 'accepted', responded_at = now()
     where id = p_invite;
    perform public.join_group(v_group);
    return 'accepted';
  else
    update public.group_invites
       set status = 'declined', responded_at = now()
     where id = p_invite;
    return 'declined';
  end if;
end;
$$;

grant execute on function public.respond_to_group_invite(uuid, boolean) to authenticated;

-- FIXED: cover_path is derived from photos table, not a column on groups
create or replace function public.my_group_invites()
returns table (
  id            uuid,
  group_id      uuid,
  group_name    text,
  group_cover   text,
  inviter_id    uuid,
  inviter_name  text,
  created_at    timestamptz
)
language sql stable
set search_path = public
as $$
  select gi.id,
         gi.group_id,
         g.name,
         (select ph.storage_path from public.photos ph
          where ph.owner_kind = 'group' and ph.owner_id = g.id
          order by ph.sort_order asc, ph.created_at asc limit 1) as group_cover,
         gi.inviter_id,
         p.full_name,
         gi.created_at
    from public.group_invites gi
    join public.groups   g on g.id = gi.group_id
    left join public.profiles p on p.id = gi.inviter_id
   where gi.invitee_id = auth.uid()
     and gi.status     = 'pending'
   order by gi.created_at desc;
$$;

grant execute on function public.my_group_invites() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: Re-run 0068 (list_group_pending_invites — depends on group_invites)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.list_group_pending_invites(p_group uuid)
returns table (
  invite_id   uuid,
  profile_id  uuid,
  full_name   text,
  handle      text,
  avatar_url  text,
  invited_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    gi.id           as invite_id,
    p.id            as profile_id,
    p.full_name,
    p.handle,
    p.avatar_url,
    gi.created_at   as invited_at
  from public.group_invites gi
  join public.profiles p on p.id = gi.invitee_id
  where gi.group_id = p_group
    and gi.status   = 'pending'
    and exists (
      select 1
      from public.group_members gm
      where gm.group_id   = p_group
        and gm.profile_id = auth.uid()
        and gm.role in ('owner', 'admin')
    )
  order by gi.created_at;
$$;

grant execute on function public.list_group_pending_invites(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: Re-run my_groups_feed + group_detail from 0065
--         (both reference group_invites and were skipped)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.my_groups_feed();

create or replace function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean,
  has_pending_invite  boolean
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=(select id from me)) as is_member,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=(select id from me)) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=(select id from me)
             and gi.status='pending') as has_pending_invite
  from public.groups g
  where g.is_public
     or exists(select 1 from public.group_members gm
               where gm.group_id=g.id and gm.profile_id=(select id from me))
     or exists(select 1 from public.group_invites gi
               where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
  order by
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=(select id from me))
         then 0
         when exists(select 1 from public.group_invites gi
                     where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
         then 1
         else 2 end,
    g.member_count desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;

drop function if exists public.group_detail(uuid);

create or replace function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean,
  has_pending_invite  boolean,
  website_url         text
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=auth.uid())
         then g.address else null end as address,
    g.schedule_text, g.member_count, g.church_id, g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
     where gm.group_id=g.id and gm.profile_id=auth.uid()) as my_role,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=auth.uid()) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=auth.uid()
             and gi.status='pending') as has_pending_invite,
    g.website_url
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5: Re-run 0070 group_events_list (events table now exists)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.group_events_list(uuid);

create or replace function public.group_events_list(p_group uuid)
returns table (
  id             uuid,
  title          text,
  event_time     timestamptz,
  location_name  text,
  description    text,
  creator_id     uuid,
  recurrence     text,
  going_count    bigint,
  pending_count  bigint,
  my_status      text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.event_time,
    e.location_name,
    e.description,
    e.creator_id,
    e.recurrence,
    count(case when ei.status = 'accepted' then 1 end) as going_count,
    count(case when ei.status = 'pending'  then 1 end) as pending_count,
    (select ei2.status from public.event_invites ei2
     where ei2.event_id = e.id and ei2.invitee_id = auth.uid()
     limit 1) as my_status
  from public.events e
  left join public.event_invites ei on ei.event_id = e.id
  where e.group_id = p_group
    and e.event_time >= now()
  group by e.id
  order by e.event_time asc;
$$;

grant execute on function public.group_events_list(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 6: Re-run create_event final form from 0079
--         (includes recurrence_rule; supersedes 0070 + 0071 versions)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[]);
drop function if exists public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid);
drop function if exists public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text);

create or replace function public.create_event(
  p_title           text,
  p_event_time      timestamptz,
  p_location_name   text             default null,
  p_location_lat    double precision default null,
  p_location_lng    double precision default null,
  p_description     text             default null,
  p_invitee_ids     uuid[]           default null,
  p_group_id        uuid             default null,
  p_recurrence      text             default null,
  p_recurrence_rule jsonb            default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id   uuid;
  v_recurrence text;
begin
  v_recurrence := case
    when p_recurrence in ('weekly','biweekly','monthly') then p_recurrence
    when p_recurrence = 'monthly_nth' and p_recurrence_rule is not null then 'monthly_nth'
    else null
  end;

  insert into public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence, recurrence_rule
  )
  values (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id, v_recurrence,
    case when v_recurrence = 'monthly_nth' then p_recurrence_rule else null end
  )
  returning id into v_event_id;

  if p_group_id is not null then
    insert into public.event_invites (event_id, invitee_id)
    select v_event_id, gm.profile_id
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.profile_id <> auth.uid()
    on conflict do nothing;
  elsif p_invitee_ids is not null then
    insert into public.event_invites (event_id, invitee_id)
    select v_event_id, unnest(p_invitee_ids)
    on conflict do nothing;
  end if;

  return v_event_id;
end;
$$;

grant execute on function public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 7: Re-run 0073 my_groups_feed (adds lat/lng; references group_invites)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.my_groups_feed();

create or replace function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean,
  has_pending_invite  boolean,
  lat                 double precision,
  lng                 double precision
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=(select id from me)) as is_member,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=(select id from me)) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=(select id from me)
             and gi.status='pending') as has_pending_invite,
    st_y(g.location::geometry) as lat,
    st_x(g.location::geometry) as lng
  from public.groups g
  where g.is_public
     or exists(select 1 from public.group_members gm
               where gm.group_id=g.id and gm.profile_id=(select id from me))
     or exists(select 1 from public.group_invites gi
               where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
  order by
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=(select id from me))
         then 0
         when exists(select 1 from public.group_invites gi
                     where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
         then 1
         else 2 end,
    g.member_count desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;

create or replace function public.my_location()
returns table (lat double precision, lng double precision)
language sql stable
security definer
set search_path = public
as $$
  select
    st_y(location::geometry) as lat,
    st_x(location::geometry) as lng
  from public.profiles
  where id = auth.uid()
    and location is not null
  limit 1;
$$;

grant execute on function public.my_location() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- DONE.
-- Verify with:
--   \dt public.events
--   \dt public.event_invites
--   \dt public.group_invites
--   select count(*) from public.group_invites;
--   select * from public.my_groups_feed() limit 1;
--   select * from public.group_detail('<any_group_uuid>');
-- ─────────────────────────────────────────────────────────────────────────────
