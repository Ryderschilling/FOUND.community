-- =============================================================================
-- 0026_privacy_discovery_wiring.sql
-- Makes the Profile → Settings → Privacy / Location toggles actually do
-- something. Until now the columns from 0025 were written but never read.
--
-- What this wires up:
--   privacy_prefs.discoverable  → non-discoverable profiles are EXCLUDED from
--                                 the Discover feed (top_matches).
--   discovery_radius_miles      → the viewer's saved radius now filters the
--                                 Discover feed by distance. 0 = Anywhere.
--   privacy_prefs.show_church   → other people don't see your church.
--   privacy_prefs.show_location → other people don't see your city/state or
--                                 distance.
--
-- Design notes:
--   * The radius is a HARD filter, but ONLY for profiles that have a geocoded
--     location. Profiles with no location are always kept — we can't measure
--     them, so dropping them would silently empty the feed (the bug 0022 fixed).
--   * The persistent radius is ignored while a "Near Me" location override is
--     active (the override has its own soft in_radius sort). Explicit action
--     beats a saved default.
--   * show_church / show_location are enforced server-side in every RPC that
--     returns someone else's church/location, so no client can bypass them.
--   * No signature changes → plain CREATE OR REPLACE everywhere. Grants are
--     preserved by REPLACE but re-stated for clarity.
-- =============================================================================


-- =============================================================================
-- 0. Schema guard — connections.seen_at / dismissed_at
--    inbound_connections() (section 3) reads these columns. They were added
--    by migration 0012, which was never applied to this database. Without
--    this guard the CREATE of inbound_connections fails immediately with
--    42703 (language sql bodies are validated at create time).
--    `add column if not exists` makes this a no-op if 0012 was applied.
-- =============================================================================
alter table public.connections
  add column if not exists seen_at      timestamptz,
  add column if not exists dismissed_at timestamptz;

create index if not exists idx_connections_to_unread
  on public.connections (to_profile)
  where seen_at is null and dismissed_at is null;


-- =============================================================================
-- 1. top_matches — discoverable filter + persistent discovery-radius filter
-- =============================================================================
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
  -- Materialize the "Near Me" override point (NULL if no override).
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if not provided).
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
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
    -- Privacy → Discoverable. Opted-out profiles never appear in Discover.
    -- coalesce defends against a missing/edited jsonb key.
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    -- Persistent discovery radius. Skipped when a "Near Me" override is active
    -- (p_lat not null), when the viewer has no location to measure from, or
    -- when the viewer chose "Anywhere" (0). Ungeocoded candidates always pass.
    and (
      p_lat is not null
      or me.location is null
      or coalesce(me.discovery_radius_miles, 0) = 0
      or p.location is null
      or ST_DWithin(
           me.location,
           p.location,
           coalesce(me.discovery_radius_miles, 0)::float * 1609.34
         )
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
-- 2. top_matches_detailed — hide church / city / state / distance per the
--    target profile's privacy_prefs. Sort still uses the REAL base distance,
--    so hiding a location never changes feed ordering, only what's displayed.
-- =============================================================================
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
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 3. inbound_connections — hide city/state per the sender's show_location.
--    (No church column here, so show_church does not apply.)
-- =============================================================================
-- Return type changes (city/state nulling) → DROP before recreate.
drop function if exists public.inbound_connections();

create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.bio,
    p.avatar_url,
    ls.label                              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end        as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end       as state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;

grant execute on function public.inbound_connections() to authenticated;


-- =============================================================================
-- 4. my_connections — hide city/state per the connection's show_location.
-- =============================================================================
-- Return type changes (city/state nulling) → DROP before recreate.
drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================
