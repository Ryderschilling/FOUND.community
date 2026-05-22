-- =============================================================================
-- 0022_location_soft_filter.sql
-- Converts the location override from a HARD radius filter to a SOFT sort.
--
-- Problem (QA P2-4):
--   0016 made `top_matches` STRICTLY exclude every profile outside the radius
--   AND every profile with a NULL location. Most profiles have no geocoded
--   PostGIS `location`, so turning on the "Near Me" filter emptied Discover.
--
-- Fix:
--   - No profile is excluded for geography reasons anymore.
--   - Each row gets an `in_radius` boolean (true only when an override point
--     is supplied AND the profile has a location inside the radius).
--   - Results are SORTED by `in_radius` first, so nearby people float to the
--     top of the feed while everyone else still shows below them.
--
-- This changes the return shape of both RPCs (adds `in_radius`), so the
-- functions are dropped and recreated. The client ignores unknown columns,
-- so no app-side change is required.
-- =============================================================================

-- ---- top_matches (soft location sort) -------------------------------------
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
  distance_mi numeric,
  in_radius   boolean
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
    end as distance_mi,
    -- Soft flag: true only when an override point is supplied AND this
    -- profile has a location inside the radius. Drives sort order, not
    -- inclusion — nobody is filtered out for geography anymore.
    case
      when (select pt from filter_pt) is null then false
      when p.location is not null
        and ST_DWithin(
          (select pt from filter_pt),
          p.location,
          (select meters from filter_radius_m)
        )
        then true
      else false
    end as in_radius
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
  -- In-radius people first, then by score, then nearest. No hard filter.
  order by in_radius desc, score desc, distance_mi asc nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- ---- top_matches_detailed (pass-through, in_radius preserved) --------------
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
  in_radius         boolean,
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
    b.in_radius,
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
  -- Mirror top_matches: in-radius first, then score, then nearest.
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;
