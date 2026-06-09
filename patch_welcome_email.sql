-- Patch send_welcome_email to read Resend key from Vault instead of current_setting()
-- Run after: SELECT vault.create_secret('re_jfRGv57G_EkhDjfSAmaaskrkgeiLRSECr', 'resend_api_key');

create or replace function public.send_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email     text;
  v_name      text;
  v_first     text;
  v_api_key   text;
  v_html      text;
begin
  select au.email,
         coalesce(au.raw_user_meta_data->>'full_name', au.email)
    into v_email, v_name
  from auth.users au
  where au.id = new.id;

  if v_email is null or btrim(v_email) = '' then
    return new;
  end if;

  v_first := split_part(coalesce(new.full_name, v_name, 'Friend'), ' ', 1);
  if v_first = '' then v_first := 'Friend'; end if;

  -- Read from Vault instead of current_setting()
  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if v_api_key is null or btrim(v_api_key) = '' then
    raise warning '[welcome_email] resend_api_key not in vault — skipping welcome email for %', v_email;
    return new;
  end if;

  v_html := '
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#f8f6f3;padding:40px 16px;font-family:Arial,sans-serif;">
  <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:480px;background:#fff;border:1px solid rgba(0,0,0,.10);border-radius:20px;overflow:hidden;">
    <tr><td style="padding:36px 36px 0">
      <span style="font:700 22px Georgia,serif;color:#111;letter-spacing:-.3px;">FOUND</span>
    </td></tr>
    <tr><td style="padding:6px 36px 0">
      <span style="font:600 10px Arial,sans-serif;color:#a3a3a3;letter-spacing:3px;text-transform:uppercase;">Welcome</span>
    </td></tr>
    <tr><td style="padding:20px 36px 0"><div style="height:1px;background:rgba(0,0,0,.07)"></div></td></tr>
    <tr><td style="padding:28px 36px 0">
      <h1 style="font:400 30px/1.2 Georgia,serif;color:#111;letter-spacing:-.5px;margin:0 0 12px">
        Hey ' || v_first || '. We all need people to run with.
      </h1>
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#4b4b4b;margin:0 0 24px">
        FOUND connects you with Christians nearby who share your life stage, interests,
        and desire for deeper relationships. Here''s how to get the most out of it.
      </p>
      <p style="font:600 11px Arial,sans-serif;color:#a3a3a3;letter-spacing:2.5px;text-transform:uppercase;margin:0 0 16px">How it works</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px"><tr>
        <td width="28" valign="top" style="padding-top:2px"><span style="font:600 10px Arial;color:#a3a3a3;letter-spacing:1.5px">01</span></td>
        <td><b style="font:600 14px Arial;color:#111">Create Your Profile</b><br>
          <span style="font:400 13px/1.5 Arial;color:#6b6b6b">Photo, bio, interests, Highlight Reel. The more complete, the better your matches.</span></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px"><tr>
        <td width="28" valign="top" style="padding-top:2px"><span style="font:600 10px Arial;color:#a3a3a3;letter-spacing:1.5px">02</span></td>
        <td><b style="font:600 14px Arial;color:#111">Discover People</b><br>
          <span style="font:400 13px/1.5 Arial;color:#6b6b6b">Browse Christians in your area by life stage, interests, and church.</span></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px"><tr>
        <td width="28" valign="top" style="padding-top:2px"><span style="font:600 10px Arial;color:#a3a3a3;letter-spacing:1.5px">03</span></td>
        <td><b style="font:600 14px Arial;color:#111">Connect</b><br>
          <span style="font:400 13px/1.5 Arial;color:#6b6b6b">Send a request and start a conversation. If they connect back, you''re matched.</span></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px"><tr>
        <td width="28" valign="top" style="padding-top:2px"><span style="font:600 10px Arial;color:#a3a3a3;letter-spacing:1.5px">04</span></td>
        <td><b style="font:600 14px Arial;color:#111">Meet Up</b><br>
          <span style="font:400 13px/1.5 Arial;color:#6b6b6b">Coffee, a walk, a local event. Community grows beyond screens.</span></td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr>
        <td width="28" valign="top" style="padding-top:2px"><span style="font:600 10px Arial;color:#a3a3a3;letter-spacing:1.5px">05</span></td>
        <td><b style="font:600 14px Arial;color:#111">Do Life Together</b><br>
          <span style="font:400 13px/1.5 Arial;color:#6b6b6b">People who know you, encourage you, and walk with you through the highs and lows.</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0 36px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td align="center" bgcolor="#111111" style="border-radius:9999px">
          <a href="https://foundcommunity.app"
             style="display:block;padding:15px 28px;font:600 15px Arial;color:#fff;text-decoration:none;border-radius:9999px">
            Open FOUND
          </a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px 36px 0">
      <p style="font:400 italic 15px/1.6 Georgia,serif;color:#111;margin:0">
        Welcome to FOUND.<br>Find Community.
      </p>
    </td></tr>
    <tr><td style="padding:24px 36px 36px">
      <hr style="border:none;border-top:1px solid rgba(0,0,0,.08);margin:0 0 16px">
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:0">
        You''re receiving this because you joined FOUND.
        If this wasn''t you, you can safely ignore this email.
      </p>
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:8px 0 0">
        FOUND &middot; found.community &middot;
        <a href="mailto:hello@found.community" style="color:#a3a3a3;text-decoration:none">hello@found.community</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(
      'from',    'FOUND <hello@found.community>',
      'to',      jsonb_build_array(v_email),
      'subject', 'Welcome to FOUND. Find Community.',
      'html',    v_html
    )
  );

  return new;
end;
$$;
