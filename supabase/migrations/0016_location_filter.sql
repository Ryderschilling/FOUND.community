-- =============================================================================
-- 0016_location_filter.sql
-- Adds location-filter overrides to the discover RPCs so the user can
-- "search by location" without changing their profile location.
--
--   top_matches(p_limit, p_lat, p_lng, p_radius_mi)
--   top_matches_detailed(p_limit, p_lat, p_lng, p_radius_mi)
--
-- All overrides are optional:
--   - If lat+lng are NULL, no hard radius filter (current behavior — every
--     onboarded profile returned, distance computed against MY profile
--     location when both sides have one).
--   - If lat+lng are provided, results are STRICTLY filtered to profiles
--     with a location within p_radius_mi of (lat,lng). No-location profiles
--     are excluded in that case (they can't be matched against geography).
-- =============================================================================

-- ---- top_matches (now with optional override) -----------------------------
drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);

create or replace function public.top_matches(
  p_limit       int               default 20,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, match_radius_mi
    from public.profiles
    where id = auth.uid()
  ),
  -- Materialize the override point (NULL if no override)
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if not provided)
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    -- Distance is measured from the override point when present, else from
    -- my profile location. NULL if neither side has coordinates.
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi
  from public.profiles p, me
  where p.id <> me.id
    and p.onboarding_complete = true
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
    -- Hard radius filter applies only when caller passes an override point.
    -- Default discover (no override) keeps showing no-location profiles so
    -- new users without geocoded city/state aren't invisible.
    and (
      (select pt from filter_pt) is null
      or (
        p.location is not null
        and ST_DWithin(
          (select pt from filter_pt),
          p.location,
          (select meters from filter_radius_m)
        )
      )
    )
  order by score desc, distance_mi nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- ---- top_matches_detailed (pass-through) ----------------------------------
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- ---- get_my_location ------------------------------------------------------
-- Returns the caller's profile location as plain lat/lng. NULL row when
-- the user hasn't set a location yet. Used by the Discover screen so the
-- "Near Me" filter mode can pass an override point to top_matches.
create or replace function public.get_my_location()
returns table (lat double precision, lng double precision)
language sql stable
set search_path = public
as $$
  select
    ST_Y(location::geometry)::double precision as lat,
    ST_X(location::geometry)::double precision as lng
  from public.profiles
  where id = auth.uid()
    and location is not null;
$$;

grant execute on function public.get_my_location() to authenticated;
