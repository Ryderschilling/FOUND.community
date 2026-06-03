-- =============================================================================
-- 0069_breakdown_detail.sql
--
-- get_score_breakdown_detail(p_viewer uuid, p_candidate uuid)
--
--   Returns the actual item labels for each scoreable category so the client
--   can show users WHAT they share, not just how many.
--
--   Return shape:
--   {
--     "interests": {
--       "shared":          [{"id": "beach", "label": "Beach / Lake / River"}],
--       "viewer_only":     [{"id": "hiking", "label": "Hiking"}],
--       "candidate_only":  [{"id": "fitness", "label": "Working Out"}]
--     },
--     "goals": {
--       "shared":          [...],
--       "viewer_only":     [...],
--       "candidate_only":  [...]
--     },
--     "values": {
--       "shared":          [...],
--       "viewer_only":     [...],
--       "candidate_only":  [...]
--     }
--   }
--
--   Only interests, goals, and values return item lists (the list-based categories).
--   Life stage, hometown, and political are handled by get_score_breakdown already.
--
-- Run AFTER 0068.
-- =============================================================================

create or replace function public.get_score_breakdown_detail(p_viewer uuid, p_candidate uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  interests_result jsonb;
  goals_result     jsonb;
  values_result    jsonb;
begin
  -- ── Interests ────────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label) order by a.sort_order)
      from public.activities a
      join public.profile_activities pav on pav.activity_id = a.id and pav.profile_id = p_viewer
      join public.profile_activities pac on pac.activity_id = a.id and pac.profile_id = p_candidate
    ), '[]'::jsonb),
    'viewer_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label) order by a.sort_order)
      from public.activities a
      join public.profile_activities pav on pav.activity_id = a.id and pav.profile_id = p_viewer
      where not exists (
        select 1 from public.profile_activities pac
        where pac.activity_id = a.id and pac.profile_id = p_candidate
      )
    ), '[]'::jsonb),
    'candidate_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label) order by a.sort_order)
      from public.activities a
      join public.profile_activities pac on pac.activity_id = a.id and pac.profile_id = p_candidate
      where not exists (
        select 1 from public.profile_activities pav
        where pav.activity_id = a.id and pav.profile_id = p_viewer
      )
    ), '[]'::jsonb)
  ) into interests_result;

  -- ── Goals ────────────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label) order by g.sort_order)
      from public.community_goals g
      join public.profile_goals pgv on pgv.goal_id = g.id and pgv.profile_id = p_viewer
      join public.profile_goals pgc on pgc.goal_id = g.id and pgc.profile_id = p_candidate
    ), '[]'::jsonb),
    'viewer_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label) order by g.sort_order)
      from public.community_goals g
      join public.profile_goals pgv on pgv.goal_id = g.id and pgv.profile_id = p_viewer
      where not exists (
        select 1 from public.profile_goals pgc
        where pgc.goal_id = g.id and pgc.profile_id = p_candidate
      )
    ), '[]'::jsonb),
    'candidate_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label) order by g.sort_order)
      from public.community_goals g
      join public.profile_goals pgc on pgc.goal_id = g.id and pgc.profile_id = p_candidate
      where not exists (
        select 1 from public.profile_goals pgv
        where pgv.goal_id = g.id and pgv.profile_id = p_viewer
      )
    ), '[]'::jsonb)
  ) into goals_result;

  -- ── Values ───────────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object('id', fv.id, 'label', fv.label) order by fv.sort_order)
      from public.family_values fv
      join public.profile_values pvv on pvv.value_id = fv.id and pvv.profile_id = p_viewer
      join public.profile_values pvc on pvc.value_id = fv.id and pvc.profile_id = p_candidate
    ), '[]'::jsonb),
    'viewer_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', fv.id, 'label', fv.label) order by fv.sort_order)
      from public.family_values fv
      join public.profile_values pvv on pvv.value_id = fv.id and pvv.profile_id = p_viewer
      where not exists (
        select 1 from public.profile_values pvc
        where pvc.value_id = fv.id and pvc.profile_id = p_candidate
      )
    ), '[]'::jsonb),
    'candidate_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', fv.id, 'label', fv.label) order by fv.sort_order)
      from public.family_values fv
      join public.profile_values pvc on pvc.value_id = fv.id and pvc.profile_id = p_candidate
      where not exists (
        select 1 from public.profile_values pvv
        where pvv.value_id = fv.id and pvv.profile_id = p_viewer
      )
    ), '[]'::jsonb)
  ) into values_result;

  return jsonb_build_object(
    'interests', interests_result,
    'goals',     goals_result,
    'values',    values_result
  );
end;
$$;

grant execute on function public.get_score_breakdown_detail(uuid, uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select get_score_breakdown_detail('<viewer_uuid>', '<candidate_uuid>');
-- =============================================================================
