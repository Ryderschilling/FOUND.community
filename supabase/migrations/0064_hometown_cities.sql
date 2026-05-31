-- =============================================================================
-- 0064_hometown_cities.sql
--
-- Adds hometown_cities TEXT[] to profiles so users can list individual places
-- they've lived for matching (separate from the freeform hometown journey string).
--
-- Updates:
--   - update_profile() to accept p_hometown_cities
--   - get_profile_detail() to return hometown_cities (exact logic from 0043 preserved)
-- =============================================================================

-- ── 1. Column ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists hometown_cities text[] default null;


-- ── 2. update_profile — add p_hometown_cities ─────────────────────────────────
-- Drop and recreate. We need to drop all overloads since Postgres matches on args.

drop function if exists public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[]);

create or replace function public.update_profile(
  p_full_name       text     default null,
  p_bio             text     default null,
  p_hometown        text     default null,
  p_city            text     default null,
  p_state           text     default null,
  p_life_stage      text     default null,
  p_church_id       uuid     default null,
  p_love_language   text     default null,
  p_activities      text[]   default null,
  p_goals           text[]   default null,
  p_hometown_cities text[]   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.profiles set
    full_name        = coalesce(p_full_name,     full_name),
    bio              = coalesce(p_bio,            bio),
    hometown         = coalesce(p_hometown,       hometown),
    city             = coalesce(p_city,           city),
    state            = coalesce(p_state,          state),
    life_stage_id    = coalesce(p_life_stage,     life_stage_id),
    church_id        = coalesce(p_church_id,      church_id),
    love_language_id = coalesce(p_love_language,  love_language_id),
    hometown_cities  = case
                         when p_hometown_cities is not null then p_hometown_cities
                         else hometown_cities
                       end,
    last_active_at   = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, unnest(p_activities)
    on conflict do nothing;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, unnest(p_goals)
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[]) to authenticated;


-- ── 3. get_profile_detail — add hometown_cities ───────────────────────────────
-- Exact 0043 logic preserved; only adds hometown_cities to SELECT and RETURNS.

drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
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
  hometown          text,
  hometown_cities   text[],
  political_lean    int,
  same_hometown     boolean,
  score             int,
  connection_count  int,
  group_count       int,
  activities        jsonb,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me  as (select auth.uid() as id),
       me_p as (select id, hometown from public.profiles where id = (select id from me))
  select
    p.id                                                        as profile_id,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                             as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label                                                    as life_stage_label,
    p.church_id,
    ch.name                                                     as church_name,
    p.hometown,
    p.hometown_cities,
    p.political_lean,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                                           as same_hometown,
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
  left join public.churches    ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;
