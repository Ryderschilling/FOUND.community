-- =============================================================================
-- 0049_anywhere_mutual_sort.sql
--
-- Fixes "Anywhere" mode never actually showing everyone, and adds mutual
-- connection count to drive ranking.
--
-- Problems solved:
--   1. "Anywhere" in the UI passed no RPC args, so the SQL fell to condition (D)
--      and hard-filtered by the profile's saved discovery_radius_miles (default
--      50 mi). Nowhere near "anywhere". Fixed via explicit p_anywhere flag.
--   2. Anywhere sort was distance-first, which is meaningless when showing the
--      whole world. Now sorts by score desc, mutual_count desc.
--   3. mutual_count (shared mutual friends between viewer and candidate) was not
--      computed or surfaced. Now returned so the feed can show "X mutual".
--
-- Changes:
--   top_matches()         → new p_anywhere boolean param; Anywhere sort = score desc
--   top_matches_detailed() → new p_anywhere boolean param; adds mutual_count int output
--
-- Hometown: already wired (+10 in match_score, same_hometown flag in detailed).
-- No change needed — it's a key input to score and surfaced in the card.
--
-- Run AFTER 0048. Idempotent (drop + recreate).
-- =============================================================================

-- Drop all existing overloads
drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);
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
  -- Anywhere: score-first (distance is meaningless world-wide).
  -- Near Me:  closest first; unmapped users fall to the bottom.
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
-- top_matches_detailed: add p_anywhere + mutual_count
-- =============================================================================
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int, boolean);

create or replace function public.top_matches_detailed(
  p_limit     int               default 25,
  p_lat       double precision  default null,
  p_lng       double precision  default null,
  p_radius_mi int               default null,
  p_anywhere  boolean           default false
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
  mutual_count      int,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with
  me as (select auth.uid() as id),
  me_p as (
    select id, hometown from public.profiles where id = (select id from me)
  ),
  -- My mutual matches: people where we've both liked each other.
  -- Used to compute shared mutual friends per candidate.
  my_matches as (
    select c1.to_profile as friend_id
    from public.connections c1
    join public.connections c2
      on  c2.from_profile = c1.to_profile
      and c2.to_profile   = (select id from me)
      and c2.kind         = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind         = 'like'
  ),
  base as (
    select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi, p_anywhere)
  )
  select
    b.profile_id,
    b.score,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                         as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                                as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                               as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label                                                      as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                           as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                                as church_name,
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
    ), '[]'::jsonb)                                               as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile   = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                             as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile   = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                             as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile   = p.id
          and cn.kind         = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile   = (select id from me)
          and cn.kind         = 'like'
      )
    )                                                             as is_match,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                                             as same_hometown,
    -- Shared mutual friends: people both the viewer AND this candidate
    -- are mutually matched with (bidirectional like). Shows social proof.
    (
      select count(distinct mm.friend_id)::int
      from my_matches mm
      -- candidate → mutual friend (like)
      join public.connections c3
        on  c3.from_profile = b.profile_id
        and c3.to_profile   = mm.friend_id
        and c3.kind         = 'like'
      -- mutual friend → candidate (like back)
      join public.connections c4
        on  c4.from_profile = mm.friend_id
        and c4.to_profile   = b.profile_id
        and c4.kind         = 'like'
    )                                                             as mutual_count,
    p.created_at
  from base b
  join public.profiles   p  on p.id  = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  -- Anywhere: best score first, then most mutual connections.
  -- Near Me:  closest first; unmapped users at the bottom.
  order by
    (case when p_anywhere then 0::float
          else coalesce(b.distance_mi, 9999)::float
     end) asc,
    b.score desc,
    mutual_count desc;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int, boolean) to authenticated;

-- =============================================================================
-- DONE.
-- Verify Anywhere shows everyone:
--   select profile_id, full_name, distance_mi, score, mutual_count
--     from top_matches_detailed(100, null, null, null, true);
--   → should return every real account except caller, ordered by score desc.
--
-- Verify Near Me still uses distance:
--   select profile_id, full_name, distance_mi, score
--     from top_matches_detailed(25, 30.28, -86.13, 25, false);
--   → should return profiles within 25 mi, closest first.
-- =============================================================================
