-- =============================================================================
-- 0066_fix_update_profile_overloads.sql
--
-- The update_profile function has accumulated overloads across migrations
-- 0009, 0041, 0064, 0065. When multiple overloads exist with overlapping
-- parameter names, Postgres throws "could not choose best candidate function".
--
-- Fix: dynamically drop ALL overloads, then recreate the single canonical
-- version that EditProfileScreen actually calls.
--
-- Run AFTER 0065.
-- =============================================================================

-- ── 1. Drop every overload of update_profile ─────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_profile'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;


-- ── 2. Canonical update_profile ───────────────────────────────────────────────
-- Single definitive version. All named params match exactly what
-- EditProfileScreen passes via supabase.rpc('update_profile', { ... }).
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
    full_name          = coalesce(p_full_name,    full_name),
    bio                = coalesce(p_bio,           bio),
    hometown           = coalesce(p_hometown,      hometown),
    city               = coalesce(p_city,          city),
    state              = coalesce(p_state,         state),
    life_stage_id      = coalesce(p_life_stage,    life_stage_id),
    church_id          = coalesce(p_church_id,     church_id),
    love_language_id   = coalesce(p_love_language, love_language_id),
    hometown_cities    = case
                           when p_hometown_cities is not null then p_hometown_cities
                           else hometown_cities
                         end,
    looking_for_church = case
                           when p_looking_for_church is not null then p_looking_for_church
                           else looking_for_church
                         end,
    last_active_at     = now()
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
  text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean
) to authenticated;

-- =============================================================================
-- DONE.
-- Verify no overload ambiguity:
--   select count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'update_profile';
--   -- should return 1
-- =============================================================================
