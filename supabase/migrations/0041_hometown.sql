-- =============================================================================
-- 0041_hometown.sql
--
-- Adds `hometown` — "Where are you from?" — to profiles.
--
-- Separate from city/state (which is *where you live now*). Hometown is a
-- soft identity field that helps fill out a bio and unlocks a future
-- "match people from the same place" signal.
--
-- Changes:
--   1. profiles.hometown text (nullable)
--   2. update_profile() RPC gains p_hometown param
--   3. get_profile_detail() returns hometown so the public profile can show it
-- =============================================================================

-- 1) Column ------------------------------------------------------------------
alter table public.profiles
  add column if not exists hometown text;

-- 2) update_profile RPC ------------------------------------------------------
-- Need to drop the old signature since we're adding a positional param.
drop function if exists public.update_profile(
  text, text, text, text, text, uuid, text, text, boolean, boolean,
  text[], text[], text[]
);

create or replace function public.update_profile(
  p_full_name     text default null,
  p_bio           text default null,
  p_city          text default null,
  p_state         text default null,
  p_life_stage    text default null,
  p_church_id     uuid default null,
  p_love_language text default null,
  p_school_type   text default null,
  p_is_initiator  boolean default null,
  p_is_outgoing   boolean default null,
  p_hometown      text default null,
  p_activities    text[] default null,
  p_goals         text[] default null,
  p_values        text[] default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    full_name        = coalesce(p_full_name, full_name),
    bio              = coalesce(p_bio,       bio),
    city             = coalesce(p_city,      city),
    state            = coalesce(p_state,     state),
    hometown         = coalesce(p_hometown,  hometown),
    life_stage_id    = coalesce(p_life_stage,    life_stage_id),
    church_id        = coalesce(p_church_id,     church_id),
    love_language_id = coalesce(p_love_language, love_language_id),
    school_type_id   = coalesce(p_school_type,   school_type_id),
    is_initiator     = coalesce(p_is_initiator,  is_initiator),
    is_outgoing      = coalesce(p_is_outgoing,   is_outgoing),
    last_active_at   = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, x from unnest(p_activities) as x
      on conflict do nothing;
    end if;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, x from unnest(p_goals) as x
      on conflict do nothing;
    end if;
  end if;

  if p_values is not null then
    delete from public.profile_values where profile_id = v_uid;
    if array_length(p_values, 1) is not null then
      insert into public.profile_values (profile_id, value_id)
      select v_uid, x from unnest(p_values) as x
      on conflict do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.update_profile(
  text, text, text, text, text, uuid, text, text, boolean, boolean, text,
  text[], text[], text[]
) to authenticated;

-- 3) get_profile_detail RPC --------------------------------------------------
-- Adds `hometown` to the return shape. Original logic preserved verbatim.
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
    )                                                           as is_match
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;
