-- =============================================================================
-- 0031_profile_detail.sql
--
-- get_profile_detail(p_profile uuid)
--   Single-call fetch for everything MatchDetailScreen needs when opening a
--   profile that wasn't loaded through top_matches_detailed (e.g. inbound
--   connection requests, Activity screen rows).
--
--   Returns:
--     • Full profile fields (bio, church, city, state, life stage)
--     • match_score against the calling user
--     • Activities list (same jsonb shape as top_matches_detailed)
--     • connection_count  — how many mutual connections the viewed profile has
--     • group_count       — how many groups the viewed profile belongs to
--     • my_kind / their_kind / is_match — current relationship state
-- =============================================================================

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
  is_match          boolean
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
    -- Activities — same jsonb shape used in top_matches_detailed
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    -- connection_count: mutual connections (both sides have 'like')
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
    -- group_count: groups the viewed profile is a member of
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    -- My relationship to this profile
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    -- Their relationship to me
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    -- is_match = both sides have 'like'
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
    )                                                           as is_match
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;
