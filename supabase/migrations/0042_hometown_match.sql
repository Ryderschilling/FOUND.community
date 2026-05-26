-- =============================================================================
-- 0042_hometown_match.sql
--
-- Wires hometown into the match score.
--
-- Adds a +10 bonus when viewer.hometown and candidate.hometown match
-- (case-insensitive, whitespace-trimmed, both non-null).
--
-- Pre-change weights:  30 acts + 30 goals + 25 life_stage + 15 proximity = 100
-- New weights:         + 10 hometown = 110, clamped to 100.
--
-- Intentional that the total exceeds 100 — hometown is a tiebreaker that
-- lifts otherwise-mediocre matches and lets strong matches still cap at 100.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_radius_mi   int;
  v_loc         geography;
  c_loc         geography;
  dist_mi       numeric;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, match_radius_mi, location
    into v_lifestage, v_hometown, v_radius_mi, v_loc
    from public.profiles where id = viewer;
  select life_stage_id, hometown, location
    into c_lifestage, c_hometown, c_loc
    from public.profiles where id = candidate;

  -- Activities overlap (Jaccard scaled to 30)
  select count(*) into shared_acts from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- Goals overlap (scaled to 30)
  select count(*) into shared_goals from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 30)::int;
  end if;

  -- Life stage exact match (25)
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 25;
  end if;

  -- Proximity (15) — linear falloff within radius
  if v_loc is not null and c_loc is not null and v_radius_mi is not null then
    dist_mi := ST_Distance(v_loc, c_loc) / 1609.34;
    if dist_mi <= v_radius_mi then
      score := score + (15 * (1 - (dist_mi / nullif(v_radius_mi, 0))))::int;
    end if;
  end if;

  -- Hometown match (+10) — case-insensitive, trimmed, both non-blank
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  return greatest(0, least(100, score));
end $$;
