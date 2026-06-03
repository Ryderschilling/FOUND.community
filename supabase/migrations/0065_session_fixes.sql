-- =============================================================================
-- 0065_session_fixes.sql
--
-- Batch of fixes from 6-2-26 review session with Sam:
--
--  1. profiles.looking_for_church  (bool, nullable)
--  2. update_profile()             — canonical drop-all + recreate w/ looking_for_church
--  3. complete_onboarding()        — add p_looking_for_church
--  4. get_profile_detail()         — return looking_for_church
--  5. match_score()                — political: same side only (both>0 or both<0 = +10)
--  6. my_groups_feed()             — add has_pending_invite field
--  7. my_threads_detailed()        — add last_message_is_mine bool
--
-- Run AFTER 0064.
-- =============================================================================

-- ── 1. looking_for_church column ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists looking_for_church boolean default null;


-- ── 2. update_profile — canonical, drop ALL overloads ────────────────────────
-- Drop every known overload before recreating so Postgres doesn't error on
-- ambiguous resolution.
drop function if exists public.update_profile(text,text,text,text,text,uuid,text,text,boolean,boolean,text,text[],text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,uuid,text,text[],text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[]);

create or replace function public.update_profile(
  p_full_name            text     default null,
  p_bio                  text     default null,
  p_hometown             text     default null,
  p_city                 text     default null,
  p_state                text     default null,
  p_life_stage           text     default null,
  p_church_id            uuid     default null,
  p_love_language        text     default null,
  p_activities           text[]   default null,
  p_goals                text[]   default null,
  p_hometown_cities      text[]   default null,
  p_hometown_cities_norm text[]   default null,
  p_looking_for_church   boolean  default null
)
returns void
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
    full_name              = coalesce(p_full_name,           full_name),
    bio                    = coalesce(p_bio,                 bio),
    hometown               = coalesce(p_hometown,            hometown),
    city                   = coalesce(p_city,                city),
    state                  = coalesce(p_state,               state),
    life_stage_id          = coalesce(p_life_stage,          life_stage_id),
    church_id              = coalesce(p_church_id,           church_id),
    love_language_id       = coalesce(p_love_language,       love_language_id),
    hometown_cities        = case when p_hometown_cities     is not null then p_hometown_cities     else hometown_cities     end,
    looking_for_church     = case when p_looking_for_church  is not null then p_looking_for_church  else looking_for_church  end,
    last_active_at         = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, unnest(p_activities)
      on conflict do nothing;
    end if;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, unnest(p_goals)
      on conflict do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.update_profile(
  text,text,text,text,text,text,uuid,text,text[],text[],text[],text[],boolean
) to authenticated;
-- Also allow calling without the last two optional params (older clients)



-- ── 3. complete_onboarding — add p_looking_for_church ────────────────────────
-- Drop all known overloads before recreating.
drop function if exists public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer
);
drop function if exists public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer,text
);
drop function if exists public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer,text,boolean
);

create or replace function public.complete_onboarding(
  p_life_stage          text,
  p_school_type         text,
  p_love_language       text,
  p_church_id           uuid,
  p_city                text,
  p_state               text,
  p_is_initiator        boolean,
  p_is_outgoing         boolean,
  p_activities          text[],
  p_goals               text[],
  p_values              text[],
  p_political_lean      integer  default null,
  p_denomination_id     text     default null,
  p_looking_for_church  boolean  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  update public.profiles set
    life_stage_id        = p_life_stage,
    school_type_id       = p_school_type,
    love_language_id     = p_love_language,
    church_id            = p_church_id,
    city                 = p_city,
    state                = p_state,
    is_initiator         = p_is_initiator,
    is_outgoing          = p_is_outgoing,
    political_lean       = p_political_lean,
    denomination_id      = coalesce(p_denomination_id, denomination_id),
    looking_for_church   = p_looking_for_church,
    onboarding_complete  = true,
    last_active_at       = now()
  where id = v_uid;

  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities,1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals,1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values,1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer,text,boolean
) to authenticated;


-- ── 4. get_profile_detail — add looking_for_church ───────────────────────────
drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id            uuid,
  full_name             text,
  handle                text,
  bio                   text,
  city                  text,
  state                 text,
  avatar_url            text,
  life_stage_id         text,
  life_stage_label      text,
  church_id             uuid,
  church_name           text,
  hometown              text,
  hometown_cities       text[],
  political_lean        int,
  same_hometown         boolean,
  looking_for_church    boolean,
  score                 int,
  connection_count      int,
  group_count           int,
  activities            jsonb,
  my_kind               public.connection_kind,
  their_kind            public.connection_kind,
  is_match              boolean
)
language sql stable
set search_path = public
as $$
  with me   as (select auth.uid() as id),
       me_p as (select id, hometown from public.profiles where id = (select id from me))
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs->>'show_location')::boolean, true) then p.city  else null end,
    case when coalesce((p.privacy_prefs->>'show_location')::boolean, true) then p.state else null end,
    p.avatar_url,
    p.life_stage_id,
    ls.label,
    p.church_id,
    ch.name,
    p.hometown,
    p.hometown_cities,
    p.political_lean,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    ),
    p.looking_for_church,
    public.match_score((select id from me), p.id),
    (
      select count(*)::int from public.connections c1
      join public.connections c2 on c2.from_profile=c1.to_profile and c2.to_profile=c1.from_profile and c2.kind='like'
      where c1.from_profile=p.id and c1.kind='like'
    ),
    (select count(*)::int from public.group_members gm where gm.profile_id=p.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'icon',a.icon) order by a.label)
      from public.profile_activities pa join public.activities a on a.id=pa.activity_id
      where pa.profile_id=p.id
    ), '[]'::jsonb),
    (select kind from public.connections m where m.from_profile=(select id from me) and m.to_profile=p.id
     order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end limit 1),
    (select kind from public.connections t where t.from_profile=p.id and t.to_profile=(select id from me)
     order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end limit 1),
    (
      exists(select 1 from public.connections m where m.from_profile=(select id from me) and m.to_profile=p.id and m.kind='like')
      and exists(select 1 from public.connections t where t.from_profile=p.id and t.to_profile=(select id from me) and t.kind='like')
    )
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- ── 5. match_score — political: same side only ───────────────────────────────
-- OLD: linear scale on abs difference (0-diff=10, 200-diff=0) → moderate matched everyone
-- NEW: +10 only when both positive (conservative) OR both negative (liberal).
--      Moderate (0) matches no one. Opposite sides = 0.
create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies','married-young','married-teens','married-mixed'
  ];
  score int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = candidate;

  -- Activities (Jaccard × 30)
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id=pa2.activity_id
    where pa1.profile_id=viewer and pa2.profile_id=candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities where profile_id in (viewer,candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- Goals (Jaccard × 25)
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id=pg2.goal_id
    where pg1.profile_id=viewer and pg2.profile_id=candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals where profile_id in (viewer,candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- Life stage (20 exact | 8 parent partial)
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 8;
  end if;

  -- Family values (Jaccard × 15)
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id=pv2.value_id
    where pv1.profile_id=viewer and pv2.profile_id=candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values where profile_id in (viewer,candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- Hometown (+10)
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- Political lean (+10) — same side ONLY. Moderate (0) matches nobody.
  if v_political is not null and c_political is not null then
    if (v_political > 0 and c_political > 0)
    or (v_political < 0 and c_political < 0) then
      score := score + 10;
    end if;
  end if;

  return greatest(0, least(100, score));
end $$;


-- ── 6. my_groups_feed — add has_pending_invite ───────────────────────────────
drop function if exists public.my_groups_feed();

create or replace function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean,
  has_pending_invite  boolean
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1)    as cover_path,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=(select id from me))    as is_member,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=(select id from me))      as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=(select id from me)
             and gi.status='pending')                                        as has_pending_invite
  from public.groups g
  -- Include all public groups + any group the user is a member of + any group they've been invited to
  where g.is_public
     or exists(select 1 from public.group_members gm
               where gm.group_id=g.id and gm.profile_id=(select id from me))
     or exists(select 1 from public.group_invites gi
               where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
  order by
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=(select id from me))
         then 0
         when exists(select 1 from public.group_invites gi
                     where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
         then 1
         else 2 end,
    g.member_count desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- ── 7. my_threads_detailed — add last_message_is_mine ───────────────────────
-- Drops the latest overload (from 0051) and recreates with the extra field.
drop function if exists public.my_threads_detailed();

create or replace function public.my_threads_detailed()
returns table (
  thread_id            uuid,
  kind                 text,
  group_id             uuid,
  other_profile_id     uuid,
  other_full_name      text,
  other_handle         text,
  other_avatar_url     text,
  last_message_at      timestamptz,
  last_message_body    text,
  last_message_sender  uuid,
  last_message_is_mine boolean,
  last_read_at         timestamptz,
  unread_count         bigint
)
language sql stable
set search_path = public
as $$
  with
    me as (select auth.uid() as id),
    my_threads as (
      select tp.thread_id, tp.last_read_at
      from public.thread_participants tp where tp.profile_id = (select id from me)
    ),
    other_party as (
      select tp.thread_id,
             p.id           as other_id,
             p.full_name    as other_name,
             p.handle       as other_handle,
             p.avatar_url   as other_avatar_url
      from public.thread_participants tp
      join public.profiles p on p.id = tp.profile_id
      where tp.profile_id <> (select id from me)
    ),
    last_msg as (
      select distinct on (m.thread_id)
             m.thread_id,
             m.body,
             m.sender_id,
             (m.sender_id = (select id from me)) as is_mine
      from public.messages m
      order by m.thread_id, m.created_at desc
    ),
    unread as (
      select m.thread_id, count(*) as cnt
      from public.messages m
      join my_threads mt on mt.thread_id = m.thread_id
      where m.sender_id <> (select id from me)
        and (mt.last_read_at is null or m.created_at > mt.last_read_at)
      group by m.thread_id
    )
  select t.id,
         t.kind::text,
         t.group_id,
         case when t.kind='group' then null else op.other_id          end,
         case when t.kind='group' then g.name else op.other_name      end,
         case when t.kind='group' then null else op.other_handle      end,
         case when t.kind='group' then null else op.other_avatar_url  end,
         t.last_message_at,
         lm.body,
         lm.sender_id,
         coalesce(lm.is_mine, false),
         mt.last_read_at,
         coalesce(u.cnt, 0)
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread        u   on u.thread_id  = t.id
  left join public.groups g   on g.id = t.group_id
  where t.kind = 'group'
     or op.other_id is null
     or not exists (
       select 1 from public.connections b
       where b.kind = 'block'
         and (
           (b.from_profile = (select id from me) and b.to_profile = op.other_id)
           or (b.from_profile = op.other_id and b.to_profile = (select id from me))
         )
     )
  order by t.last_message_at desc nulls last, t.created_at desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;

-- ── 8. group_detail — add has_pending_invite ─────────────────────────────
-- Allows GroupDetailScreen to show "Accept Invite" button for invited users.
drop function if exists public.group_detail(uuid);

create or replace function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean,
  has_pending_invite  boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=auth.uid())
         then g.address else null end as address,
    g.schedule_text, g.member_count, g.church_id, g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
     where gm.group_id=g.id and gm.profile_id=auth.uid()) as my_role,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=auth.uid()) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=auth.uid()
             and gi.status='pending') as has_pending_invite
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select looking_for_church from profiles limit 3;
--   select has_pending_invite from my_groups_feed() limit 3;
--   select last_message_is_mine from my_threads_detailed() limit 3;
-- =============================================================================
