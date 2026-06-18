-- ─────────────────────────────────────────────────────────────────────────────
-- 0100_church_follows.sql
--
-- Lets users follow a church to receive notifications when the church
-- creates new groups, posts announcements, or adds events.
--
-- Tables:  church_follows
-- RPCs:    toggle_church_follow, get_church_follow_status
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.church_follows (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  church_id   uuid        NOT NULL REFERENCES public.churches(id)  ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (profile_id, church_id)
);

ALTER TABLE public.church_follows ENABLE ROW LEVEL SECURITY;

-- Users can insert/delete their own follow rows
CREATE POLICY "Users manage own church follows"
  ON public.church_follows
  FOR ALL
  TO authenticated
  USING  (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Anyone authenticated can read follower counts (for the badge)
CREATE POLICY "Anyone can read church follows"
  ON public.church_follows
  FOR SELECT
  TO authenticated
  USING (true);

-- ── toggle_church_follow ──────────────────────────────────────────────────────
-- Inserts a follow if not present; deletes it if already present.
-- Returns { following: bool, follower_count: int }

CREATE OR REPLACE FUNCTION public.toggle_church_follow(p_church_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing  uuid;
  v_following boolean;
  v_count     bigint;
BEGIN
  SELECT id INTO v_existing
  FROM church_follows
  WHERE profile_id = auth.uid()
    AND church_id  = p_church_id;

  IF v_existing IS NOT NULL THEN
    DELETE FROM church_follows WHERE id = v_existing;
    v_following := false;
  ELSE
    INSERT INTO church_follows (profile_id, church_id)
    VALUES (auth.uid(), p_church_id);
    v_following := true;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM church_follows
  WHERE church_id = p_church_id;

  RETURN jsonb_build_object(
    'following',       v_following,
    'follower_count',  v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_church_follow(uuid) TO authenticated;

-- ── get_church_follow_status ──────────────────────────────────────────────────
-- Returns whether the calling user follows this church + total follower count.

CREATE OR REPLACE FUNCTION public.get_church_follow_status(p_church_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'is_following', EXISTS (
      SELECT 1 FROM church_follows
      WHERE profile_id = auth.uid()
        AND church_id  = p_church_id
    ),
    'follower_count', (
      SELECT COUNT(*) FROM church_follows WHERE church_id = p_church_id
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_church_follow_status(uuid) TO authenticated;

-- ── notify_church_followers ───────────────────────────────────────────────────
-- Called by church admins (via dashboard) when they create a new group or
-- post an announcement.  Inserts a 'church_update' notification for every
-- follower of the church.
--
-- Usage:
--   SELECT notify_church_followers(
--     church_id   := '<uuid>',
--     notif_type  := 'church_new_group',   -- or 'church_announcement'
--     title       := 'New group: Men''s Bible Study',
--     body        := 'A new group was just added at Grace Church.',
--     data        := '{"group_id": "<uuid>"}'::jsonb  -- optional deep-link data
--   );

CREATE OR REPLACE FUNCTION public.notify_church_followers(
  p_church_id  uuid,
  p_notif_type text     DEFAULT 'church_update',
  p_title      text     DEFAULT NULL,
  p_body       text     DEFAULT NULL,
  p_data       jsonb    DEFAULT NULL
)
RETURNS int   -- number of notifications sent
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  -- Only church admins may call this
  IF NOT EXISTS (
    SELECT 1 FROM church_admins
    WHERE church_id = p_church_id
      AND user_id   = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not a church admin';
  END IF;

  INSERT INTO notifications (profile_id, type, title, body, data)
  SELECT
    cf.profile_id,
    p_notif_type,
    p_title,
    p_body,
    p_data
  FROM church_follows cf
  WHERE cf.church_id = p_church_id
    -- Don't notify yourself
    AND cf.profile_id <> auth.uid();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_church_followers(uuid, text, text, text, jsonb)
  TO authenticated;

COMMENT ON TABLE  public.church_follows IS 'Users who follow a church for updates.';
COMMENT ON FUNCTION public.toggle_church_follow  IS 'Follow/unfollow a church; returns {following, follower_count}.';
COMMENT ON FUNCTION public.get_church_follow_status IS 'Returns {is_following, follower_count} for the calling user.';
COMMENT ON FUNCTION public.notify_church_followers   IS 'Sends a notification to all followers of a church. Auth-gated to church admins.';
