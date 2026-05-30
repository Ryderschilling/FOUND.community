-- =============================================================================
-- 0060_profile_visibility.sql
--
-- Adds a "profile visibility" toggle so users can temporarily hide themselves
-- from Discover without deleting their account or any data.
--
-- Changes:
--   1. profiles.is_visible boolean NOT NULL DEFAULT true
--   2. set_profile_visibility(p_visible) RPC — authenticated users toggle own row
--   3. top_matches — re-created with AND p.is_visible = true guard
--      (top_matches_detailed is unchanged; it inherits the filter via top_matches)
--
-- Behaviour:
--   - Hidden users disappear from Discover for all other users.
--   - Existing connections, messages, and group memberships are unaffected.
--   - Inbound connection requests already sent remain visible to the recipient.
--   - Toggling back to visible re-appears in Discover instantly.
-- =============================================================================

-- 1. Add the column (idempotent)
alter table public.profiles
  add column if not exists is_visible boolean not null default true;

-- 2. RPC: authenticated user flips their own visibility
create or replace function public.set_profile_visibility(p_visible boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set    is_visible = p_visible
  where  id = auth.uid();
$$;

grant execute on function public.set_profile_visibility(boolean) to authenticated;

-- 3. top_matches — re-created from 0049 body with is_visible guard added.
-- Only change: AND p.is_visible = true in the WHERE clause.
drop function if exists public.top_matches(int, double precision, double precision, int, boolean);

create or replace function public.top_matches(
  p_limit     int               default 20,
  p_lat       double precision  default null,
  p_lng       double precision  default null,
  p_radius_mi int               default null,
  p_anywhere  boolean           default false
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me) is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    ((select pt from filter_pt) is not null) as in_radius
  from public.profiles p, me
  where p.id <> me.id
    and p.is_visible = true
    and coalesce(p.full_name, '') <> ''
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    and (
      case
        -- (A) Explicit Anywhere flag: show every real account, no geo gate.
        when p_anywhere = true then true
        -- (B) Override active (Near Me / Search city): HARD radius; unmapped excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (C) No override + saved Anywhere (radius = 0): show everyone.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        -- (D) No override + viewer has no location: show everyone.
        when me.location is null then true
        -- (E) No override + saved radius > 0: HARD filter; unmapped excluded.
        else
          p.location is not null
          and ST_DWithin(
                me.location,
                p.location,
                me.discovery_radius_miles::float * 1609.34
              )
      end
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  order by
    (case when p_anywhere then 0::float
          else coalesce(
            case
              when (select pt from filter_pt) is not null and p.location is not null
                then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::float
              when (select location from me) is not null and p.location is not null
                then (ST_Distance((select location from me), p.location) / 1609.34)::float
              else 9999999::float
            end, 9999999::float)
     end) asc,
    public.match_score((select id from me), p.id) desc,
    p.created_at desc
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int, boolean) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select is_visible from profiles where id = '<your-uuid>';
--   select set_profile_visibility(false);
--   -- should return 0 rows from your account:
--   select count(*) from top_matches(100, null, null, null, true);
-- =============================================================================
