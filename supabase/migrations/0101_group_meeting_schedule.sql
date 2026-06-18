-- ─────────────────────────────────────────────────────────────────────────────
-- 0101_group_meeting_schedule.sql
--
-- Adds structured meeting schedule fields to the groups table so the system
-- knows exactly when a group meets and can send timed notifications to followers.
--
-- New columns:
--   meeting_day        text    -- 'monday' … 'sunday'
--   meeting_time       time    -- e.g. 19:00:00 (24h, for queries)
--   meeting_recurrence text    -- 'weekly' | 'biweekly' | 'monthly'
--   meeting_week       int     -- 1-4 for monthly (which week of the month)
--   meeting_schedule   jsonb   -- full structured snapshot { day, time_display, recurrence, week }
--
-- schedule_text (existing) is kept for backward-compat display; it is now
-- auto-generated from the structured fields.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS meeting_day        text,
  ADD COLUMN IF NOT EXISTS meeting_time       time,
  ADD COLUMN IF NOT EXISTS meeting_recurrence text DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS meeting_week       int,      -- 1=first, 2=second, 3=third, 4=fourth
  ADD COLUMN IF NOT EXISTS meeting_schedule   jsonb;

-- Helper: build a human-readable schedule string from structured fields
CREATE OR REPLACE FUNCTION public.format_meeting_schedule(
  p_day        text,            -- 'thursday'
  p_time       time,            -- 19:00
  p_recurrence text,            -- 'weekly' | 'biweekly' | 'monthly'
  p_week       int DEFAULT NULL -- 1-4 for monthly
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_day_cap  text;
  v_time_str text;
  v_hour     int;
  v_min      text;
  v_ampm     text;
  v_week_str text;
BEGIN
  IF p_day IS NULL OR p_time IS NULL THEN
    RETURN NULL;
  END IF;

  -- Capitalize day
  v_day_cap := initcap(p_day);

  -- Format time as 12h
  v_hour := EXTRACT(HOUR   FROM p_time)::int;
  v_min  := LPAD(EXTRACT(MINUTE FROM p_time)::int::text, 2, '0');
  IF v_hour = 0 THEN
    v_ampm := 'AM'; v_hour := 12;
  ELSIF v_hour < 12 THEN
    v_ampm := 'AM';
  ELSIF v_hour = 12 THEN
    v_ampm := 'PM';
  ELSE
    v_ampm := 'PM'; v_hour := v_hour - 12;
  END IF;
  v_time_str := v_hour::text || ':' || v_min || ' ' || v_ampm;

  -- Build the string
  IF p_recurrence = 'weekly' THEN
    RETURN v_day_cap || 's at ' || v_time_str;
  ELSIF p_recurrence = 'biweekly' THEN
    RETURN 'Every other ' || v_day_cap || ' at ' || v_time_str;
  ELSIF p_recurrence = 'monthly' THEN
    v_week_str := CASE p_week
      WHEN 1 THEN '1st'
      WHEN 2 THEN '2nd'
      WHEN 3 THEN '3rd'
      WHEN 4 THEN '4th'
      ELSE '1st'
    END;
    RETURN v_week_str || ' ' || v_day_cap || ' of the month at ' || v_time_str;
  ELSE
    RETURN v_day_cap || 's at ' || v_time_str;
  END IF;
END;
$$;

-- Updated create_church_group: accepts structured schedule OR falls back to
-- free-text p_schedule for backward compat.
CREATE OR REPLACE FUNCTION public.create_church_group(
  p_church_id         uuid,
  p_name              text,
  p_description       text     DEFAULT NULL,
  p_city              text     DEFAULT NULL,
  p_state             text     DEFAULT NULL,
  -- structured fields (new)
  p_meeting_day       text     DEFAULT NULL,   -- 'thursday'
  p_meeting_time      text     DEFAULT NULL,   -- '19:00'
  p_meeting_recurrence text    DEFAULT 'weekly',
  p_meeting_week      int      DEFAULT NULL,
  -- legacy free-text fallback
  p_schedule          text     DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id      uuid;
  v_schedule_text text;
  v_meeting_time  time;
  v_schedule_json jsonb;
BEGIN
  -- Auth: caller must be a church admin
  IF NOT EXISTS (
    SELECT 1 FROM church_admins
    WHERE church_id = p_church_id
      AND user_id   = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Not a church admin';
  END IF;

  -- Build structured schedule display text
  IF p_meeting_day IS NOT NULL AND p_meeting_time IS NOT NULL THEN
    v_meeting_time  := p_meeting_time::time;
    v_schedule_text := format_meeting_schedule(
      p_meeting_day, v_meeting_time, p_meeting_recurrence, p_meeting_week
    );
    v_schedule_json := jsonb_build_object(
      'day',        p_meeting_day,
      'time',       p_meeting_time,
      'recurrence', p_meeting_recurrence,
      'week',       p_meeting_week,
      'display',    v_schedule_text
    );
  ELSE
    -- Fall back to legacy free text
    v_schedule_text := p_schedule;
    v_schedule_json := NULL;
  END IF;

  INSERT INTO groups (
    church_id,
    name,
    description,
    city,
    state,
    schedule_text,
    meeting_day,
    meeting_time,
    meeting_recurrence,
    meeting_week,
    meeting_schedule,
    is_public,
    member_count
  ) VALUES (
    p_church_id,
    p_name,
    p_description,
    p_city,
    p_state,
    v_schedule_text,
    p_meeting_day,
    v_meeting_time,
    COALESCE(p_meeting_recurrence, 'weekly'),
    p_meeting_week,
    v_schedule_json,
    true,
    0
  )
  RETURNING id INTO v_group_id;

  RETURN v_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_church_group(
  uuid, text, text, text, text, text, text, text, int, text
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notification function: find groups meeting within the next 24 hours and
-- notify all church followers who haven't been notified about this occurrence.
-- Designed to be called daily (e.g. via Supabase Edge Function cron or
-- Vercel cron at 9am).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_upcoming_group_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_dow   text;    -- 'thursday'
  v_tomorrow_dow text;
  v_count       int := 0;
  v_group       record;
BEGIN
  -- Day names matching our storage convention
  v_today_dow    := lower(to_char(now(), 'Day'));
  -- trim whitespace that to_char pads
  v_today_dow    := trim(v_today_dow);
  v_tomorrow_dow := lower(trim(to_char(now() + interval '1 day', 'Day')));

  -- Find weekly/biweekly groups meeting tomorrow
  FOR v_group IN
    SELECT
      g.id,
      g.name,
      g.church_id,
      g.meeting_time,
      g.meeting_recurrence,
      g.schedule_text
    FROM groups g
    WHERE g.is_public = true
      AND g.meeting_day IS NOT NULL
      AND g.meeting_time IS NOT NULL
      AND g.meeting_day = v_tomorrow_dow
      AND g.meeting_recurrence IN ('weekly', 'biweekly')
  LOOP
    -- Notify all followers of the church who haven't already received this
    -- notification today (dedup by type + data->>group_id + created_at date)
    INSERT INTO notifications (profile_id, type, title, body, data)
    SELECT
      cf.profile_id,
      'church_group_reminder',
      'Group meeting tomorrow',
      v_group.name || ' meets tomorrow' ||
        CASE WHEN v_group.schedule_text IS NOT NULL
          THEN ' (' || v_group.schedule_text || ')'
          ELSE ''
        END || '. See you there!',
      jsonb_build_object('group_id', v_group.id, 'church_id', v_group.church_id)
    FROM church_follows cf
    WHERE cf.church_id = v_group.church_id
      -- Don't double-notify in the same calendar day
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.profile_id = cf.profile_id
          AND n.type = 'church_group_reminder'
          AND n.data->>'group_id' = v_group.id::text
          AND n.created_at::date = now()::date
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Only callable by service role (cron job)
REVOKE ALL ON FUNCTION public.send_upcoming_group_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.send_upcoming_group_reminders() TO service_role;

COMMENT ON COLUMN public.groups.meeting_day        IS 'Lowercase day name: monday…sunday';
COMMENT ON COLUMN public.groups.meeting_time       IS '24h time of meeting for reminder queries';
COMMENT ON COLUMN public.groups.meeting_recurrence IS 'weekly | biweekly | monthly';
COMMENT ON COLUMN public.groups.meeting_week       IS '1-4: which week of the month (monthly only)';
COMMENT ON COLUMN public.groups.meeting_schedule   IS 'Structured JSON snapshot of the full schedule';
