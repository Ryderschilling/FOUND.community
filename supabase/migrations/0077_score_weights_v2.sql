-- =============================================================================
-- 0077_score_weights_v2.sql
--
-- Sam's weight update (2026-06-06):
--   Life Stage → 25 (exact) / 10 (parent-tier partial)   ← was 50/20
--   Values     → 20 (Jaccard × 20)                        ← was 10
--   Goals      → 15 (Jaccard × 15)                        ← unchanged
--   Activities → 30 (Jaccard × 30)                        ← was 20
--   Denomination → 8 exact bonus                          ← unchanged
--   Hometown     → 8 exact bonus                          ← unchanged
--   School type  → 7 (parents only)                       ← unchanged
--   Political    → 0–10 gradient                          ← unchanged
--   ──────────────────────────────────────────────────────
--   Max raw: 25+30+15+20+8+8+7+10 = 123, clamped to 100
--
-- Also updates get_score_breakdown() to match so UI display stays in sync.
--
-- Run AFTER 0076.
-- =============================================================================

-- ── 1. match_score() ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_score(viewer uuid, candidate uuid)
RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lifestage    text;
  c_lifestage    text;
  v_hometown     text;
  c_hometown     text;
  v_political    integer;
  c_political    integer;
  v_denom        text;
  c_denom        text;
  v_school       text;
  c_school       text;
  shared_acts    int;
  total_acts     int;
  shared_goals   int;
  total_goals    int;
  shared_vals    int;
  total_vals     int;
  parent_stages  text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score          int := 0;
BEGIN
  IF viewer = candidate THEN RETURN 100; END IF;

  SELECT life_stage_id, hometown, political_lean, denomination_id, school_type_id
    INTO v_lifestage, v_hometown, v_political, v_denom, v_school
    FROM public.profiles WHERE id = viewer;

  SELECT life_stage_id, hometown, political_lean, denomination_id, school_type_id
    INTO c_lifestage, c_hometown, c_political, c_denom, c_school
    FROM public.profiles WHERE id = candidate;

  -- ── Life stage (25 exact | 10 parent-tier partial) ────────────────────────
  IF v_lifestage IS NOT NULL AND v_lifestage = c_lifestage THEN
    score := score + 25;
  ELSIF v_lifestage = ANY(parent_stages) AND c_lifestage = ANY(parent_stages) THEN
    score := score + 10;
  END IF;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  SELECT count(*) INTO shared_acts
    FROM public.profile_activities pa1
    JOIN public.profile_activities pa2 ON pa1.activity_id = pa2.activity_id
    WHERE pa1.profile_id = viewer AND pa2.profile_id = candidate;
  SELECT count(DISTINCT activity_id) INTO total_acts
    FROM public.profile_activities
    WHERE profile_id IN (viewer, candidate);
  IF total_acts > 0 THEN
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  END IF;

  -- ── Goals (Jaccard × 15) ──────────────────────────────────────────────────
  SELECT count(*) INTO shared_goals
    FROM public.profile_goals pg1
    JOIN public.profile_goals pg2 ON pg1.goal_id = pg2.goal_id
    WHERE pg1.profile_id = viewer AND pg2.profile_id = candidate;
  SELECT count(DISTINCT goal_id) INTO total_goals
    FROM public.profile_goals
    WHERE profile_id IN (viewer, candidate);
  IF total_goals > 0 THEN
    score := score + (shared_goals::numeric / total_goals * 15)::int;
  END IF;

  -- ── Family values (Jaccard × 20) ──────────────────────────────────────────
  SELECT count(*) INTO shared_vals
    FROM public.profile_values pv1
    JOIN public.profile_values pv2 ON pv1.value_id = pv2.value_id
    WHERE pv1.profile_id = viewer AND pv2.profile_id = candidate;
  SELECT count(DISTINCT value_id) INTO total_vals
    FROM public.profile_values
    WHERE profile_id IN (viewer, candidate);
  IF total_vals > 0 THEN
    score := score + (shared_vals::numeric / total_vals * 20)::int;
  END IF;

  -- ── Denomination exact match (+8, optional) ───────────────────────────────
  IF v_denom IS NOT NULL AND c_denom IS NOT NULL AND v_denom = c_denom THEN
    score := score + 8;
  END IF;

  -- ── Hometown (+8) ─────────────────────────────────────────────────────────
  IF v_hometown IS NOT NULL AND c_hometown IS NOT NULL
     AND length(btrim(v_hometown)) > 0
     AND lower(btrim(v_hometown)) = lower(btrim(c_hometown)) THEN
    score := score + 8;
  END IF;

  -- ── School type (+7, parents only) ───────────────────────────────────────
  IF v_lifestage = ANY(parent_stages) AND c_lifestage = ANY(parent_stages)
     AND v_school IS NOT NULL AND c_school IS NOT NULL
     AND v_school = c_school THEN
    score := score + 7;
  END IF;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  IF v_political IS NOT NULL AND c_political IS NOT NULL THEN
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  END IF;

  RETURN greatest(0, least(100, score));
END $$;

-- ── 2. get_score_breakdown() — UI display, must match match_score() ───────────
CREATE OR REPLACE FUNCTION public.get_score_breakdown(p_viewer uuid, p_candidate uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;

  shared_acts   int := 0;
  total_acts    int := 0;
  shared_goals  int := 0;
  total_goals   int := 0;
  shared_vals   int := 0;
  total_vals    int := 0;

  interests_pts  int := 0;
  goals_pts      int := 0;
  stage_pts      int := 0;
  values_pts     int := 0;
  hometown_pts   int := 0;
  political_pts  int := 0;
  political_diff numeric := 0;

  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
BEGIN
  SELECT life_stage_id, hometown, political_lean
    INTO v_lifestage, v_hometown, v_political
    FROM public.profiles WHERE id = p_viewer;

  SELECT life_stage_id, hometown, political_lean
    INTO c_lifestage, c_hometown, c_political
    FROM public.profiles WHERE id = p_candidate;

  -- ── Interests (Jaccard × 30) ───────────────────────────────────────────────
  SELECT count(*) INTO shared_acts
    FROM public.profile_activities pa1
    JOIN public.profile_activities pa2 ON pa1.activity_id = pa2.activity_id
    WHERE pa1.profile_id = p_viewer AND pa2.profile_id = p_candidate;
  SELECT count(DISTINCT activity_id) INTO total_acts
    FROM public.profile_activities
    WHERE profile_id IN (p_viewer, p_candidate);
  IF total_acts > 0 THEN
    interests_pts := (shared_acts::numeric / total_acts * 30)::int;
  END IF;

  -- ── Goals (Jaccard × 15) ──────────────────────────────────────────────────
  SELECT count(*) INTO shared_goals
    FROM public.profile_goals pg1
    JOIN public.profile_goals pg2 ON pg1.goal_id = pg2.goal_id
    WHERE pg1.profile_id = p_viewer AND pg2.profile_id = p_candidate;
  SELECT count(DISTINCT goal_id) INTO total_goals
    FROM public.profile_goals
    WHERE profile_id IN (p_viewer, p_candidate);
  IF total_goals > 0 THEN
    goals_pts := (shared_goals::numeric / total_goals * 15)::int;
  END IF;

  -- ── Life Stage (25 exact | 10 both-parents) ───────────────────────────────
  IF v_lifestage IS NOT NULL AND c_lifestage IS NOT NULL THEN
    IF v_lifestage = c_lifestage THEN
      stage_pts := 25;
    ELSIF v_lifestage = ANY(parent_stages) AND c_lifestage = ANY(parent_stages) THEN
      stage_pts := 10;
    END IF;
  END IF;

  -- ── Family Values (Jaccard × 20) ──────────────────────────────────────────
  SELECT count(*) INTO shared_vals
    FROM public.profile_values pv1
    JOIN public.profile_values pv2 ON pv1.value_id = pv2.value_id
    WHERE pv1.profile_id = p_viewer AND pv2.profile_id = p_candidate;
  SELECT count(DISTINCT value_id) INTO total_vals
    FROM public.profile_values
    WHERE profile_id IN (p_viewer, p_candidate);
  IF total_vals > 0 THEN
    values_pts := (shared_vals::numeric / total_vals * 20)::int;
  END IF;

  -- ── Hometown bonus (8 pts) ────────────────────────────────────────────────
  IF v_hometown IS NOT NULL AND c_hometown IS NOT NULL
     AND lower(trim(v_hometown)) = lower(trim(c_hometown)) THEN
    hometown_pts := 8;
  END IF;

  -- ── Political lean (0–10 pts) ─────────────────────────────────────────────
  IF v_political IS NOT NULL AND c_political IS NOT NULL THEN
    political_diff := abs(v_political - c_political);
    political_pts  := greatest(0, (10 * (1 - political_diff / 200.0))::int);
  END IF;

  RETURN jsonb_build_object(
    'interests',  jsonb_build_object(
                    'pts', interests_pts, 'max', 30,
                    'shared', shared_acts, 'total', total_acts),
    'goals',      jsonb_build_object(
                    'pts', goals_pts, 'max', 15,
                    'shared', shared_goals, 'total', total_goals),
    'life_stage', jsonb_build_object('pts', stage_pts, 'max', 25),
    'values',     jsonb_build_object(
                    'pts', values_pts, 'max', 20,
                    'shared', shared_vals, 'total', total_vals),
    'hometown',   jsonb_build_object('pts', hometown_pts, 'max', 8),
    'political',  jsonb_build_object('pts', political_pts, 'max', 10)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_score_breakdown(uuid, uuid) TO authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select public.match_score('<uuid_a>', '<uuid_b>');
--   select get_score_breakdown('<viewer>', '<candidate>');
-- =============================================================================
