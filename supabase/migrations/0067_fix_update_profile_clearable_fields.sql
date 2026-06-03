-- =============================================================================
-- 0067_fix_update_profile_clearable_fields.sql
--
-- Problems fixed:
--   1. bio/hometown/city/state used COALESCE → clearing them in Edit Profile
--      had no effect (passed null → COALESCE kept old value silently)
--   2. political_lean was saved in a separate profiles.update call with no
--      error handling — collapsed into the main RPC
--
-- Changes:
--   - bio, hometown, city, state: direct assign (null clears the field)
--   - full_name: COALESCE(NULLIF(TRIM(...), ''), existing) — can't be blanked
--   - life_stage_id, church_id, love_language_id: COALESCE (can't be blanked)
--   - political_lean: new param, sentinel -999 = not passed
--   - hometown_cities, looking_for_church: CASE IS NOT NULL (unchanged)
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean);
DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],text[],boolean);
DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean,integer);

CREATE OR REPLACE FUNCTION public.update_profile(
  p_full_name            text     DEFAULT NULL,
  p_bio                  text     DEFAULT NULL,
  p_hometown             text     DEFAULT NULL,
  p_city                 text     DEFAULT NULL,
  p_state                text     DEFAULT NULL,
  p_life_stage           text     DEFAULT NULL,
  p_church_id            uuid     DEFAULT NULL,
  p_love_language        text     DEFAULT NULL,
  p_activities           text[]   DEFAULT NULL,
  p_goals                text[]   DEFAULT NULL,
  p_hometown_cities      text[]   DEFAULT NULL,
  p_looking_for_church   boolean  DEFAULT NULL,
  p_political_lean       integer  DEFAULT -999
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles SET
    -- Non-clearable: keep existing value if null/empty passed
    full_name          = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
    life_stage_id      = COALESCE(p_life_stage,    life_stage_id),
    church_id          = COALESCE(p_church_id,     church_id),
    love_language_id   = COALESCE(p_love_language, love_language_id),

    -- Clearable text: direct assign — passing null explicitly clears the field
    bio                = p_bio,
    hometown           = p_hometown,
    city               = p_city,
    state              = p_state,

    -- Arrays: null = don't touch, [] = clear all
    hometown_cities    = CASE WHEN p_hometown_cities IS NOT NULL THEN p_hometown_cities ELSE hometown_cities END,

    -- Boolean: null = don't touch
    looking_for_church = CASE WHEN p_looking_for_church IS NOT NULL THEN p_looking_for_church ELSE looking_for_church END,

    -- political_lean: sentinel -999 = not passed (keep existing), anything else sets it
    political_lean     = CASE WHEN p_political_lean = -999 THEN political_lean ELSE p_political_lean END,

    last_active_at     = now()
  WHERE id = v_uid;

  IF p_activities IS NOT NULL THEN
    DELETE FROM public.profile_activities WHERE profile_id = v_uid;
    IF array_length(p_activities, 1) IS NOT NULL THEN
      INSERT INTO public.profile_activities (profile_id, activity_id)
      SELECT v_uid, unnest(p_activities)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF p_goals IS NOT NULL THEN
    DELETE FROM public.profile_goals WHERE profile_id = v_uid;
    IF array_length(p_goals, 1) IS NOT NULL THEN
      INSERT INTO public.profile_goals (profile_id, goal_id)
      SELECT v_uid, unnest(p_goals)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile(
  text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean,integer
) TO authenticated;
