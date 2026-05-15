-- =============================================================================
-- 0003: Personality columns + complete_onboarding RPC
-- Run AFTER 0001_init.sql and 0002_seed_taxonomies.sql.
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------- Add personality bool columns to profiles -------------------------
-- Collected in the onboarding "personality" step (initiator? outgoing?).
alter table public.profiles
  add column if not exists is_initiator boolean,
  add column if not exists is_outgoing  boolean;

-- =============================================================================
-- complete_onboarding(...)
--   Single-transaction submit for the onboarding flow.
--   Updates the caller's profile row + replaces their M:M taxonomy rows
--   (activities, goals, values) atomically. Sets onboarding_complete = true so
--   the navigator routes the user past Onboarding on next render.
--
--   security definer so the function runs with elevated privileges to bypass
--   the RLS deletes on profile_activities/goals/values — auth.uid() is hardcoded
--   so callers can only ever modify their own rows.
-- =============================================================================
create or replace function public.complete_onboarding(
  p_life_stage    text,
  p_school_type   text,
  p_love_language text,
  p_church_id     uuid,
  p_city          text,
  p_state         text,
  p_is_initiator  boolean,
  p_is_outgoing   boolean,
  p_activities    text[],
  p_goals         text[],
  p_values        text[]
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

  -- Core profile row
  update public.profiles set
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = p_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  -- Replace activities (delete + insert; supports re-running onboarding)
  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x
    on conflict do nothing;
  end if;

  -- Replace goals
  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x
    on conflict do nothing;
  end if;

  -- Replace values
  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[]
) to authenticated;

-- =============================================================================
-- DONE. Verify with: select proname from pg_proc where proname = 'complete_onboarding';
-- =============================================================================
