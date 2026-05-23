-- =============================================================================
-- 0029_radius_hard_filter.sql
-- Makes the mile radius an ACTUAL filter — in both places it can be set.
--
--   1. Discover location pill (Near Me / Search a city) — the p_lat/p_lng/
--      p_radius_mi override. Before 0029 this was a SOFT sort (migration 0022):
--      picking "10 mi" only floated nearby people up — everyone else still
--      showed. Now it is a HARD filter: only profiles within p_radius_mi of
--      the override point come back.
--
--   2. Settings -> Location Settings -> Discovery radius — the viewer's
--      profiles.discovery_radius_miles. It was already a hard filter as of
--      0026, but it leaked every profile with no geocoded location, and it
--      was bypassed whenever a Discover override was active. Cleaned up here.
--
-- RULE from 0029 on:
--   * If a radius is active, a profile with no `location` does NOT appear.
--     You can't place them on a map, so they can't satisfy a distance filter.
--   * "Anywhere" still shows everyone:
--       - Discover pill = Anywhere  -> no override; falls back to the saved
--         Discovery radius.
--       - Discovery radius = 0      -> no distance limit at all.
--       - Viewer has no location    -> nothing to measure from -> no limit.
--   * An active Discover override (Near Me / Search a city) takes precedence
--     over the saved Discovery radius — explicit action beats a saved default.
--
-- DATA DEPENDENCY — read this:
--   Most older seed/test profiles have a NULL `location`. After this migration
--   they disappear from any radius-filtered feed until they are geocoded.
--   Run `scripts/backfill-locations.js` once to geocode them from city/state.
--   New users are already geocoded at the end of onboarding, so this only
--   affects pre-existing rows.
--
-- DRIFT-SAFE: both functions are DROPped (all known signatures) before being
-- recreated, so this applies cleanly regardless of which earlier migration
-- last touched them. top_matches_detailed also regains `created_at` (the
-- Discover "New" chip reads it; the RUN_IN_SUPABASE bundle had dropped it).
-- =============================================================================


-- =============================================================================
-- 1. top_matches — hard radius filter (override point OR saved discovery radius)
-- =============================================================================
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
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  -- "Near Me" / "Search a city" override point (NULL when no override).
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if somehow omitted).
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    -- Distance from the override point when present, else from my location.
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    -- True whenever an override is active (every returned row passed the hard
    -- filter). Kept so the client can still badge "nearby" and for sort.
    ((select pt from filter_pt) is not null) as in_radius
  from public.profiles p, me
  where p.id <> me.id
    and p.onboarding_complete = true
    -- Privacy -> Discoverable. Opted-out profiles never appear in Discover.
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    -- ── Mile radius — HARD filter ──────────────────────────────────────────
    and (
      case
        -- (A) Discover override active (Near Me / Search a city).
        --     Strict: candidate must have a location within p_radius_mi of
        --     the override point. No location -> excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (B) No override -> the viewer's saved Discovery radius.
        --     0 = Anywhere -> no filter. Viewer has no location -> nothing to
        --     measure from -> no filter. Otherwise strict; no location on the
        --     candidate -> excluded.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        when me.location is null then true
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
  order by in_radius desc, score desc, distance_mi asc nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 2. top_matches_detailed — pass-through; keeps the 0026 privacy nulling and
--    re-adds `created_at` (needed by the Discover "New" filter chip).
-- =============================================================================
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
  is_match          boolean,
  created_at        timestamptz
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
    -- Distance is part of "location" — hidden when show_location is off.
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                       as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                              as church_name,
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
    )                                       as is_match,
    p.created_at
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 3. set_location_by_id — admin RPC used by scripts/backfill-locations.js to
--    geocode pre-existing profiles. SECURITY DEFINER so it can write any row;
--    execute is REVOKEd from public and granted ONLY to service_role, so no
--    signed-in app user can move another person's location.
-- =============================================================================
create or replace function public.set_location_by_id(
  p_id   uuid,
  p_lat  double precision,
  p_lng  double precision
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
   where id = p_id;
$$;

revoke execute on function public.set_location_by_id(uuid, double precision, double precision) from public;
grant  execute on function public.set_location_by_id(uuid, double precision, double precision) to service_role;

-- =============================================================================
-- DONE.
-- =============================================================================
