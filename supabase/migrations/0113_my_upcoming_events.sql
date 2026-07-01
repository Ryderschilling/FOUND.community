-- =============================================================================
-- 0113_my_upcoming_events.sql
--
-- Bug fix: ActivityScreen (FOUND tab → Events) calls supabase.rpc('my_upcoming_events')
-- but the function was never created — every call 404'd and the Events tab was
-- permanently empty for all users.
--
-- Returns upcoming events where the current user is the creator OR has an
-- accepted invite. Recurrence handling mirrors group_events_list (0088):
-- next occurrence is computed so recurring events don't vanish after their
-- first stored event_time passes.
--
-- Return shape matches EventCard + handleEventPress in ActivityScreen:
--   event_id, title, event_time, location_name, going_count, my_role
-- =============================================================================

DROP FUNCTION IF EXISTS public.my_upcoming_events();

CREATE OR REPLACE FUNCTION public.my_upcoming_events()
RETURNS TABLE (
  event_id        uuid,
  title           text,
  event_time      timestamptz,   -- next occurrence (or original if non-recurring)
  location_name   text,
  description     text,
  creator_id      uuid,
  group_id        uuid,
  recurrence      text,
  recurrence_rule jsonb,
  going_count     bigint,
  my_role         text           -- 'creator' | 'attendee'
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    -- Events I created
    SELECT e.id, 'creator'::text AS my_role
    FROM public.events e
    WHERE e.creator_id = auth.uid()

    UNION

    -- Events I accepted an invite to
    SELECT ei.event_id AS id, 'attendee'::text AS my_role
    FROM public.event_invites ei
    WHERE ei.invitee_id = auth.uid()
      AND ei.status = 'accepted'
  ),
  next_occ AS (
    SELECT
      e.id,
      CASE
        WHEN e.recurrence IS NULL THEN
          e.event_time

        WHEN e.recurrence = 'weekly' THEN
          e.event_time + (
            CEIL(GREATEST(0.0, EXTRACT(EPOCH FROM (NOW() - e.event_time)) / (7.0 * 86400)))
            * INTERVAL '7 days'
          )

        WHEN e.recurrence = 'biweekly' THEN
          e.event_time + (
            CEIL(GREATEST(0.0, EXTRACT(EPOCH FROM (NOW() - e.event_time)) / (14.0 * 86400)))
            * INTERVAL '14 days'
          )

        WHEN e.recurrence IN ('monthly', 'monthly_nth') THEN (
          SELECT e.event_time + (n * INTERVAL '1 month')
          FROM generate_series(0, 120) n
          WHERE e.event_time + (n * INTERVAL '1 month') >= NOW()
          ORDER BY n ASC
          LIMIT 1
        )

        -- Unknown recurrence value: fall back to stored time
        ELSE e.event_time
      END AS next_occurrence
    FROM public.events e
    WHERE e.id IN (SELECT id FROM mine)
  )
  SELECT
    e.id                    AS event_id,
    e.title,
    no.next_occurrence      AS event_time,
    e.location_name,
    e.description,
    e.creator_id,
    e.group_id,
    e.recurrence,
    e.recurrence_rule,
    COUNT(CASE WHEN ei.status = 'accepted' THEN 1 END) AS going_count,
    m.my_role
  FROM public.events e
  JOIN mine m     ON m.id  = e.id
  JOIN next_occ no ON no.id = e.id
  LEFT JOIN public.event_invites ei ON ei.event_id = e.id
  WHERE no.next_occurrence IS NOT NULL
    AND no.next_occurrence >= NOW()
  GROUP BY e.id, no.next_occurrence, m.my_role
  ORDER BY no.next_occurrence ASC;
$$;

GRANT EXECUTE ON FUNCTION public.my_upcoming_events() TO authenticated;

-- =============================================================================
-- VERIFY:
--   1. As a signed-in user, create an event (any invitees).
--   2. FOUND tab → Events should show it under "Hosting".
--   3. Accept an invite from another account → shows under "Going".
-- =============================================================================
