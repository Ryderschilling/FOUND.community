-- =============================================================================
-- 0044_discover_show_everyone.sql
--
-- Discover rules (final):
--   * "Anywhere" (no location override, viewer's saved radius = 0 OR viewer
--     has no location): show EVERY real account, including those with no
--     geocoded location. Sort closest first; unmapped users fall to the bottom.
--   * Location override active (Near Me / Search a city) OR saved radius
--     active: HARD filter by radius; profiles with no location are excluded
--     (can't place them on a map). Sort closest first within the radius.
--
-- Visibility gate changed from `onboarding_complete = true` to
-- `coalesce(full_name,'') <> ''`. A real account = a person with a name.
-- Website-signup users who haven't finished the 9-step app onboarding now
-- appear in Discover immediately (with low match scores until they finish).
--
-- Sort changed from (in_radius desc, score desc, distance asc) to
-- (distance asc nulls last, score desc) — closest first, unmapped last.
--
-- Run AFTER 0043. Idempotent (drop + recreate both functions).
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
    -- A real account = somebody with a name. No longer requires full onboarding.
    and coalesce(p.full_name, '') <> ''
    -- Privacy opt-out still hides the profile (default true).
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    and (
      case
        -- (A) Override active (Near Me / Search city): HARD radius; unmapped excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (B) No override + saved Anywhere (radius = 0): show everyone.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        -- (C) No override + viewer has no location: nothing to measure from, show everyone.
        when me.location is null then true
        -- (D) No override + saved radius > 0: HARD filter; unmapped excluded.
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
  -- Closest first. Unmapped users (distance null) drop to the bottom.
  order by distance_mi asc nulls last, score desc, p.created_at desc
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- top_matches_detailed: re-create from the 0043 body with the new ORDER BY.
-- Only the final sort differs vs 0043 (closest first instead of in_radius first).
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
  same_hometown     boolean,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       me_p as (
         select id, hometown from public.profiles where id = (select id from me)
       ),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
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
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                       as same_hometown,
    p.created_at
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  -- Closest first; unmapped users at the bottom. Matches top_matches sort.
  order by b.distance_mi asc nulls last, b.score desc;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select profile_id, full_name, distance_mi, in_radius, score
--     from top_matches_detailed(100, null, null, null);
-- Should now return every real account except the caller, closest first, with
-- unmapped users showing distance_mi = null at the bottom.
-- =============================================================================
