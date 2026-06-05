-- =============================================================================
-- 0070_group_events.sql
-- Adds group-scoped events.
--
--   1. events.group_id         — nullable FK to groups; links an event to a group
--   2. create_event(...)       — drop+recreate with optional p_group_id param;
--                                when provided, auto-invites all active group members
--   3. group_events_list(...)  — returns upcoming events for a group
-- =============================================================================

-- ── 1. Add group_id column to events ─────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS events_group_id_idx ON public.events(group_id);

-- ── 2. Recreate create_event with p_group_id ─────────────────────────────────
-- Drop old signature first
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[]);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title         text,
  p_event_time    timestamptz,
  p_location_name text    DEFAULT NULL,
  p_location_lat  double precision DEFAULT NULL,
  p_location_lng  double precision DEFAULT NULL,
  p_description   text    DEFAULT NULL,
  p_invitee_ids   uuid[]  DEFAULT NULL,
  p_group_id      uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id  uuid;
  v_member_id uuid;
BEGIN
  -- Create the event
  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id
  )
  RETURNING id INTO v_event_id;

  -- If group_id provided: invite all active group members (except creator)
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
      AND gm.status = 'active'
    ON CONFLICT DO NOTHING;

  -- Otherwise: invite the explicit list
  ELSIF p_invitee_ids IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, UNNEST(p_invitee_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid) TO authenticated;

-- ── 3. group_events_list — upcoming events for a group ───────────────────────
DROP FUNCTION IF EXISTS public.group_events_list(uuid);

CREATE OR REPLACE FUNCTION public.group_events_list(p_group uuid)
RETURNS TABLE (
  id             uuid,
  title          text,
  event_time     timestamptz,
  location_name  text,
  description    text,
  creator_id     uuid,
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
    COUNT(CASE WHEN ei.status = 'accepted' THEN 1 END)  AS going_count,
    COUNT(CASE WHEN ei.status = 'pending'  THEN 1 END)  AS pending_count,
    (SELECT ei2.status FROM public.event_invites ei2
     WHERE ei2.event_id = e.id AND ei2.invitee_id = auth.uid()
     LIMIT 1)                                            AS my_status
  FROM public.events e
  LEFT JOIN public.event_invites ei ON ei.event_id = e.id
  WHERE e.group_id = p_group
    AND e.event_time >= NOW()
  GROUP BY e.id
  ORDER BY e.event_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.group_events_list(uuid) TO authenticated;
