-- ─────────────────────────────────────────────────────────────────────────────
-- 0102_church_group_access.sql
--
-- Church admins manage groups they created via the dashboard but may not be
-- in group_members. This migration gives them the access they need:
--
--  1. church_update_group  — edit any group belonging to their church
--  2. church_group_post    — post to any group belonging to their church
--  3. church_group_detail  — read group detail without being a member
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: is the caller an admin of the church that owns this group?
CREATE OR REPLACE FUNCTION public.is_church_group_admin(p_group uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM groups g
    JOIN church_admins ca ON ca.church_id = g.church_id
    WHERE g.id      = p_group
      AND ca.user_id = auth.uid()
      AND ca.role   IN ('owner', 'admin')
  );
$$;

-- ── church_update_group ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.church_update_group(
  p_group              uuid,
  p_name               text,
  p_description        text    DEFAULT NULL,
  p_city               text    DEFAULT NULL,
  p_state              text    DEFAULT NULL,
  p_life_stage_focus   text    DEFAULT NULL,
  p_meeting_day        text    DEFAULT NULL,
  p_meeting_time       text    DEFAULT NULL,
  p_meeting_recurrence text    DEFAULT 'weekly',
  p_meeting_week       int     DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meeting_time  time;
  v_schedule_text text;
  v_schedule_json jsonb;
BEGIN
  IF NOT is_church_group_admin(p_group) THEN
    RAISE EXCEPTION 'Not a church admin for this group';
  END IF;

  IF p_meeting_day IS NOT NULL AND p_meeting_time IS NOT NULL THEN
    v_meeting_time  := p_meeting_time::time;
    v_schedule_text := format_meeting_schedule(
      p_meeting_day, v_meeting_time, p_meeting_recurrence, p_meeting_week
    );
    v_schedule_json := jsonb_build_object(
      'day', p_meeting_day, 'time', p_meeting_time,
      'recurrence', p_meeting_recurrence, 'week', p_meeting_week,
      'display', v_schedule_text
    );
  END IF;

  UPDATE groups SET
    name               = COALESCE(p_name, name),
    description        = p_description,
    city               = p_city,
    state              = p_state,
    life_stage_focus   = p_life_stage_focus,
    meeting_day        = p_meeting_day,
    meeting_time       = v_meeting_time,
    meeting_recurrence = COALESCE(p_meeting_recurrence, meeting_recurrence),
    meeting_week       = p_meeting_week,
    meeting_schedule   = COALESCE(v_schedule_json, meeting_schedule),
    schedule_text      = COALESCE(v_schedule_text, schedule_text)
  WHERE id = p_group;
END;
$$;

GRANT EXECUTE ON FUNCTION public.church_update_group(uuid,text,text,text,text,text,text,text,text,int)
  TO authenticated;

-- ── church_group_post ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.church_group_post(
  p_group     uuid,
  p_body      text    DEFAULT NULL,
  p_photo_url text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post_id   uuid;
  v_profile_id uuid;
BEGIN
  IF NOT is_church_group_admin(p_group) THEN
    RAISE EXCEPTION 'Not a church admin for this group';
  END IF;

  SELECT id INTO v_profile_id FROM profiles WHERE id = auth.uid();

  INSERT INTO group_posts (group_id, author_id, body, photo_url)
  VALUES (p_group, v_profile_id, p_body, p_photo_url)
  RETURNING id INTO v_post_id;

  RETURN v_post_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.church_group_post(uuid, text, text) TO authenticated;

-- ── church_group_detail ───────────────────────────────────────────────────────
-- Returns group info + members + recent posts for the dashboard in one call.

CREATE OR REPLACE FUNCTION public.church_group_detail(p_group uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group   jsonb;
  v_members jsonb;
  v_posts   jsonb;
BEGIN
  IF NOT is_church_group_admin(p_group) THEN
    RAISE EXCEPTION 'Not a church admin for this group';
  END IF;

  SELECT to_jsonb(g) INTO v_group
  FROM groups g WHERE g.id = p_group;

  SELECT jsonb_agg(
    jsonb_build_object(
      'profile_id', gm.profile_id,
      'full_name',  p.full_name,
      'handle',     p.handle,
      'avatar_url', p.avatar_url,
      'role',       gm.role,
      'joined_at',  gm.joined_at
    ) ORDER BY
      CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      gm.joined_at
  ) INTO v_members
  FROM group_members gm
  JOIN profiles p ON p.id = gm.profile_id
  WHERE gm.group_id = p_group;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',           gp.id,
      'body',         gp.body,
      'photo_url',    gp.photo_url,
      'created_at',   gp.created_at,
      'is_pinned',    gp.is_pinned,
      'author_id',    gp.author_id,
      'author_name',  p.full_name,
      'author_avatar',p.avatar_url
    ) ORDER BY
      gp.is_pinned DESC, gp.pinned_at ASC NULLS LAST, gp.created_at DESC
  ) INTO v_posts
  FROM group_posts gp
  JOIN profiles p ON p.id = gp.author_id
  WHERE gp.group_id = p_group;

  RETURN jsonb_build_object(
    'group',   v_group,
    'members', COALESCE(v_members, '[]'::jsonb),
    'posts',   COALESCE(v_posts,   '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.church_group_detail(uuid) TO authenticated;
