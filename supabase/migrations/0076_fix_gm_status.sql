-- =============================================================================
-- 0076_fix_gm_status.sql
--
-- Fix: "column gm.status does not exist"
--
-- group_members has no status column — every row IS an active member.
-- Migrations 0070 and 0071 both referenced gm.status = 'active' which
-- crashes create_event() for group-linked events.
--
-- Fix: drop that filter. Remove the status check entirely.
-- =============================================================================

-- Drop current signature (added in 0071 with p_recurrence)
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title         text,
  p_event_time    timestamptz,
  p_location_name text             DEFAULT NULL,
  p_location_lat  double precision DEFAULT NULL,
  p_location_lng  double precision DEFAULT NULL,
  p_description   text             DEFAULT NULL,
  p_invitee_ids   uuid[]           DEFAULT NULL,
  p_group_id      uuid             DEFAULT NULL,
  p_recurrence    text             DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id,
    CASE WHEN p_recurrence IN ('weekly','biweekly','monthly') THEN p_recurrence ELSE NULL END
  )
  RETURNING id INTO v_event_id;

  -- Auto-invite all group members (except creator) when group_id is provided.
  -- NOTE: group_members has no status column — all rows are active members.
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
    ON CONFLICT DO NOTHING;

  ELSIF p_invitee_ids IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, UNNEST(p_invitee_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text) TO authenticated;

-- =============================================================================
-- DONE.
-- Verify by creating a group event — error should be gone.
-- =============================================================================
