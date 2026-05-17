-- =============================================================================
-- 0009_update_profile.sql
-- Lightweight profile-editing RPC for the Edit Profile screen.
--
-- All params are nullable: pass NULL to leave a field unchanged.
-- Array params, when passed, REPLACE the existing set (matches onboarding).
-- Pass an empty array to clear a set; NULL to leave it as-is.
-- =============================================================================

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
  -- arrays: NULL = leave unchanged; non-NULL (even empty) = replace
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
    life_stage_id    = coalesce(p_life_stage,    life_stage_id),
    church_id        = coalesce(p_church_id,     church_id),
    love_language_id = coalesce(p_love_language, love_language_id),
    school_type_id   = coalesce(p_school_type,   school_type_id),
    is_initiator     = coalesce(p_is_initiator,  is_initiator),
    is_outgoing      = coalesce(p_is_outgoing,   is_outgoing),
    last_active_at   = now()
  where id = v_uid;

  -- Activities: replace if passed
  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, x from unnest(p_activities) as x
      on conflict do nothing;
    end if;
  end if;

  -- Goals
  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, x from unnest(p_goals) as x
      on conflict do nothing;
    end if;
  end if;

  -- Values
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
  text, text, text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[]
) to authenticated;
