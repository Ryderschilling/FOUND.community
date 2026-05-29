-- =============================================================================
-- 0062_score_breakdown.sql
--
-- get_score_breakdown(p_viewer uuid, p_candidate uuid)
--   Returns a jsonb object with the individual point contributions that make
--   up the match_score(), so the client can show users exactly why they
--   scored X% with someone.
--
--   Return shape:
--   {
--     "interests":  { "pts": 18, "max": 30, "shared": 3, "total": 5 },
--     "goals":      { "pts": 20, "max": 25, "shared": 4, "total": 5 },
--     "life_stage": { "pts": 20, "max": 20 },
--     "values":     { "pts":  8, "max": 15, "shared": 2, "total": 4 },
--     "hometown":   { "pts": 10, "max": 10 },
--     "political":  { "pts":  7, "max": 10 }
--   }
--
--   Weights match match_score() in 0055_match_score_overhaul.sql:
--     30 interests + 25 goals + 20 life_stage + 15 values + 10 hometown + 10 political
--     Capped at 100 total.
--
-- Run AFTER 0061.
-- =============================================================================

create or replace function public.get_score_breakdown(p_viewer uuid, p_candidate uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
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
begin
  -- ── Fetch base profile fields ──────────────────────────────────────────────
  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = p_viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = p_candidate;

  -- ── Interests (Jaccard × 30) ───────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = p_viewer and pa2.profile_id = p_candidate;

  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (p_viewer, p_candidate);

  if total_acts > 0 then
    interests_pts := (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = p_viewer and pg2.profile_id = p_candidate;

  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (p_viewer, p_candidate);

  if total_goals > 0 then
    goals_pts := (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life Stage (20 exact | 8 both-parents) ────────────────────────────────
  if v_lifestage is not null and c_lifestage is not null then
    if v_lifestage = c_lifestage then
      stage_pts := 20;
    elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
      stage_pts := 8;
    end if;
  end if;

  -- ── Family Values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = p_viewer and pv2.profile_id = p_candidate;

  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (p_viewer, p_candidate);

  if total_vals > 0 then
    values_pts := (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown bonus (10 pts) ───────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and lower(trim(v_hometown)) = lower(trim(c_hometown)) then
    hometown_pts := 10;
  end if;

  -- ── Political lean (0-10 pts, only when both set) ─────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    political_pts  := greatest(0, (10 * (1 - political_diff / 200.0))::int);
  end if;

  return jsonb_build_object(
    'interests',  jsonb_build_object(
                    'pts', interests_pts, 'max', 30,
                    'shared', shared_acts, 'total', total_acts),
    'goals',      jsonb_build_object(
                    'pts', goals_pts, 'max', 25,
                    'shared', shared_goals, 'total', total_goals),
    'life_stage', jsonb_build_object('pts', stage_pts, 'max', 20),
    'values',     jsonb_build_object(
                    'pts', values_pts, 'max', 15,
                    'shared', shared_vals, 'total', total_vals),
    'hometown',   jsonb_build_object('pts', hometown_pts, 'max', 10),
    'political',  jsonb_build_object('pts', political_pts, 'max', 10)
  );
end;
$$;

grant execute on function public.get_score_breakdown(uuid, uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select get_score_breakdown('<viewer_uuid>', '<candidate_uuid>');
-- =============================================================================
