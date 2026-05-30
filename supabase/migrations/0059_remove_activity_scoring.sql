-- =============================================================================
-- 0056_remove_activity_scoring.sql
--
-- Removes activities from match_score() per product decision (2026-05-30).
--
-- RATIONALE (Sam's words): Activities aren't what brings people into community —
-- they're just an excuse to get together. Show shared activities on the connect
-- card as "things we have in common", but don't count them toward the score.
--
-- Activities are now display-only. The UI shows which activities you share,
-- highlighted, but they carry 0 weight in ranking.
--
-- REBALANCED weights (old → new):
--   activities     30 → 0   (removed)
--   goals          25 → 35  (+10)
--   life stage     20 → 25  (+5, parent-tier: 8 → 10)
--   family values  15 → 20  (+5)
--   hometown       10 → 10  (unchanged)
--   political      10 → 10  (unchanged, optional)
--   ─────────────────────────
--   Max: 100 (35+25+20+10+10)
--
-- Run after 0055_match_score_overhaul.sql.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = candidate;

  -- ── Goals (Jaccard × 35) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 35)::int;
  end if;

  -- ── Life stage (25 exact | 10 parent-tier partial) ────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 25;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 10;
  end if;

  -- ── Family values (Jaccard × 20) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 20)::int;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean alignment (+0–10, optional) ───────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify: select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================
