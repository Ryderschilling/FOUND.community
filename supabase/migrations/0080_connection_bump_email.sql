-- =============================================================================
-- 0080_connection_bump_email.sql
--
-- One-time "bump" email: sender can nudge the recipient once to remind them
-- a connection request is waiting. Fires via Resend through pg_net.
--
-- 1. Adds `bump_sent_at` column to connections (one per directed pair)
-- 2. Adds `send_connection_bump(p_to uuid)` RPC — callable by authenticated users
-- 3. Returns text: 'sent' | 'already_sent' | 'no_connection'
--
-- Dependencies: pg_net, app.resend_api_key in DB config, found_send_email_to
--   (if not present, falls back to raw net.http_post like 0029_welcome_email)
-- Safe to re-run.
-- =============================================================================

create extension if not exists pg_net;

-- 1. Bump-sent timestamp on the from→to 'like' connection row ─────────────────
alter table public.connections
  add column if not exists bump_sent_at timestamptz;

-- 2. Email HTML helper ─────────────────────────────────────────────────────────
create or replace function public.found_connection_bump_html(
  p_sender_name text,
  p_recipient_name text
)
returns text
language sql
immutable
as $func$
  select replace(replace($html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:40px 16px;font-family:Arial,sans-serif;">
  <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:480px;background:#fff;border:1px solid rgba(0,0,0,.10);border-radius:20px;overflow:hidden;">
    <tr><td style="padding:36px 36px 0">
      <span style="font:700 22px Georgia,serif;color:#111;letter-spacing:-.3px;">FOUND</span>
    </td></tr>
    <tr><td style="padding:6px 36px 0">
      <span style="font:600 10px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;">New Connection</span>
    </td></tr>
    <tr><td style="padding:20px 36px 0"><div style="height:1px;background:rgba(0,0,0,.07)"></div></td></tr>
    <tr><td style="padding:28px 36px 0">
      <h1 style="font:400 28px/1.2 Georgia,serif;color:#111;letter-spacing:-.5px;margin:0 0 14px">
        Hey {{RECIPIENT}}, someone wants to connect.
      </h1>
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#4b4b4b;margin:0 0 20px">
        <strong style="color:#111">{{SENDER}}</strong> sent you a connection request on FOUND.
        Open the app to check out their profile and connect back.
      </p>
    </td></tr>
    <tr><td style="padding:0 36px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td align="center" bgcolor="#111111" style="border-radius:9999px">
          <a href="https://found-community.vercel.app"
             style="display:block;padding:15px 28px;font:600 15px Arial;color:#fff;text-decoration:none;border-radius:9999px">
            Open FOUND
          </a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 36px 36px">
      <hr style="border:none;border-top:1px solid rgba(0,0,0,.08);margin:0 0 16px">
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:0">
        You''re receiving this because someone on FOUND sent you a connection request.
      </p>
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:8px 0 0">
        FOUND &middot; found.community &middot;
        <a href="mailto:hello@found.community" style="color:#a3a3a3;text-decoration:none">hello@found.community</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>
$html$,
'{{SENDER}}',    coalesce(nullif(trim(p_sender_name),    ''), 'Someone'),
'{{RECIPIENT}}', coalesce(nullif(trim(p_recipient_name), ''), 'there'));
$func$;

-- 3. RPC — send the bump ───────────────────────────────────────────────────────
-- Returns: 'sent' | 'already_sent' | 'no_connection'
create or replace function public.send_connection_bump(p_to uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_bump_sent timestamptz;
  v_to_email  text;
  v_sender    text;
  v_recipient text;
  v_api_key   text;
  v_html      text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  -- Must have an active outbound 'like' connection
  select bump_sent_at
    into v_bump_sent
  from public.connections
  where from_profile = v_me
    and to_profile   = p_to
    and kind         = 'like';

  if not found then
    return 'no_connection';
  end if;

  if v_bump_sent is not null then
    return 'already_sent';
  end if;

  -- Recipient's email
  select au.email into v_to_email
  from auth.users au
  where au.id = p_to;

  if v_to_email is null or btrim(v_to_email) = '' then
    return 'no_connection'; -- no email on file — bail silently
  end if;

  -- Names
  select split_part(coalesce(full_name, ''), ' ', 1) into v_sender
  from public.profiles where id = v_me;
  if v_sender = '' then v_sender := 'Someone'; end if;

  select split_part(coalesce(full_name, ''), ' ', 1) into v_recipient
  from public.profiles where id = p_to;
  if v_recipient = '' then v_recipient := 'there'; end if;

  v_api_key := current_setting('app.resend_api_key', true);
  if v_api_key is null or btrim(v_api_key) = '' then
    raise warning '[connection_bump] app.resend_api_key not set — skipping bump email';
    return 'no_connection';
  end if;

  v_html := public.found_connection_bump_html(v_sender, v_recipient);

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    'FOUND <hello@found.community>',
      'to',      jsonb_build_array(v_to_email),
      'subject', v_sender || ' is waiting to connect with you on FOUND',
      'html',    v_html
    )
  );

  -- Mark sent — one-time only
  update public.connections
    set bump_sent_at = now()
  where from_profile = v_me
    and to_profile   = p_to
    and kind         = 'like';

  return 'sent';
end;
$$;

grant execute on function public.send_connection_bump(uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Run once in Supabase SQL editor.
-- Verify:
--   select column_name from information_schema.columns
--     where table_name = 'connections' and column_name = 'bump_sent_at';
-- =============================================================================
