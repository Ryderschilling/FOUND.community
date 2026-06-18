-- ─────────────────────────────────────────────────────────────────────────────
-- 0104_church_conversation_thread.sql
--
-- Makes church messages appear as proper conversation threads in the app's
-- Messages screen, with church replies shown inline rather than only as
-- notifications.
--
-- RPCs:
--   my_church_conversations()           — inbox list row per church
--   get_church_conversation(church_id)  — full sent+received thread
--   mark_church_replies_read(church_id) — marks reply notifications read
-- ─────────────────────────────────────────────────────────────────────────────

-- ── my_church_conversations ───────────────────────────────────────────────────
-- Returns one row per church the user has messaged, sorted newest-first.
-- Surfaces in the Messages screen alongside DM / group threads.

CREATE OR REPLACE FUNCTION public.my_church_conversations()
RETURNS TABLE (
  church_id             uuid,
  church_name           text,
  church_logo_url       text,
  last_message_body     text,
  last_message_at       timestamptz,
  last_message_is_mine  boolean,
  unread_reply_count    int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Messages the user sent to any church
  sent AS (
    SELECT
      cm.church_id,
      c.name       AS church_name,
      c.logo_url   AS church_logo_url,
      cm.body,
      cm.created_at,
      true         AS is_mine
    FROM public.church_messages cm
    JOIN public.churches c ON c.id = cm.church_id
    WHERE cm.from_profile_id = auth.uid()
  ),
  -- Church replies (stored as notifications type='church_reply')
  received AS (
    SELECT
      (n.data->>'church_id')::uuid AS church_id,
      c.name       AS church_name,
      c.logo_url   AS church_logo_url,
      n.body,
      n.created_at,
      false        AS is_mine
    FROM public.notifications n
    JOIN public.churches c ON c.id = (n.data->>'church_id')::uuid
    WHERE n.user_id = auth.uid()
      AND n.type    = 'church_reply'
  ),
  all_events AS (
    SELECT * FROM sent
    UNION ALL
    SELECT * FROM received
  ),
  -- Keep only the latest event per church
  latest AS (
    SELECT DISTINCT ON (church_id)
      church_id,
      church_name,
      church_logo_url,
      body        AS last_message_body,
      created_at  AS last_message_at,
      is_mine     AS last_message_is_mine
    FROM all_events
    ORDER BY church_id, created_at DESC
  )
  SELECT
    l.church_id,
    l.church_name,
    l.church_logo_url,
    l.last_message_body,
    l.last_message_at,
    l.last_message_is_mine,
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.notifications n
      WHERE n.user_id = auth.uid()
        AND n.type    = 'church_reply'
        AND (n.data->>'church_id')::uuid = l.church_id
        AND n.read_at IS NULL
    ), 0) AS unread_reply_count
  FROM latest l
  ORDER BY l.last_message_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.my_church_conversations() TO authenticated;


-- ── get_church_conversation ───────────────────────────────────────────────────
-- Full back-and-forth for one church, ordered oldest-first for chat display.
-- direction: 'sent' = user → church | 'received' = church → user

CREATE OR REPLACE FUNCTION public.get_church_conversation(p_church_id uuid)
RETURNS TABLE (
  id         uuid,
  body       text,
  direction  text,
  created_at timestamptz,
  read_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cm.id,
    cm.body,
    'sent'::text  AS direction,
    cm.created_at,
    cm.read_at
  FROM public.church_messages cm
  WHERE cm.church_id       = p_church_id
    AND cm.from_profile_id = auth.uid()

  UNION ALL

  SELECT
    n.id,
    n.body,
    'received'::text AS direction,
    n.created_at,
    n.read_at
  FROM public.notifications n
  WHERE n.user_id = auth.uid()
    AND n.type    = 'church_reply'
    AND (n.data->>'church_id')::uuid = p_church_id

  ORDER BY created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_church_conversation(uuid) TO authenticated;


-- ── mark_church_replies_read ──────────────────────────────────────────────────
-- Called when the user opens a church conversation.

CREATE OR REPLACE FUNCTION public.mark_church_replies_read(p_church_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications
  SET read_at = now()
  WHERE user_id = auth.uid()
    AND type    = 'church_reply'
    AND (data->>'church_id')::uuid = p_church_id
    AND read_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.mark_church_replies_read(uuid) TO authenticated;

COMMENT ON FUNCTION public.my_church_conversations  IS 'Returns one thread row per church the user has messaged, for the Messages inbox screen.';
COMMENT ON FUNCTION public.get_church_conversation  IS 'Full sent+received conversation with a specific church, oldest-first.';
COMMENT ON FUNCTION public.mark_church_replies_read IS 'Marks church_reply notifications as read when the user opens a church conversation.';
