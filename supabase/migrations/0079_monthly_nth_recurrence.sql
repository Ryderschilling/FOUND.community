-- =============================================================================
-- 0079_monthly_nth_recurrence.sql
--
-- Adds "nth weekday of month" recurrence pattern.
--
-- Examples: "1st & 3rd Wednesday", "2nd & 4th Sunday"
--
-- Changes:
--   1. Add recurrence_rule jsonb column to events
--   2. Expand recurrence CHECK constraint to include 'monthly_nth'
--   3. Recreate create_event() to accept + store p_recurrence_rule
-- =============================================================================

-- ── 1. Add recurrence_rule column ────────────────────────────────────────────
-- Format: {"weekday": 3, "weeks": [1, 3]}
--   weekday: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
--   weeks:   array of week ordinals [1–4], e.g. [1,3] = 1st & 3rd

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;

-- ── 2. Expand CHECK constraint to allow 'monthly_nth' ────────────────────────
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_recurrence_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_recurrence_check
  CHECK (recurrence IN ('weekly', 'biweekly', 'monthly', 'monthly_nth'));

-- ── 3. Recreate create_event with p_recurrence_rule ──────────────────────────
-- Drop the previous signature (0076 version)
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title           text,
  p_event_time      timestamptz,
  p_location_name   text             DEFAULT NULL,
  p_location_lat    double precision DEFAULT NULL,
  p_location_lng    double precision DEFAULT NULL,
  p_description     text             DEFAULT NULL,
  p_invitee_ids     uuid[]           DEFAULT NULL,
  p_group_id        uuid             DEFAULT NULL,
  p_recurrence      text             DEFAULT NULL,
  p_recurrence_rule jsonb            DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id    uuid;
  v_recurrence  text;
BEGIN
  -- Validate recurrence value; 'monthly_nth' requires a rule
  v_recurrence := CASE
    WHEN p_recurrence IN ('weekly','biweekly','monthly') THEN p_recurrence
    WHEN p_recurrence = 'monthly_nth' AND p_recurrence_rule IS NOT NULL THEN 'monthly_nth'
    ELSE NULL
  END;

  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence, recurrence_rule
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id, v_recurrence,
    CASE WHEN v_recurrence = 'monthly_nth' THEN p_recurrence_rule ELSE NULL END
  )
  RETURNING id INTO v_event_id;

  -- Auto-invite all group members (except creator) when group_id is provided.
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

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text, jsonb) TO authenticated;

-- =============================================================================
-- DONE.
-- Verify: create an event with recurrence='monthly_nth' and
-- recurrence_rule='{"weekday":3,"weeks":[1,3]}' — should save cleanly.
-- =============================================================================
