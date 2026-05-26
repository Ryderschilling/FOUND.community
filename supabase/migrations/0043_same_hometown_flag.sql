-- =============================================================================
-- 0043_same_hometown_flag.sql
--
-- Adds `same_hometown` to top_matches_detailed so the Discover feed can render
-- a "Same hometown" chip on each PersonCard.
--
-- Comparison rule matches match_score() exactly:
--   case-insensitive, whitespace-trimmed, both non-blank.
--
-- Whole RPC is dropped + recreated (same pattern as 0029). Logic preserved
-- verbatim aside from the joined `me_p` CTE that pulls viewer hometown and
-- the new `same_hometown` output column. `get_profile_detail` also gains the
-- flag so MatchDetailScreen can show the chip later if we want.
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
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- get_profile_detail also gets same_hometown so MatchDetail can use it.
drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  hometown          text,
  avatar_url        text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  score             int,
  activities        jsonb,
  connection_count  int,
  group_count       int,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean,
  same_hometown     boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       me_p as (select id, hometown from public.profiles where id = (select id from me))
  select
    p.id                  as profile_id,
    p.full_name,
    p.handle::text        as handle,
    p.bio,
    p.hometown,
    p.avatar_url,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.life_stage_id,
    ls.label              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end                             as church_name,
    public.match_score((select id from me), p.id)               as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    (
      select count(*)::int
      from public.connections c1
      join public.connections c2
        on c2.from_profile = c1.to_profile
       and c2.to_profile   = c1.from_profile
       and c2.kind         = 'like'
      where c1.from_profile = p.id
        and c1.kind         = 'like'
    )                                                           as connection_count,
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile   = p.id and m.kind = 'like'
      ) and exists (
        select 1 from public.connections t
        where t.from_profile = p.id
          and t.to_profile   = (select id from me) and t.kind = 'like'
      )
    )                                                           as is_match,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                                           as same_hometown
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;
