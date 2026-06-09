-- =============================================================================
-- 0081_fix_update_profile_missing_params.sql
--
-- Problem: migration 0067 rewrote update_profile but dropped 4 params that
-- EditProfileScreen.js still sends:
--   - p_is_initiator  (boolean)
--   - p_is_outgoing   (boolean)
--   - p_school_type   (text)
--   - p_values        (text[])
--
-- Postgres resolves RPCs by named-param signature, so the call failed with
-- "could not find the function public.update_profile(...)" for all saves.
--
-- Fix: drop the 13-param overload, replace with complete 17-param version.
-- =============================================================================

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
  p_school_type          text     DEFAULT NULL,
  p_is_initiator         boolean  DEFAULT NULL,
  p_is_outgoing          boolean  DEFAULT NULL,
  p_activities           text[]   DEFAULT NULL,
  p_goals                text[]   DEFAULT NULL,
  p_values               text[]   DEFAULT NULL,
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
    -- Non-clearable: keep existing if null/empty
    full_name          = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
    life_stage_id      = COALESCE(p_life_stage,    life_stage_id),
    church_id          = COALESCE(p_church_id,     church_id),
    love_language_id   = COALESCE(p_love_language, love_language_id),
    school_type_id     = COALESCE(p_school_type,   school_type_id),
    is_initiator       = COALESCE(p_is_initiator,  is_initiator),
    is_outgoing        = COALESCE(p_is_outgoing,   is_outgoing),

    -- Clearable text: direct assign (null clears the field)
    bio                = p_bio,
    hometown           = p_hometown,
    city               = p_city,
    state              = p_state,

    -- Arrays: null = don't touch
    hometown_cities    = CASE WHEN p_hometown_cities IS NOT NULL THEN p_hometown_cities ELSE hometown_cities END,

    -- Boolean: null = don't touch
    looking_for_church = CASE WHEN p_looking_for_church IS NOT NULL THEN p_looking_for_church ELSE looking_for_church END,

    -- political_lean: sentinel -999 = not passed (keep existing)
    political_lean     = CASE WHEN p_political_lean = -999 THEN political_lean ELSE p_political_lean END,

    last_active_at     = now()
  WHERE id = v_uid;

  -- Activities: non-null = replace
  IF p_activities IS NOT NULL THEN
    DELETE FROM public.profile_activities WHERE profile_id = v_uid;
    IF array_length(p_activities, 1) IS NOT NULL THEN
      INSERT INTO public.profile_activities (profile_id, activity_id)
      SELECT v_uid, unnest(p_activities)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Goals: non-null = replace
  IF p_goals IS NOT NULL THEN
    DELETE FROM public.profile_goals WHERE profile_id = v_uid;
    IF array_length(p_goals, 1) IS NOT NULL THEN
      INSERT INTO public.profile_goals (profile_id, goal_id)
      SELECT v_uid, unnest(p_goals)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Values: non-null = replace
  IF p_values IS NOT NULL THEN
    DELETE FROM public.profile_values WHERE profile_id = v_uid;
    IF array_length(p_values, 1) IS NOT NULL THEN
      INSERT INTO public.profile_values (profile_id, value_id)
      SELECT v_uid, unnest(p_values)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile(
  text,text,text,text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],text[],boolean,integer
) TO authenticated;
