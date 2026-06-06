-- =============================================================================
-- 0074_hometown_cities_scoring.sql
--
-- Fixes hometown scoring to use the hometown_cities TEXT[] array instead of
-- (only) the single hometown text field.
--
-- Problem: match_score() and get_score_breakdown() compare the hometown TEXT
-- field with exact string equality. This misses:
--   1. "Charleston, SC" vs "Charleston" → no match (same city, different format)
--   2. Cities 2 and 3 from the "From" section are never scored at all.
--
-- Fix: award the 10 hometown pts when ANY city in viewer's hometown_cities
-- overlaps with ANY city in candidate's hometown_cities, after normalizing
-- (lowercase, strip trailing ", ST" state abbreviation). Also keep the old
-- hometown TEXT fallback for users who have that field but not the array.
-- =============================================================================


-- ── Helper: normalize a city string for comparison ───────────────────────
-- Strips ", XX" state suffix, lowercases, trims whitespace.
-- e.g. "Charleston, SC" → "charleston",  "charleston" → "charleston"

create or replace function public.normalize_city(raw text)
returns text language sql immutable as $$
  select lower(trim(regexp_replace(coalesce(raw,''), ',\s*[A-Za-z]{2}$', '')));
$$;


-- ── match_score: use hometown_cities array overlap ────────────────────────

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage         text;
  c_lifestage         text;
  v_hometown          text;
  c_hometown          text;
  v_hometown_cities   text[];
  c_hometown_cities   text[];
  v_political         integer;
  c_political         integer;
  shared_acts         int;
  total_acts          int;
  shared_goals        int;
  total_goals         int;
  shared_vals         int;
  total_vals          int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score          int := 0;
  hometown_match boolean := false;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, hometown_cities, political_lean
    into v_lifestage, v_hometown, v_hometown_cities, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, hometown_cities, political_lean
    into c_lifestage, c_hometown, c_hometown_cities, c_political
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
    score := score + 8;
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

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  -- Primary check: hometown_cities array overlap (normalized, any of the 3 cities)
  if v_hometown_cities is not null and c_hometown_cities is not null then
    select true into hometown_match
    from unnest(v_hometown_cities) vc
    where public.normalize_city(vc) != ''
      and exists (
        select 1 from unnest(c_hometown_cities) cc
        where public.normalize_city(cc) != ''
          and public.normalize_city(vc) = public.normalize_city(cc)
      )
    limit 1;
  end if;
  -- Fallback: legacy hometown text field (covers older profiles)
  if not coalesce(hometown_match, false)
     and v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and public.normalize_city(v_hometown) = public.normalize_city(c_hometown) then
    hometown_match := true;
  end if;
  if coalesce(hometown_match, false) then
    score := score + 10;
  end if;

  -- ── Political lean alignment (+0–10, optional) ───────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;


-- ── get_score_breakdown: same fix ────────────────────────────────────────

create or replace function public.get_score_breakdown(p_viewer uuid, p_candidate uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_lifestage         text;
  c_lifestage         text;
  v_hometown          text;
  c_hometown          text;
  v_hometown_cities   text[];
  c_hometown_cities   text[];
  v_political         integer;
  c_political         integer;

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
  hometown_match boolean := false;

  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
begin
  select life_stage_id, hometown, hometown_cities, political_lean
    into v_lifestage, v_hometown, v_hometown_cities, v_political
    from public.profiles where id = p_viewer;

  select life_stage_id, hometown, hometown_cities, political_lean
    into c_lifestage, c_hometown, c_hometown_cities, c_political
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
  if v_hometown_cities is not null and c_hometown_cities is not null then
    select true into hometown_match
    from unnest(v_hometown_cities) vc
    where public.normalize_city(vc) != ''
      and exists (
        select 1 from unnest(c_hometown_cities) cc
        where public.normalize_city(cc) != ''
          and public.normalize_city(vc) = public.normalize_city(cc)
      )
    limit 1;
  end if;
  if not coalesce(hometown_match, false)
     and v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and public.normalize_city(v_hometown) = public.normalize_city(c_hometown) then
    hometown_match := true;
  end if;
  if coalesce(hometown_match, false) then
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
-- VERIFY (run in Supabase SQL editor after applying):
--   select public.normalize_city('Charleston, SC');   -- → 'charleston'
--   select public.normalize_city('Charleston');       -- → 'charleston'
--   select public.match_score('<viewer_uuid>', '<candidate_uuid>');
-- =============================================================================
