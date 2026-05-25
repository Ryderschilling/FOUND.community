-- =============================================================================
-- 0039_fix_group_member_count.sql
-- Fixes inconsistent group member counts across the app.
--
-- Root cause:
--   groups.member_count is a denormalized counter maintained by the
--   bump_group_member_count() trigger. That trigger was broken before 0018
--   (no SECURITY DEFINER → member joins blocked by RLS, count never moved),
--   and migrations were applied ad-hoc out of order. Result: the cached
--   member_count column drifted away from the true row count.
--
--   my_groups_feed() and group_detail() both displayed the stale cached
--   column, while GroupDetailScreen's roster section shows the live
--   group_members_list() count — so the same group reads differently
--   depending on which screen / which number you look at.
--
-- Fix:
--   1. Backfill groups.member_count to the true count (one-time repair).
--   2. Rewrite my_groups_feed() and group_detail() to compute the count
--      LIVE from group_members instead of trusting the cached column.
--      group_members PK is (group_id, profile_id) → count() is index-fast.
--
-- The cached column + trigger are left in place (harmless, low blast radius)
-- but are no longer the source of truth for anything displayed.
--
-- Single-pass. Safe to run once on top of 0001..0038.
-- =============================================================================


-- =============================================================================
-- 1. One-time backfill — resync the cached column to reality.
-- =============================================================================
update public.groups g
set member_count = (
  select count(*) from public.group_members gm where gm.group_id = g.id
)
where g.member_count is distinct from (
  select count(*) from public.group_members gm where gm.group_id = g.id
);


-- =============================================================================
-- 2. group_detail — count computed live. Signature unchanged; drop+recreate
--    defensively in case the deployed signature drifted.
-- =============================================================================
drop function if exists public.group_detail(uuid);

create function public.group_detail(p_group uuid)
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
  has_pending_request boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    -- Address is members-only — many groups meet at homes.
    case
      when exists (select 1 from public.group_members gm
                   where gm.group_id = g.id and gm.profile_id = auth.uid())
        then g.address
      else null
    end as address,
    g.schedule_text,
    -- LIVE count — not the cached groups.member_count column.
    (select count(*)::int from public.group_members gm
      where gm.group_id = g.id) as member_count,
    g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role,
    exists (select 1 from public.group_join_requests r
            where r.group_id = g.id and r.profile_id = auth.uid()) as has_pending_request
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- =============================================================================
-- 3. my_groups_feed — count computed live, in both the SELECT and the
--    ORDER BY (so "most members" sort stays correct even as the cached
--    column drifts). Signature unchanged; drop+recreate defensively.
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
  has_pending_request boolean
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
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.is_public,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member,
    exists (
      select 1 from public.group_join_requests r
      where r.group_id = g.id and r.profile_id = (select id from me)
    ) as has_pending_request
  from public.groups g
  order by
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    (select count(*) from public.group_members gm where gm.group_id = g.id) desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- Force PostgREST to pick up the rebuilt functions immediately.
notify pgrst, 'reload schema';
