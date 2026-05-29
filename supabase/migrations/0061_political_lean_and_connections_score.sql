-- =============================================================================
-- 0061_political_lean_and_connections_score.sql
--
-- 1) get_profile_detail — adds political_lean to the returned row so
--    MatchDetailScreen can display the political alignment badge.
--
-- 2) my_connections — adds match_score and activity list so the FOUND tab
--    connections view can show scores and sort/filter by them.
--
-- Run AFTER 0060.
-- =============================================================================

-- ─── 1) get_profile_detail — add political_lean ───────────────────────────────
create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
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
  political_lean    integer
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    p.id                  as profile_id,
    p.full_name,
    p.handle::text        as handle,
    p.bio,
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
    p.political_lean
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- ─── 2) my_connections — add score + activities ───────────────────────────────
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
  connected_at      timestamptz,
  score             int,
  activities        jsonb
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
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
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
    m.connected_at,
    public.match_score((select id from me), p.id) as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                 as activities
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select political_lean from get_profile_detail('<some_uuid>');
--   select score, activities from my_connections() limit 5;
-- =============================================================================
