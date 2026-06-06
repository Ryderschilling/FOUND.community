-- ─────────────────────────────────────────────────────────────────────────
-- 0073 · my_groups_feed: expose lat/lng for client-side radius filtering
--        my_location: helper that returns the calling user's coordinates
-- ─────────────────────────────────────────────────────────────────────────

-- ── my_groups_feed: add lat + lng ────────────────────────────────────────
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
    ST_Y(g.location::geometry) as lat,
    ST_X(g.location::geometry) as lng
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

-- ── my_location: returns the caller's lat/lng from their profile ──────────

create or replace function public.my_location()
returns table (lat double precision, lng double precision)
language sql stable
security definer
set search_path = public
as $$
  select
    ST_Y(location::geometry) as lat,
    ST_X(location::geometry) as lng
  from public.profiles
  where id = auth.uid()
    and location is not null
  limit 1;
$$;

grant execute on function public.my_location() to authenticated;
