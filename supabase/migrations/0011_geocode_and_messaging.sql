-- =============================================================================
-- 0011_geocode_and_messaging.sql
-- Adds:
--   - set_profile_location(lat, lng)   — writes PostGIS point from coords
--   - messageable_contacts()           — list for the "New Message" picker
--   - discover_debug()                 — debug RPC: every profile + why it
--                                        matches or doesn't (handy when an
--                                        account doesn't show up in Discover)
-- =============================================================================

-- ---- set_profile_location --------------------------------------------------
-- Takes lat/lng (WGS84), writes geography(point, 4326) to profiles.location.
-- Caller can only update their own row (auth.uid()).
create or replace function public.set_profile_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_lat is null or p_lng is null then
    -- Null coords = clear location
    update public.profiles set location = null where id = v_me;
    return;
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'lat/lng out of range';
  end if;
  update public.profiles
    set location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    where id = v_me;
end;
$$;

grant execute on function public.set_profile_location(double precision, double precision) to authenticated;


-- ---- messageable_contacts --------------------------------------------------
-- Returns profiles I can start a new direct thread with:
-- anyone I've connected/waved at, or who has connected/waved at me.
-- Sorted: matches first, then by most recent connection.
create or replace function public.messageable_contacts()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  is_match          boolean,
  last_touch        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  related as (
    -- People I've acted on
    select c.to_profile as other, max(c.created_at) as last_touch
    from public.connections c
    where c.from_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.to_profile
    union
    -- People who've acted on me
    select c.from_profile as other, max(c.created_at)
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.from_profile
  ),
  collapsed as (
    select other, max(last_touch) as last_touch
    from related
    group by other
  )
  select
    p.id              as profile_id,
    p.full_name,
    p.handle::text    as handle,
    p.avatar_url,
    ls.label          as life_stage_label,
    p.city,
    p.state,
    (
      exists (select 1 from public.connections cn
              where cn.from_profile = (select id from me)
                and cn.to_profile = p.id and cn.kind = 'like')
      and
      exists (select 1 from public.connections cn
              where cn.from_profile = p.id
                and cn.to_profile = (select id from me) and cn.kind = 'like')
    ) as is_match,
    c.last_touch
  from collapsed c
  join public.profiles p on p.id = c.other
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by is_match desc, c.last_touch desc;
$$;

grant execute on function public.messageable_contacts() to authenticated;


-- ---- discover_debug --------------------------------------------------------
-- Returns EVERY profile in the system, with the reason it's included/excluded
-- from your Discover feed. Useful when a freshly-onboarded account doesn't
-- appear. NOT used by the app — for SQL editor debugging only.
create or replace function public.discover_debug()
returns table (
  profile_id          uuid,
  full_name           text,
  handle              text,
  onboarding_complete boolean,
  has_location        boolean,
  is_self             boolean,
  is_blocked_by_me    boolean,
  is_blocked_by_them  boolean,
  score               int,
  appears_in_discover boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.onboarding_complete,
    (p.location is not null) as has_location,
    (p.id = (select id from me)) as is_self,
    exists (select 1 from public.connections c
            where c.from_profile = (select id from me)
              and c.to_profile = p.id
              and c.kind in ('skip','block')) as is_blocked_by_me,
    exists (select 1 from public.connections c
            where c.from_profile = p.id
              and c.to_profile = (select id from me)
              and c.kind = 'block') as is_blocked_by_them,
    public.match_score((select id from me), p.id) as score,
    (
      p.id <> (select id from me)
      and p.onboarding_complete = true
      and not exists (select 1 from public.connections c
                      where c.from_profile = (select id from me)
                        and c.to_profile = p.id
                        and c.kind in ('skip','block'))
      and not exists (select 1 from public.connections c
                      where c.from_profile = p.id
                        and c.to_profile = (select id from me)
                        and c.kind = 'block')
    ) as appears_in_discover
  from public.profiles p
  order by appears_in_discover desc, score desc;
$$;

grant execute on function public.discover_debug() to authenticated;
