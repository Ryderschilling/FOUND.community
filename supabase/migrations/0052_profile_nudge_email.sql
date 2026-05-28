-- =============================================================================
-- 0052_profile_nudge_email.sql
-- "Finish your profile" nudge email — sent once, 2+ days after signup,
-- to any user who is still missing a bio OR has no highlight reel photos.
-- -----------------------------------------------------------------------------
-- Mechanism:
--   1. Adds `profile_nudge_sent_at` to profiles (prevents re-sending)
--   2. Adds `found_profile_nudge_html(name)` — branded email body
--   3. Adds `found_send_profile_nudges()` — bulk sender, safe to call any time
--   4. Schedules `found_send_profile_nudges()` daily at 10 AM UTC via pg_cron
--
-- Dependencies: pg_net, supabase_vault, pg_cron (all available in Supabase)
-- Safe to re-run — all objects use CREATE OR REPLACE / IF NOT EXISTS.
-- Resend API key must already be in Vault as 'resend_api_key' (set by
-- email-notifications.sql). This file does NOT touch the key.
-- =============================================================================

-- 1. Extensions ---------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 2. Track whether we've already sent the nudge to each profile ---------------
alter table public.profiles
  add column if not exists profile_nudge_sent_at timestamptz;

-- 3. Branded email HTML -------------------------------------------------------
-- Matches the existing FOUND email design exactly:
--   • #f8f6f3 warm-white background
--   • 480px white card, 20px radius, subtle border
--   • "FOUND" in Georgia serif, 24px bold
--   • Heading in Georgia 30px, body in Arial 15px/1.6
--   • #111111 pill CTA button
--   • Footer rule + grey legal copy
-- {{NAME}} is swapped at call time for the user's first name.
-- Deep link note: CTA currently points to found.community. At App Store
-- launch, swap href to your universal link (e.g. https://found.community/app
-- or foundcommunity://profile/edit) so the app opens directly.
create or replace function public.found_profile_nudge_html(p_name text)
returns text
language sql
immutable
as $func$
  select replace($html$
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#ffffff;border:1px solid rgba(0,0,0,0.10);border-radius:20px;">

        <!-- Header -->
        <tr>
          <td style="padding:36px 36px 0 36px;">
            <div style="font:700 24px Georgia,'Times New Roman',serif;color:#111111;letter-spacing:-0.5px;">FOUND</div>
            <div style="font:600 11px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;margin-top:14px;">Your profile</div>
          </td>
        </tr>

        <!-- Body copy -->
        <tr>
          <td style="padding:10px 36px 0 36px;">
            <h1 style="font:400 30px Georgia,'Times New Roman',serif;color:#111111;letter-spacing:-0.5px;margin:0 0 14px;">
              Almost there, {{NAME}}.
            </h1>
            <p style="font:400 15px/1.6 Arial,sans-serif;color:#4b4b4b;margin:0 0 14px;">
              Your FOUND profile is set up — but a couple of things are still missing
              that make a big difference in how people find and connect with you.
            </p>
          </td>
        </tr>

        <!-- Checklist cards -->
        <tr>
          <td style="padding:4px 36px 0 36px;">

            <!-- Bio card -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f8f6f3;border-radius:12px;margin-bottom:10px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font:600 13px Arial,sans-serif;color:#111111;margin-bottom:4px;">
                    ✏️&nbsp; Write a short bio
                  </div>
                  <div style="font:400 13px/1.5 Arial,sans-serif;color:#6b6b6b;">
                    A sentence or two about who you are. It's the first thing
                    people read when they see your profile.
                  </div>
                </td>
              </tr>
            </table>

            <!-- Photos card -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f8f6f3;border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font:600 13px Arial,sans-serif;color:#111111;margin-bottom:4px;">
                    📷&nbsp; Add photos to your highlight reel
                  </div>
                  <div style="font:400 13px/1.5 Arial,sans-serif;color:#6b6b6b;">
                    Show people a bit of your life — up to 9 photos. Profiles
                    with photos get significantly more connections.
                  </div>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- CTA button -->
        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" bgcolor="#111111" style="border-radius:9999px;">
                  <a href="https://found-community.vercel.app/profile"
                     style="display:block;padding:15px 28px;font:600 15px Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:9999px;">
                    Finish my profile
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Sub-copy -->
        <tr>
          <td style="padding:18px 36px 0 36px;">
            <p style="font:400 13px/1.6 Arial,sans-serif;color:#9a9a9a;margin:0;">
              It only takes a couple of minutes, and it helps us match you with
              the right people nearby. Open the FOUND app and tap
              <strong style="color:#6b6b6b;">Profile → Edit</strong> to get started.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:26px 36px 36px 36px;">
            <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:0 0 18px;" />
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:0;">
              You're receiving this because you created a FOUND account.
              Questions? Reply to this email — we read every one.
            </p>
            <p style="font:400 12px/1.6 Arial,sans-serif;color:#a3a3a3;margin:10px 0 0;">
              FOUND &middot; found.community &middot;
              <a href="mailto:hello@found.community" style="color:#a3a3a3;">hello@found.community</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
$html$, '{{NAME}}', coalesce(nullif(trim($1), ''), 'friend'));
$func$;

-- 4. Bulk sender --------------------------------------------------------------
-- Queries profiles that:
--   (a) signed up at least 2 days ago
--   (b) are still missing a bio OR have zero highlight reel photos
--   (c) have NOT already received this nudge (profile_nudge_sent_at IS NULL)
-- Sends one email per qualifying user, marks profile_nudge_sent_at immediately
-- so the job is idempotent regardless of how often it runs.
--
-- Note: profiles.id = auth.users.id, so we join there for the email address.
create or replace function public.found_send_profile_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select
      p.id,
      split_part(coalesce(p.full_name, ''), ' ', 1) as first_name,
      u.email
    from public.profiles p
    join auth.users u on u.id = p.id
    where
      -- signed up at least 2 days ago
      u.created_at < now() - interval '2 days'
      -- nudge not yet sent
      and p.profile_nudge_sent_at is null
      -- missing bio OR missing at least one highlight reel photo
      and (
        (p.bio is null or trim(p.bio) = '')
        or not exists (
          select 1 from public.photos ph
          where ph.owner_kind = 'profile'
            and ph.owner_id   = p.id
        )
      )
      -- only email-confirmed accounts
      and u.email_confirmed_at is not null
  loop
    -- Fire the email (async, non-blocking via pg_net)
    perform public.found_send_email_to(
      r.email,
      'Your FOUND profile is almost ready',
      public.found_profile_nudge_html(r.first_name)
    );

    -- Mark sent so we never send twice, even if the email bounced
    update public.profiles
      set profile_nudge_sent_at = now()
      where id = r.id;
  end loop;
end;
$$;

-- Only the service role / internal calls should trigger this
revoke all on function public.found_send_profile_nudges() from public, anon;
grant execute on function public.found_send_profile_nudges() to authenticated;

-- 5. Daily cron job -----------------------------------------------------------
-- Runs every day at 10 AM UTC. pg_cron is available on all Supabase projects.
-- To verify after running: select jobname, schedule from cron.job;
-- To trigger manually: select public.found_send_profile_nudges();
--
-- Idempotent: unschedule first (no-op if the job doesn't exist yet),
-- then register fresh. Prevents duplicate entries on re-run.
do $$
begin
  perform cron.unschedule('found-profile-nudges');
exception when others then null;
end $$;

select cron.schedule(
  'found-profile-nudges',   -- unique job name
  '0 10 * * *',             -- every day at 10:00 AM UTC
  $$select public.found_send_profile_nudges();$$
);

-- =============================================================================
-- DEPLOY NOTES:
--
-- Run this file ONCE in the Supabase SQL Editor → Run.
-- It is idempotent — safe to re-run.
--
-- Prerequisites:
--   • email-notifications.sql must have been run first (provides
--     found_send_email_to() and the Resend API key in Vault)
--
-- Verify the cron job registered:
--   select jobname, schedule, command from cron.job;
--
-- Trigger manually (test run):
--   select public.found_send_profile_nudges();
--
-- Check send history:
--   select id, full_name, profile_nudge_sent_at from public.profiles
--   where profile_nudge_sent_at is not null;
--
-- Debug email delivery:
--   select * from net._http_response order by created desc limit 10;
--
-- Reset a specific user to re-test:
--   update public.profiles set profile_nudge_sent_at = null
--   where id = '<your-test-user-uuid>';
--
-- CTA deep link: currently points to https://found.community.
-- At App Store launch, update found_profile_nudge_html() href to your
-- universal link (e.g. https://found.community/app or foundcommunity://profile/edit).
-- =============================================================================
