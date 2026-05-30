-- =============================================================================
-- 0054_political_lean.sql
--
-- 1) Adds `political_lean` integer column to profiles.
--    Range: -100 (hard left) to 100 (hard right). NULL = skipped (optional).
--
-- 2) Replaces `complete_onboarding` to accept the new param.
--    Old signature is dropped first (param count changed).
--
-- Idempotent. Safe to re-run.
-- Run AFTER 0053.
-- =============================================================================

-- ─── 1) Column ───────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists political_lean integer
  check (political_lean is null or (political_lean between -100 and 100));


-- ─── 2) complete_onboarding (new signature) ──────────────────────────────────
-- Drop old signature (param count changed — Postgres won't overload-resolve).
drop function if exists public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[]
);

create or replace function public.complete_onboarding(
  p_life_stage     text,
  p_school_type    text,
  p_love_language  text,
  p_church_id      uuid,
  p_city           text,
  p_state          text,
  p_is_initiator   boolean,
  p_is_outgoing    boolean,
  p_activities     text[],
  p_goals          text[],
  p_values         text[],
  p_political_lean integer default null
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
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = p_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    political_lean      = p_political_lean,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x
    on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x
    on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[], integer
) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select column_name from information_schema.columns
--     where table_name = 'profiles' and column_name = 'political_lean';
--   select proname from pg_proc where proname = 'complete_onboarding';
-- =============================================================================
