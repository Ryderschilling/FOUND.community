-- =============================================================================
-- 0057_score_tuning.sql
--
-- Adjustments to match_score():
--   1. Life stage: 20 → 25 (exact match), 8 → 10 (parent-tier partial)
--   2. School type: +10 flat bonus — exact match, only when BOTH users are
--      parent life stages. Irrelevant for non-parents.
--
-- No changes to activities, goals, family values, hometown, political lean,
-- or denomination weights.
--
-- Max possible raw: 120 + 10 (school type) = 130, clamped to 100.
--
-- Run AFTER 0056_denomination.sql.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
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
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean, denomination_id, school_type_id
    into v_lifestage, v_hometown, v_political, v_denom, v_school
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean, denomination_id, school_type_id
    into c_lifestage, c_hometown, c_political, c_denom, c_school
    from public.profiles where id = candidate;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life stage (25 exact | 10 parent-tier partial) ────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 25;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 10;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── School type (+10, parents only) ──────────────────────────────────────
  -- Only fires when both users are in a parent life stage AND both answered.
  if v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages)
     and v_school is not null and c_school is not null
     and v_school = c_school then
    score := score + 10;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  -- ── Denomination exact match (+10, optional) ──────────────────────────────
  if v_denom is not null and c_denom is not null and v_denom = c_denom then
    score := score + 10;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Updated weights summary:
--   30  activities     (Jaccard × 30)
--   25  goals          (Jaccard × 25)
--   25  life stage     (exact) / 10 (parent-tier partial)  ← bumped from 20/8
--   15  family values  (Jaccard × 15)
--   10  hometown       (exact bonus)
--   10  denomination   (exact bonus, optional)
--   10  school type    (exact bonus, parent life stages only, optional)
--    10 political lean (0–10 gradient, optional)
--   ──────────────────────────────────────────────────────
--   Max raw: 135, clamped to 100
--
-- Verify:
--   select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================
