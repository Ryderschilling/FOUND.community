-- =============================================================================
-- 0084_fix_member_count_live.sql
-- Fixes inconsistent group member counts in the Groups feed.
--
-- Root cause:
--   Migration 0039 fixed my_groups_feed() to use a live subquery count instead
--   of the stale denormalized groups.member_count column. Migration 0073 then
--   added lat/lng to my_groups_feed() but accidentally reverted the member_count
--   back to g.member_count (the cached column), re-introducing the bug.
--
-- Fix:
--   1. Backfill groups.member_count to the true live count (idempotent repair).
--   2. Rewrite my_groups_feed() to use a live subquery count while preserving
--      all the 0073 return columns (lat, lng, has_pending_invite, etc.).
--
-- Single-pass. Safe to run once on top of 0001..0083.
-- =============================================================================


-- =============================================================================
-- 1. One-time backfill — resync the cached column to reality.
-- =============================================================================
update public.groups g
set member_count = (
  select count(*)::int from public.group_members gm where gm.group_id = g.id
)
where g.member_count is distinct from (
  select count(*)::int from public.group_members gm where gm.group_id = g.id
);


-- =============================================================================
-- 2. my_groups_feed — use live count. Preserves 0073 return shape.
-- =============================================================================
drop function if exists public.my_groups_feed();

create function public.my_groups_feed()
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
    g.city, g.state, g.schedule_text,
    -- LIVE count — not the cached groups.member_count column.
    (select count(*)::int from public.group_members gm
      where gm.group_id = g.id) as member_count,
    g.church_id,
    g.created_by,
    (select ph.storage_path from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.is_public,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = (select id from me)) as is_member,
    exists (select 1 from public.group_join_requests r
            where r.group_id = g.id and r.profile_id = (select id from me)) as has_pending_request,
    exists (select 1 from public.group_invites gi
            where gi.group_id = g.id and gi.invitee_id = (select id from me)
              and gi.status = 'pending') as has_pending_invite,
    ST_Y(g.location::geometry) as lat,
    ST_X(g.location::geometry) as lng
  from public.groups g
  where g.is_public
     or exists (select 1 from public.group_members gm
                where gm.group_id = g.id and gm.profile_id = (select id from me))
     or exists (select 1 from public.group_invites gi
                where gi.group_id = g.id and gi.invitee_id = (select id from me)
                  and gi.status = 'pending')
  order by
    case
      when exists (select 1 from public.group_members gm
                   where gm.group_id = g.id and gm.profile_id = (select id from me))
           then 0
      when exists (select 1 from public.group_invites gi
                   where gi.group_id = g.id and gi.invitee_id = (select id from me)
                     and gi.status = 'pending')
           then 1
      else 2
    end,
    (select count(*) from public.group_members gm where gm.group_id = g.id) desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;

-- Force PostgREST to pick up the rebuilt function immediately.
notify pgrst, 'reload schema';
