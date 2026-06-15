-- =============================================================================
-- 0061_completion_nudge_email.sql
-- Sends a "finish your profile" nudge email 3 hours after signup to any
-- user who still has onboarding_complete = false.
--
-- Architecture:
--   1. send_completion_nudge_batch() scans profiles for users who:
--        • signed up > 3 hours ago
--        • onboarding_complete = false
--        • have NOT already received a nudge (nudge_sent_at IS NULL)
--   2. For each, POSTs a branded email via Resend and stamps nudge_sent_at.
--   3. pg_cron runs the batch every 30 minutes.
--
-- Uses the same app.resend_api_key config param as 0029_welcome_email.sql.
-- Run AFTER 0029. Safe to re-run (idempotent).
-- =============================================================================

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── 1. Add nudge_sent_at column to profiles ──────────────────────────────────
-- Tracks whether a nudge has gone out (NULL = not yet sent).
alter table public.profiles
  add column if not exists nudge_sent_at timestamptz;

-- ── 2. Nudge email HTML builder ──────────────────────────────────────────────
create or replace function public.found_nudge_html(p_name text)
returns text
language sql
immutable
as $func$
  select replace($html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:40px 16px;font-family:Arial,sans-serif;">
  <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:480px;background:#ffffff;border:1px solid rgba(0,0,0,.10);border-radius:20px;overflow:hidden;">

    <tr><td style="padding:36px 36px 0">
      <span style="font:700 22px Georgia,serif;color:#111;letter-spacing:-.3px;">FOUND</span>
    </td></tr>
    <tr><td style="padding:6px 36px 0">
      <span style="font:600 10px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;">Your profile is waiting</span>
    </td></tr>
    <tr><td style="padding:20px 36px 0"><div style="height:1px;background:rgba(0,0,0,.07)"></div></td></tr>

    <tr><td style="padding:28px 36px 0">
      <h1 style="font:400 30px/1.2 Georgia,serif;color:#111;letter-spacing:-.5px;margin:0 0 16px">
        Hey {{NAME}}, you're one step away.
      </h1>
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#4b4b4b;margin:0 0 14px">
        You created your account — but your profile isn't complete yet. Without
        it, you won't show up in Discover and people can't find you.
      </p>
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#4b4b4b;margin:0 0 24px">
        It only takes two minutes. Add a photo, pick your interests, and write a
        short bio — then you're in.
      </p>
    </td></tr>

    <!-- What's needed -->
    <tr><td style="padding:0 36px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#f8f6f3;border-radius:12px;padding:20px 22px;">
        <tr><td style="padding-bottom:10px">
          <span style="font:600 10px Arial,sans-serif;color:#7a846a;letter-spacing:2.5px;text-transform:uppercase;">To complete your profile</span>
        </td></tr>
        <tr><td style="font:400 13px/1.8 Arial,sans-serif;color:#4b4b4b;">
          ☐&nbsp; Profile photo<br>
          ☐&nbsp; Life stage<br>
          ☐&nbsp; Church (or "looking for one")<br>
          ☐&nbsp; 3+ interests<br>
          ☐&nbsp; Short bio
        </td></tr>
      </table>
    </td></tr>

    <!-- CTA -->
    <tr><td style="padding:24px 36px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td align="center" bgcolor="#111111" style="border-radius:9999px;">
          <a href="https://foundcommunity.app"
             style="display:block;padding:15px 28px;font:600 15px Arial,sans-serif;color:#fff;text-decoration:none;border-radius:9999px;">
            Complete my profile
          </a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:26px 36px 36px 36px;">
      <hr style="border:none;border-top:1px solid rgba(0,0,0,.08);margin:0 0 16px">
      <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:0">
        You're receiving this because you signed up for FOUND but haven't
        completed your profile yet. If you don't want this, just ignore it.
      </p>
      <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:8px 0 0">
        FOUND &middot; found.community &middot;
        <a href="mailto:hello@found.community" style="color:#a3a3a3;text-decoration:none">hello@found.community</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
  $html$, '{{NAME}}', coalesce(nullif(trim($1), ''), 'friend'));
$func$;

-- ── 3. Batch sender function ─────────────────────────────────────────────────
-- Finds all users who signed up > 3 hours ago, haven't completed onboarding,
-- and haven't received a nudge yet. Sends one email per user and stamps
-- nudge_sent_at so it never fires twice.
create or replace function public.send_completion_nudge_batch()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_api_key text;
  rec       record;
  v_first   text;
begin
  v_api_key := current_setting('app.resend_api_key', true);
  if v_api_key is null or btrim(v_api_key) = '' then
    raise warning '[nudge_email] app.resend_api_key not set — skipping batch';
    return;
  end if;

  for rec in
    select
      p.id,
      p.full_name,
      au.email,
      au.created_at
    from public.profiles p
    join auth.users au on au.id = p.id
    where p.onboarding_complete = false
      and p.nudge_sent_at is null
      and au.created_at < now() - interval '3 hours'
      and au.email is not null
      and btrim(au.email) <> ''
  loop
    v_first := split_part(coalesce(rec.full_name, ''), ' ', 1);
    if v_first = '' then v_first := 'friend'; end if;

    -- Fire-and-forget POST to Resend. Never blocks even if the HTTP call fails.
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object(
        'from',    'FOUND <hello@found.community>',
        'to',      jsonb_build_array(rec.email),
        'subject', 'Your FOUND profile is waiting — finish in 2 minutes',
        'html',    public.found_nudge_html(v_first)
      )
    );

    -- Stamp immediately so we never double-send even if the HTTP fails.
    update public.profiles
    set nudge_sent_at = now()
    where id = rec.id;
  end loop;
end;
$$;

-- ── 4. pg_cron job — runs every 30 minutes ───────────────────────────────────
-- Requires pg_cron to be enabled in Supabase (Database → Extensions → pg_cron).
-- Safe to re-run: unschedules any existing job with the same name first.
select cron.unschedule('found-completion-nudge') where exists (
  select 1 from cron.job where jobname = 'found-completion-nudge'
);

select cron.schedule(
  'found-completion-nudge',
  '*/30 * * * *',   -- every 30 minutes
  $$select public.send_completion_nudge_batch();$$
);

commit;

-- =============================================================================
-- DONE.
--
-- To enable pg_cron: Supabase Dashboard → Database → Extensions → pg_cron
--
-- Test manually (run in SQL editor):
--   select public.send_completion_nudge_batch();
--
-- Check who would receive it:
--   select p.id, p.full_name, au.email, au.created_at
--   from public.profiles p
--   join auth.users au on au.id = p.id
--   where p.onboarding_complete = false
--     and p.nudge_sent_at is null
--     and au.created_at < now() - interval '3 hours';
--
-- To test immediately (bypass the 3-hour wait):
--   update public.profiles set nudge_sent_at = null where onboarding_complete = false;
--   Then run: select public.send_completion_nudge_batch();
--
-- Debug Resend delivery:
--   select * from net._http_response order by created desc limit 10;
-- =============================================================================
