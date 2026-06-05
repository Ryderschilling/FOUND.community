-- =============================================================================
-- 0071_event_recurrence.sql
-- Adds recurrence support to events.
--
--   1. events.recurrence       — nullable text: 'weekly' | 'biweekly' | 'monthly'
--   2. create_event(...)       — drop+recreate with optional p_recurrence param
--   3. group_events_list(...)  — drop+recreate to include recurrence in output
-- =============================================================================

-- ── 1. Add recurrence column ──────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS recurrence text
  CHECK (recurrence IN ('weekly', 'biweekly', 'monthly'));

-- ── 2. Recreate create_event with p_recurrence ───────────────────────────────
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid);

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

  -- Auto-invite group members when group_id provided
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
      AND gm.status = 'active'
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

-- ── 3. Recreate group_events_list to include recurrence ──────────────────────
DROP FUNCTION IF EXISTS public.group_events_list(uuid);

CREATE OR REPLACE FUNCTION public.group_events_list(p_group uuid)
RETURNS TABLE (
  id             uuid,
  title          text,
  event_time     timestamptz,
  location_name  text,
  description    text,
  creator_id     uuid,
  recurrence     text,
  going_count    bigint,
  pending_count  bigint,
  my_status      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.event_time,
    e.location_name,
    e.description,
    e.creator_id,
    e.recurrence,
    COUNT(CASE WHEN ei.status = 'accepted' THEN 1 END) AS going_count,
    COUNT(CASE WHEN ei.status = 'pending'  THEN 1 END) AS pending_count,
    (SELECT ei2.status FROM public.event_invites ei2
     WHERE ei2.event_id = e.id AND ei2.invitee_id = auth.uid()
     LIMIT 1)                                          AS my_status
  FROM public.events e
  LEFT JOIN public.event_invites ei ON ei.event_id = e.id
  WHERE e.group_id = p_group
    AND e.event_time >= NOW()
  GROUP BY e.id
  ORDER BY e.event_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.group_events_list(uuid) TO authenticated;
