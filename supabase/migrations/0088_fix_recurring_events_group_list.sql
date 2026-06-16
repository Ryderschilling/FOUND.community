-- =============================================================================
-- 0088_fix_recurring_events_group_list.sql
--
-- Bug fix: group_events_list was filtering recurring events with
-- `event_time >= NOW()`, which drops them once the stored event_time
-- (the first occurrence) passes. This version computes `next_occurrence`
-- per recurrence pattern so recurring events always surface correctly.
--
-- Changes:
--   1. Recreate group_events_list — compute next occurrence per recurrence type
--   2. Add recurrence_rule to return shape (already on the events table)
-- =============================================================================

DROP FUNCTION IF EXISTS public.group_events_list(uuid);

CREATE OR REPLACE FUNCTION public.group_events_list(p_group uuid)
RETURNS TABLE (
  id              uuid,
  title           text,
  event_time      timestamptz,   -- next occurrence (or original if non-recurring)
  location_name   text,
  description     text,
  creator_id      uuid,
  recurrence      text,
  recurrence_rule jsonb,
  going_count     bigint,
  pending_count   bigint,
  my_status       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH next_occ AS (
    SELECT
      e.id,
      CASE
        -- Non-recurring: use the stored time as-is
        WHEN e.recurrence IS NULL THEN
          e.event_time

        -- Weekly: add N * 7 days to get the first future occurrence
        WHEN e.recurrence = 'weekly' THEN
          e.event_time + (
            CEIL(GREATEST(0.0, EXTRACT(EPOCH FROM (NOW() - e.event_time)) / (7.0 * 86400)))
            * INTERVAL '7 days'
          )

        -- Bi-weekly: add N * 14 days
        WHEN e.recurrence = 'biweekly' THEN
          e.event_time + (
            CEIL(GREATEST(0.0, EXTRACT(EPOCH FROM (NOW() - e.event_time)) / (14.0 * 86400)))
            * INTERVAL '14 days'
          )

        -- Monthly and monthly_nth: walk forward 1 month at a time.
        -- monthly_nth carries the same time-of-day as the original event;
        -- the exact nth-weekday logic is enforced in the app UI at creation time.
        WHEN e.recurrence IN ('monthly', 'monthly_nth') THEN (
          SELECT e.event_time + (n * INTERVAL '1 month')
          FROM generate_series(0, 120) n
          WHERE e.event_time + (n * INTERVAL '1 month') >= NOW()
          ORDER BY n ASC
          LIMIT 1
        )

      END AS next_occurrence
    FROM public.events e
    WHERE e.group_id = p_group
  )
  SELECT
    e.id,
    e.title,
    no.next_occurrence      AS event_time,
    e.location_name,
    e.description,
    e.creator_id,
    e.recurrence,
    e.recurrence_rule,
    COUNT(CASE WHEN ei.status = 'accepted' THEN 1 END) AS going_count,
    COUNT(CASE WHEN ei.status = 'pending'  THEN 1 END) AS pending_count,
    (SELECT ei2.status FROM public.event_invites ei2
     WHERE ei2.event_id = e.id AND ei2.invitee_id = auth.uid()
     LIMIT 1)                                           AS my_status
  FROM public.events e
  JOIN next_occ no ON no.id = e.id
  LEFT JOIN public.event_invites ei ON ei.event_id = e.id
  WHERE no.next_occurrence IS NOT NULL
    AND no.next_occurrence >= NOW()
  GROUP BY e.id, no.next_occurrence
  ORDER BY no.next_occurrence ASC;
$$;

GRANT EXECUTE ON FUNCTION public.group_events_list(uuid) TO authenticated;

-- =============================================================================
-- VERIFY:
--   1. Create a group event with recurrence='weekly', event_time = last Tuesday.
--   2. Call: SELECT * FROM group_events_list('<group_id>');
--   3. Should return the event with event_time = NEXT Tuesday, not empty.
-- =============================================================================
