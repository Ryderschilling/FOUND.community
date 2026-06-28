-- =============================================================================
-- 0112_bot_welcome_message.sql
-- Creates "Sam from FOUND" bot user + automated welcome DM on onboarding complete
-- + email alert to hello@found.community when a user replies
-- =============================================================================

-- ── 1. Bot auth user ──────────────────────────────────────────────────────────
-- Fixed UUID so all subsequent logic can reference it as a constant.
-- Bot cannot log in (empty password hash). Never appears in Discover (is_visible=false).

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'sam@found.community',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Sam from FOUND"}',
  false,
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Bot profile ────────────────────────────────────────────────────────────
-- handle_new_user trigger may have already created a minimal row — upsert covers both cases.

INSERT INTO public.profiles (
  id,
  full_name,
  onboarding_complete,
  is_visible,
  bio,
  notification_prefs,
  privacy_prefs
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Sam from FOUND',
  true,
  false,
  'Co-founder of FOUND.',
  '{"new_messages":false,"connections":false,"group_posts":false,"group_messages":false}',
  '{"discoverable":false,"show_church":false,"show_location":false}'
) ON CONFLICT (id) DO UPDATE SET
  full_name          = 'Sam from FOUND',
  onboarding_complete = true,
  is_visible         = false,
  bio                = 'Co-founder of FOUND.',
  notification_prefs = '{"new_messages":false,"connections":false,"group_posts":false,"group_messages":false}',
  privacy_prefs      = '{"discoverable":false,"show_church":false,"show_location":false}';

-- ── 3. Welcome message trigger ────────────────────────────────────────────────
-- Fires when onboarding_complete flips false → true.
-- Opens a direct thread (idempotent) and sends a welcome DM from Sam.

CREATE OR REPLACE FUNCTION public.send_bot_welcome_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bot_id   CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  v_user_id  uuid;
  v_thread_id uuid;
  v_first_name text;
BEGIN
  -- Only fire when onboarding_complete flips from false/null → true
  IF NEW.onboarding_complete IS NOT TRUE
     OR (OLD.onboarding_complete IS NOT DISTINCT FROM TRUE) THEN
    RETURN NEW;
  END IF;

  -- Don't send to the bot itself
  IF NEW.id = v_bot_id THEN
    RETURN NEW;
  END IF;

  v_user_id   := NEW.id;
  v_first_name := split_part(COALESCE(NULLIF(trim(NEW.full_name), ''), 'there'), ' ', 1);

  -- Find existing direct thread between bot and this user (idempotent)
  SELECT tp1.thread_id INTO v_thread_id
  FROM   thread_participants tp1
  JOIN   thread_participants tp2
         ON tp1.thread_id = tp2.thread_id
  JOIN   threads t
         ON t.id = tp1.thread_id AND t.kind = 'direct'
  WHERE  tp1.profile_id = v_bot_id
    AND  tp2.profile_id = v_user_id;

  -- Create thread if it doesn't exist yet
  IF v_thread_id IS NULL THEN
    INSERT INTO threads (id, kind)
    VALUES (gen_random_uuid(), 'direct')
    RETURNING id INTO v_thread_id;

    INSERT INTO thread_participants (thread_id, profile_id)
    VALUES (v_thread_id, v_bot_id), (v_thread_id, v_user_id);
  END IF;

  -- Send welcome message from Sam
  INSERT INTO messages (id, thread_id, sender_id, body)
  VALUES (
    gen_random_uuid(),
    v_thread_id,
    v_bot_id,
    'Hey ' || v_first_name || ' 👋' || chr(10) || chr(10) ||
    'Welcome to FOUND — I''m Sam, one of the co-founders. Really glad you''re here.' || chr(10) || chr(10) ||
    'Quick thing — if you haven''t already, add a profile photo. It makes a big difference in whether people connect with you.' || chr(10) || chr(10) ||
    'If you ever have questions or run into anything, just reply here. We''re a small team and I actually read these. Welcome to the community 🙏'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_welcome_message ON public.profiles;
CREATE TRIGGER trg_bot_welcome_message
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.send_bot_welcome_message();

-- ── 4. Reply notification trigger ─────────────────────────────────────────────
-- When a real user replies to Sam's thread → fire email to hello@found.community
-- Uses the same Resend API key already configured for welcome emails.

CREATE OR REPLACE FUNCTION public.notify_team_on_sam_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bot_id      CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  v_in_bot_thread boolean;
  v_sender_name text;
  v_resend_key  text;
BEGIN
  -- Skip messages FROM the bot
  IF NEW.sender_id = v_bot_id THEN
    RETURN NEW;
  END IF;

  -- Check if this thread includes the bot as a participant
  SELECT EXISTS (
    SELECT 1 FROM thread_participants
    WHERE thread_id = NEW.thread_id AND profile_id = v_bot_id
  ) INTO v_in_bot_thread;

  IF NOT v_in_bot_thread THEN
    RETURN NEW;
  END IF;

  -- Get sender display name
  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;

  -- Get Resend API key
  v_resend_key := current_setting('app.resend_api_key', true);

  IF v_resend_key IS NULL OR v_resend_key = '' THEN
    RETURN NEW; -- Fail silently — don't break message delivery
  END IF;

  -- Fire email via Resend (pg_net, fire-and-forget)
  PERFORM pg_net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_resend_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    'FOUND App <hello@found.community>',
      'to',      jsonb_build_array('hello@found.community'),
      'subject', '💬 ' || COALESCE(v_sender_name, 'A user') || ' replied to Sam in FOUND',
      'html',    '<p><strong>' || COALESCE(v_sender_name, 'A user') ||
                 '</strong> replied to Sam''s welcome message:</p>' ||
                 '<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#444">' ||
                 replace(NEW.body, chr(10), '<br>') ||
                 '</blockquote>' ||
                 '<p style="color:#888;font-size:12px">Log into the app to respond.</p>'
    )::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_team_on_sam_reply ON public.messages;
CREATE TRIGGER trg_notify_team_on_sam_reply
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_team_on_sam_reply();
