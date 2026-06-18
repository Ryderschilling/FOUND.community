-- ─────────────────────────────────────────────────────────────────────────────
-- 0105_list_notifications_add_data.sql
--
-- BUG: list_notifications() did not return the `data` JSONB column from the
-- notifications table. This caused notification tap handlers in the app that
-- relied on n.data?.church_id (and similar fields) to silently fall through
-- to the fallback navigation branch (navigate to FOUND tab) instead of
-- deep-linking to the correct screen.
--
-- FIX: Add `data jsonb` to the return type and SELECT list.
-- ─────────────────────────────────────────────────────────────────────────────

-- Must drop first — Postgres won't allow changing the return type via OR REPLACE.
DROP FUNCTION IF EXISTS public.list_notifications(int);

CREATE OR REPLACE FUNCTION public.list_notifications(p_limit int DEFAULT 50)
RETURNS TABLE (
  id               uuid,
  type             text,
  title            text,
  body             text,
  data             jsonb,
  entity_type      text,
  entity_id        uuid,
  actor_id         uuid,
  actor_name       text,
  actor_avatar_url text,
  read_at          timestamptz,
  created_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.id,
    n.type,
    n.title,
    n.body,
    n.data,
    n.entity_type,
    n.entity_id,
    n.actor_id,
    a.full_name   AS actor_name,
    a.avatar_url  AS actor_avatar_url,
    n.read_at,
    n.created_at
  FROM public.notifications n
  LEFT JOIN public.profiles a ON a.id = n.actor_id
  WHERE n.user_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_notifications(int) TO authenticated;

COMMENT ON FUNCTION public.list_notifications IS
  'Returns the caller''s notification feed. Includes data JSONB for deep-link params (church_id, group_id, etc).';
