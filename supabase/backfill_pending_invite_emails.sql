-- =============================================================================
-- backfill_pending_invite_emails.sql   (RUN ONCE, manually)
--
-- One-time catch-up: emails everyone who has a PENDING invite that predates the
-- 0115 migration (the ones Sam said have been "sitting for over a month").
-- New invites email automatically from 0115 onward — this is only for the backlog.
--
-- PREREQ: the Resend key must be turned on first, or this no-ops (safe):
--   alter database postgres set app.resend_api_key = 're_your_key_here';
--   select pg_reload_conf();
--
-- Safe to run more than once: _found_send_email dedups per recipient within 6h.
-- Reuses the exact same templates/logic as live invites.
-- =============================================================================

do $$
declare
  r          record;
  v_email    text;
  v_first    text;
  v_sent     int := 0;
begin
  -- ---- Pending GROUP invites ------------------------------------------------
  for r in
    select gi.group_id,
           gi.invitee_id,
           g.name            as group_name,
           p.full_name       as inviter_name
    from public.group_invites gi
    join public.groups   g on g.id = gi.group_id
    left join public.profiles p on p.id = gi.inviter_id
    where gi.status = 'pending'
  loop
    if not public._found_wants_invite_email(r.invitee_id) then continue; end if;

    select au.email into v_email from auth.users au where au.id = r.invitee_id;
    v_first := split_part(coalesce((select full_name from public.profiles where id = r.invitee_id), ''), ' ', 1);

    perform public._found_send_email(
      v_email,
      coalesce(r.inviter_name, 'Someone') || ' invited you to ' || r.group_name || ' on FOUND',
      public.found_invite_email_html(
        'Group Invite',
        v_first,
        'you''ve been invited to a group.',
        coalesce(r.inviter_name, 'Someone') || ' invited you to join <strong style="color:#111">'
          || r.group_name || '</strong> on FOUND. Open the app to check it out and jump in.',
        'View the group',
        'https://found.community/groups/' || r.group_id::text
      ),
      'group_invite:' || r.group_id::text
    );
    v_sent := v_sent + 1;
  end loop;

  -- ---- Pending EVENT invites ------------------------------------------------
  for r in
    select ei.event_id,
           ei.invitee_id,
           e.title           as event_title,
           e.event_time      as event_time,
           e.location_name   as event_where,
           p.full_name       as inviter_name
    from public.event_invites ei
    join public.events e on e.id = ei.event_id
    left join public.profiles p on p.id = e.creator_id
    where ei.status = 'pending'
      and e.event_time >= now()   -- don't email about events already past
  loop
    if not public._found_wants_invite_email(r.invitee_id) then continue; end if;

    select au.email into v_email from auth.users au where au.id = r.invitee_id;
    v_first := split_part(coalesce((select full_name from public.profiles where id = r.invitee_id), ''), ' ', 1);

    perform public._found_send_email(
      v_email,
      coalesce(r.inviter_name, 'Someone') || ' invited you to ' || r.event_title || ' on FOUND',
      public.found_invite_email_html(
        'Event Invite',
        v_first,
        'you''re invited to an event.',
        coalesce(r.inviter_name, 'Someone') || ' invited you to <strong style="color:#111">'
          || r.event_title || '</strong> on FOUND, '
          || to_char(r.event_time, 'Dy, Mon DD') || ' at ' || to_char(r.event_time, 'HH12:MI AM')
          || coalesce('. Where: ' || nullif(btrim(r.event_where), ''), '')
          || '. Open the app to RSVP.',
        'RSVP in FOUND',
        'https://found.community'
      ),
      'event_invite:' || r.event_id::text
    );
    v_sent := v_sent + 1;
  end loop;

  raise notice 'Backfill queued % invite email(s).', v_sent;
end $$;
