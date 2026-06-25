-- top_matches() selects p.is_visible but never filters on it.
-- Hidden profiles still appear in discover. Fix: add and p.is_visible = true.

create or replace function public.top_matches(
  p_limit     int              default 25,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_radius_mi int              default null,
  p_anywhere  boolean          default false
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean,
  is_visible  boolean
)
language sql
stable
security definer
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
    ((select pt from filter_pt) is not null) as in_radius,
    p.is_visible
  from public.profiles p, me
  where p.id <> me.id
    and p.is_visible = true
    and coalesce(p.full_name, '') <> ''
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    and (
      case
        when p_anywhere = true then true
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
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
