-- =============================================================================
-- 0055_match_score_overhaul.sql
--
-- Rewrites match_score() with better signal weighting.
--
-- OLD weights (broken):
--   30 activities + 30 goals + 25 life_stage + 15 proximity + 10 hometown = 110 → 100
--   Problem: proximity double-counts the discovery filter; family values collected
--   but worth 0 pts; life stage is exact-only (no partial credit for parents).
--
-- NEW weights:
--   30 pts  activities     (Jaccard × 30)
--   25 pts  goals          (Jaccard × 25)
--   20 pts  life stage     (20 exact | 8 "both parents, any age")
--   15 pts  family values  (Jaccard × 15) ← WAS 0, now scored
--   10 pts  hometown       (bonus)
--   10 pts  political lean (optional — only when both set, 0-diff = 10, 200-diff = 0)
--   ─────────────────
--   110 max, clamped to 100
--
-- Drops proximity from score. Rationale: proximity is already the discovery
-- filter (radius gate). Once someone is inside your radius, distance is not
-- a compatibility signal — it's a logistics detail.
--
-- Run AFTER 0054_political_lean.sql.
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
  shared_acts   int;
  total_acts    int;
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

  -- ── Life stage (20 exact | 8 parent-tier partial) ─────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    -- Both are parents regardless of kids' ages → meaningful partial overlap.
    score := score + 8;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  -- Only counts when at least one person has values set. If neither filled it
  -- out, skip rather than penalizing both — it's optional.
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

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean alignment (+0–10, optional) ───────────────────────────
  -- Only fires when BOTH users answered. Max diff = 200 (-100 vs +100).
  -- Linear scale: 0-diff → +10, 200-diff → +0.
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify by running against two real profiles in Supabase SQL editor:
--   select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================
