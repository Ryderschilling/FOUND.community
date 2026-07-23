-- =============================================================================
-- 0115_invite_emails_and_event_notifications.sql
--
-- Goal (from Sam): when you invite someone to a group OR an event, also email
-- them — not just an in-app notification they may never see.
--
-- This migration does four things:
--   1. _found_send_email(...)        — one fail-safe Resend sender (via pg_net).
--                                      No key set -> logs a warning, no-op, and
--                                      the invite STILL succeeds. Never blocks.
--   2. found_invite_email_html(...)  — branded FOUND email template (matches the
--                                      existing connection-bump email).
--   3. invite_to_group(...)          — REWRITE: same behavior + sends an email.
--   4. create_event(...)             — REWRITE: now also creates the in-app
--                                      notification (which fires push via the
--                                      existing trigger) AND emails invitees.
--                                      Previously event invitees got NOTHING.
--   5. send_event_invites(...)       — NEW: the app already calls this to invite
--                                      people to an existing event, but the
--                                      function never existed (silent no-op).
--                                      Created here with notification + email.
--
-- Design notes:
--   * Email send is async (pg_net) and fail-open — it can never break an invite.
--   * Sends are deduped through the existing email_send_log table (6h window)
--     so double-taps / re-invites don't spam.
--   * Respects profiles.notification_prefs->>'invite_emails' if present
--     (defaults to true — everyone gets it until a toggle is added).
--   * All invitees are existing FOUND users, so auth.users.email is always on
--     file. SMS is intentionally NOT here (needs Twilio + A2P 10DLC); the code
--     is structured so it can be added to _found_send_email's callers later.
--
-- REQUIRES (one-time, turns email on — also fixes the existing connection-bump
-- and nudge emails which are currently silently off):
--   alter database postgres set app.resend_api_key = 're_your_key_here';
--   select pg_reload_conf();
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- 1. Fail-safe email sender. Fire-and-forget via pg_net. NEVER raises.
-- -----------------------------------------------------------------------------
create or replace function public._found_send_email(
  p_to_email    text,
  p_subject     text,
  p_html        text,
  p_action_type text        -- used for dedup, e.g. 'group_invite:<uuid>'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_api_key text;
begin
  if p_to_email is null or btrim(p_to_email) = '' then
    return;
  end if;

  -- Dedup: skip if the same address+action was sent in the last 6 hours.
  if exists (
    select 1 from public.email_send_log
    where email = p_to_email
      and action_type = p_action_type
      and sent_at > now() - interval '6 hours'
  ) then
    return;
  end if;

  v_api_key := current_setting('app.resend_api_key', true);
  if v_api_key is null or btrim(v_api_key) = '' then
    raise warning '[found_send_email] app.resend_api_key not set — skipping "%" to %', p_action_type, p_to_email;
    return;
  end if;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    'FOUND <hello@found.community>',
      'to',      jsonb_build_array(p_to_email),
      'subject', p_subject,
      'html',    p_html
    )
  );

  insert into public.email_send_log (email, action_type)
  values (p_to_email, p_action_type);

exception when others then
  -- Absolutely never let an email problem break an invite.
  raise warning '[found_send_email] send failed for % (%): %', p_to_email, p_action_type, sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Branded invite email HTML (one template for group + event).
-- -----------------------------------------------------------------------------
create or replace function public.found_invite_email_html(
  p_eyebrow       text,   -- e.g. 'Group Invite' / 'Event Invite'
  p_recipient     text,   -- first name
  p_headline      text,   -- big line
  p_body          text,   -- paragraph
  p_cta_label     text,
  p_cta_url       text
)
returns text
language sql
immutable
as $func$
  select
    replace(replace(replace(replace(replace(replace(
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:40px 16px;font-family:Arial,sans-serif;">
  <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:480px;background:#fff;border:1px solid rgba(0,0,0,.10);border-radius:20px;overflow:hidden;">
    <tr><td style="padding:36px 36px 0">
      <span style="font:700 22px Georgia,serif;color:#111;letter-spacing:-.3px;">FOUND</span>
    </td></tr>
    <tr><td style="padding:6px 36px 0">
      <span style="font:600 10px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;">EYEBROW_TOKEN</span>
    </td></tr>
    <tr><td style="padding:20px 36px 0"><div style="height:1px;background:rgba(0,0,0,.07)"></div></td></tr>
    <tr><td style="padding:28px 36px 0">
      <h1 style="font:400 27px/1.25 Georgia,serif;color:#111;letter-spacing:-.5px;margin:0 0 14px">
        Hey RECIPIENT_TOKEN, HEADLINE_TOKEN
      </h1>
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#4b4b4b;margin:0 0 22px">
        BODY_TOKEN
      </p>
    </td></tr>
    <tr><td style="padding:0 36px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td align="center" bgcolor="#111111" style="border-radius:9999px">
          <a href="CTAURL_TOKEN"
             style="display:block;padding:15px 28px;font:600 15px Arial;color:#fff;text-decoration:none;border-radius:9999px">
            CTALABEL_TOKEN
          </a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 36px 36px">
      <hr style="border:none;border-top:1px solid rgba(0,0,0,.08);margin:0 0 16px">
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:0">
        You are receiving this because someone invited you on FOUND.
      </p>
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:8px 0 0">
        FOUND &middot; found.community &middot;
        <a href="mailto:hello@found.community" style="color:#a3a3a3;text-decoration:none">hello@found.community</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>$html$,
      'EYEBROW_TOKEN',   coalesce(nullif(trim(p_eyebrow),   ''), 'Invite')),
      'RECIPIENT_TOKEN', coalesce(nullif(trim(p_recipient), ''), 'there')),
      'HEADLINE_TOKEN',  coalesce(nullif(trim(p_headline),  ''), 'you have a new invite.')),
      'BODY_TOKEN',      coalesce(nullif(trim(p_body),      ''), 'Open FOUND to see it.')),
      'CTALABEL_TOKEN',  coalesce(nullif(trim(p_cta_label), ''), 'Open FOUND')),
      'CTAURL_TOKEN',    coalesce(nullif(trim(p_cta_url),   ''), 'https://found.community'));
$func$;

-- Helper: does this profile want invite emails? (default yes)
create or replace function public._found_wants_invite_email(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((notification_prefs->>'invite_emails')::boolean, true)
  from public.profiles where id = p_profile;
$$;

-- -----------------------------------------------------------------------------
-- 3. invite_to_group — same behavior, now also emails the invitee.
-- -----------------------------------------------------------------------------
create or replace function public.invite_to_group(
  p_group     uuid,
  p_invitees  uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_is_member  boolean;
  v_group_name text;
  v_actor_name text;
  v_invitee    uuid;
  v_count      int := 0;
  v_email      text;
  v_first      text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_invitees is null or array_length(p_invitees, 1) is null then
    return 0;
  end if;

  select exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_uid
  ) into v_is_member;
  if not v_is_member then
    raise exception 'not a group member';
  end if;

  select name into v_group_name from public.groups where id = p_group;
  if v_group_name is null then
    raise exception 'group not found';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;

  foreach v_invitee in array p_invitees loop
    if v_invitee = v_uid then continue; end if;
    if exists (
      select 1 from public.group_members
      where group_id = p_group and profile_id = v_invitee
    ) then continue; end if;

    insert into public.group_invites (group_id, inviter_id, invitee_id, status)
    values (p_group, v_uid, v_invitee, 'pending')
    on conflict (group_id, invitee_id)
      do update set status = 'pending', responded_at = null, inviter_id = excluded.inviter_id;

    -- In-app notification (fires push via trg_push_on_notification).
    insert into public.notifications
      (user_id, type, actor_id, entity_type, entity_id, title, body)
    values
      (v_invitee,
       'group_invite',
       v_uid,
       'group',
       p_group,
       coalesce(v_actor_name, 'Someone') || ' invited you to a group',
       'Join "' || v_group_name || '" on FOUND.');

    -- Email (fail-safe, async).
    if public._found_wants_invite_email(v_invitee) then
      select au.email into v_email from auth.users au where au.id = v_invitee;
      v_first := split_part(coalesce((select full_name from public.profiles where id = v_invitee), ''), ' ', 1);
      perform public._found_send_email(
        v_email,
        coalesce(v_actor_name, 'Someone') || ' invited you to ' || v_group_name || ' on FOUND',
        public.found_invite_email_html(
          'Group Invite',
          v_first,
          'you''ve been invited to a group.',
          coalesce(v_actor_name, 'Someone') || ' invited you to join <strong style="color:#111">'
            || v_group_name || '</strong> on FOUND. Open the app to check it out and jump in.',
          'View the group',
          'https://found.community/groups/' || p_group::text
        ),
        'group_invite:' || p_group::text
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.invite_to_group(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Shared helper: notify + email one event invitee. Used by create_event and
-- send_event_invites so the two paths behave identically.
-- -----------------------------------------------------------------------------
create or replace function public._found_notify_event_invitee(
  p_event    uuid,
  p_invitee  uuid,
  p_actor    uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title      text;
  v_when       timestamptz;
  v_where      text;
  v_actor_name text;
  v_email      text;
  v_first      text;
  v_body       text;
begin
  select title, event_time, location_name into v_title, v_when, v_where
  from public.events where id = p_event;
  if v_title is null then return; end if;

  select full_name into v_actor_name from public.profiles where id = p_actor;

  -- In-app notification (fires push via trg_push_on_notification).
  insert into public.notifications
    (user_id, type, actor_id, entity_type, entity_id, title, body)
  values
    (p_invitee,
     'event_invite',
     p_actor,
     'event',
     p_event,
     coalesce(v_actor_name, 'Someone') || ' invited you to an event',
     v_title || ' — ' || to_char(v_when, 'Mon DD, HH12:MI AM'));

  if public._found_wants_invite_email(p_invitee) then
    select au.email into v_email from auth.users au where au.id = p_invitee;
    v_first := split_part(coalesce((select full_name from public.profiles where id = p_invitee), ''), ' ', 1);

    v_body := coalesce(v_actor_name, 'Someone') || ' invited you to <strong style="color:#111">'
      || v_title || '</strong> on FOUND'
      || ', ' || to_char(v_when, 'Dy, Mon DD') || ' at ' || to_char(v_when, 'HH12:MI AM')
      || coalesce('. Where: ' || nullif(btrim(v_where), ''), '')
      || '. Open the app to RSVP.';

    perform public._found_send_email(
      v_email,
      coalesce(v_actor_name, 'Someone') || ' invited you to ' || v_title || ' on FOUND',
      public.found_invite_email_html(
        'Event Invite',
        v_first,
        'you''re invited to an event.',
        v_body,
        'RSVP in FOUND',
        'https://found.community'
      ),
      'event_invite:' || p_event::text
    );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. create_event — same signature/behavior, now notifies + emails invitees.
-- -----------------------------------------------------------------------------
create or replace function public.create_event(
  p_title           text,
  p_event_time      timestamptz,
  p_location_name   text    default null,
  p_location_lat    double precision default null,
  p_location_lng    double precision default null,
  p_description     text    default null,
  p_invitee_ids     uuid[]  default null,
  p_group_id        uuid    default null,
  p_recurrence      text    default null,
  p_recurrence_rule jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id   uuid;
  v_recurrence text;
  v_invitees   uuid[];
  v_new        uuid;
begin
  v_recurrence := case
    when p_recurrence in ('weekly','biweekly','monthly') then p_recurrence
    when p_recurrence = 'monthly_nth' and p_recurrence_rule is not null then 'monthly_nth'
    else null
  end;

  insert into public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence, recurrence_rule
  )
  values (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id, v_recurrence,
    case when v_recurrence = 'monthly_nth' then p_recurrence_rule else null end
  )
  returning id into v_event_id;

  -- Resolve the invitee set (group members, or the explicit list).
  if p_group_id is not null then
    select array_agg(gm.profile_id)
      into v_invitees
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.profile_id <> auth.uid();
  elsif p_invitee_ids is not null then
    v_invitees := p_invitee_ids;
  end if;

  if v_invitees is not null then
    -- Insert invites; only newly-inserted ones get notified/emailed.
    for v_new in
      with ins as (
        insert into public.event_invites (event_id, invitee_id)
        select v_event_id, x
        from unnest(v_invitees) x
        where x <> auth.uid()
        on conflict do nothing
        returning invitee_id
      )
      select invitee_id from ins
    loop
      perform public._found_notify_event_invitee(v_event_id, v_new, auth.uid());
    end loop;
  end if;

  return v_event_id;
end;
$$;

grant execute on function public.create_event(
  text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. send_event_invites — NEW. The app already calls this to invite people to
--    an existing event; it never existed in the DB (silent no-op until now).
-- -----------------------------------------------------------------------------
create or replace function public.send_event_invites(
  p_event_id    uuid,
  p_invitee_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
  v_new     uuid;
  v_count   int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_invitee_ids is null or array_length(p_invitee_ids, 1) is null then
    return 0;
  end if;

  select creator_id into v_creator from public.events where id = p_event_id;
  if v_creator is null then
    raise exception 'event not found';
  end if;

  -- Only the creator can invite more people to their event.
  if v_creator <> v_uid then
    raise exception 'not allowed to invite to this event';
  end if;

  for v_new in
    with ins as (
      insert into public.event_invites (event_id, invitee_id)
      select p_event_id, x
      from unnest(p_invitee_ids) x
      where x <> v_uid
      on conflict do nothing
      returning invitee_id
    )
    select invitee_id from ins
  loop
    perform public._found_notify_event_invitee(p_event_id, v_new, v_uid);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.send_event_invites(uuid, uuid[]) to authenticated;

commit;

-- =============================================================================
-- DONE. To actually turn emails ON (also fixes existing connection-bump/nudge
-- emails, which are currently silently off):
--   alter database postgres set app.resend_api_key = 're_your_key_here';
--   select pg_reload_conf();
-- Verify wiring:
--   select current_setting('app.resend_api_key', true) is not null;
-- =============================================================================
