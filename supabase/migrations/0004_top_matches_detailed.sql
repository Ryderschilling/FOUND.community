-- =============================================================================
-- 0004: top_matches_detailed() RPC
-- Single-call enriched match feed for HomeScreen / Discover.
-- Returns score + distance + profile + life-stage label + church name +
-- activities[] for each match — everything the PersonCard needs in one shot.
-- =============================================================================

create or replace function public.top_matches_detailed(p_limit int default 25)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb
) language sql stable
set search_path = public
as $$
  with base as (
    select * from public.top_matches(p_limit)
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
    ), '[]'::jsonb) as activities
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int) to authenticated;
