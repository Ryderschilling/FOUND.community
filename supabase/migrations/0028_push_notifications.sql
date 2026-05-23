-- =============================================================================
-- 0028_push_notifications.sql
-- Real OS-level push notifications (the banner/popup on the lock screen).
--
-- Architecture — 100% in-database, no Edge Function to deploy:
--   1. expo-notifications (client) gets an Expo push token per device.
--   2. register_push_token() stores it in push_tokens.
--   3. An AFTER INSERT trigger on `notifications` (the table from 0027)
--      fires push_on_notification(), which uses the pg_net extension to
--      POST the message straight to Expo's push service.
--
-- Because every in-app notification row already passes the user's
-- notification_prefs gate (the 0027 triggers), we do NOT re-check prefs
-- here — if a row exists, the user wants to know about it. One code path,
-- two surfaces (in-app feed + OS push).
--
-- Push is silently inert until the app runs on a real native build:
-- the web build never obtains a token, so push_tokens stays empty and the
-- trigger simply finds nothing to send. Nothing here needs editing at
-- App Store launch.
--
-- Single-pass. Safe to run once on top of 0001..0027. Idempotent.
-- Run order:  RUN_IN_SUPABASE.sql  →  0027_notifications.sql  →  THIS FILE.
-- =============================================================================

begin;

-- =============================================================================
-- 1. pg_net — lets Postgres make outbound HTTP calls (async, non-blocking).
--    Supabase ships this; create-if-not-exists is a no-op when present.
-- =============================================================================
create extension if not exists pg_net;


-- =============================================================================
-- 2. push_tokens — one row per (device token). A user can have many devices;
--    a device token is globally unique, so it is the primary key. If the same
--    physical device is later used by a different account, the token row is
--    re-pointed at the new user (handled in register_push_token).
-- =============================================================================
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text,                       -- 'ios' | 'android' | 'web'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_push_tokens_user
  on public.push_tokens (user_id);


-- =============================================================================
-- 3. RLS — a user only ever sees / manages their own device tokens.
--    Writes also go through the SECURITY DEFINER RPCs below; the policies
--    are the backstop.
-- =============================================================================
alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens: select own" on public.push_tokens;
create policy "push_tokens: select own" on public.push_tokens
  for select using (user_id = auth.uid());

drop policy if exists "push_tokens: insert own" on public.push_tokens;
create policy "push_tokens: insert own" on public.push_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists "push_tokens: update own" on public.push_tokens;
create policy "push_tokens: update own" on public.push_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_tokens: delete own" on public.push_tokens;
create policy "push_tokens: delete own" on public.push_tokens
  for delete using (user_id = auth.uid());


-- =============================================================================
-- 4. register_push_token — client calls this after expo-notifications hands
--    it a token. Upsert keyed on the token: if the token already exists
--    (device re-install, or the device switched accounts) it is re-pointed
--    at the caller. Always safe to call on every app launch.
-- =============================================================================
create or replace function public.register_push_token(
  p_token    text,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or btrim(p_token) = '' then
    return;
  end if;

  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

grant execute on function public.register_push_token(text, text) to authenticated;


-- =============================================================================
-- 5. unregister_push_token — client calls this on sign-out so the device
--    stops receiving pushes for the account that just left it.
-- =============================================================================
create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_tokens
  where token = p_token and user_id = auth.uid();
$$;

grant execute on function public.unregister_push_token(text) to authenticated;


-- =============================================================================
-- 6. push_on_notification — AFTER INSERT on notifications.
--    Builds ONE Expo push message per device the recipient owns, batches
--    them into a single array, and POSTs to Expo's push API via pg_net.
--
--    `data` carries everything the app needs to deep-link on tap — it
--    mirrors the row shape NotificationsFeedScreen already routes on.
--    `badge` is set to the recipient's live unread count so the iOS app
--    icon badge stays correct.
--
--    pg_net is fire-and-forget: the HTTP call is queued and the trigger
--    returns immediately, so an insert into notifications is never slowed
--    or blocked by Expo being slow / down.
-- =============================================================================
create or replace function public.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages     jsonb;
  v_badge        int;
  v_actor_name   text;
  v_actor_avatar text;
begin
  -- Recipient's current unread count → iOS app-icon badge.
  select count(*)::int into v_badge
  from public.notifications
  where user_id = new.user_id and read_at is null;

  -- Actor identity — carried in `data` so a Chat deep-link can render the
  -- other person without an extra round-trip.
  if new.actor_id is not null then
    select full_name, avatar_url
      into v_actor_name, v_actor_avatar
    from public.profiles where id = new.actor_id;
  end if;

  -- One message object per registered device, as a jsonb array.
  select jsonb_agg(
           jsonb_build_object(
             'to',       t.token,
             'title',    new.title,
             'body',     coalesce(new.body, ''),
             'sound',    'default',
             'badge',    v_badge,
             'priority', 'high',
             'channelId','default',
             'data', jsonb_build_object(
               'notification_id',  new.id,
               'type',             new.type,
               'entity_type',      new.entity_type,
               'entity_id',        new.entity_id,
               'actor_id',         new.actor_id,
               'actor_name',       v_actor_name,
               'actor_avatar_url', v_actor_avatar
             )
           )
         )
  into v_messages
  from public.push_tokens t
  where t.user_id = new.user_id;

  -- No devices registered (e.g. web-only user) → nothing to send.
  if v_messages is null then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Accept',       'application/json'
    ),
    body    := v_messages
  );

  return new;
end;
$$;

drop trigger if exists trg_push_on_notification on public.notifications;
create trigger trg_push_on_notification
  after insert on public.notifications
  for each row execute function public.push_on_notification();

commit;

-- =============================================================================
-- DONE.
--
-- Follow-up (not required for launch): Expo returns delivery receipts that
-- flag dead tokens (DeviceNotRegistered). A scheduled job could read
-- net._http_response and prune push_tokens. Until then a stale token just
-- means an uninstalled device stops getting pushes — no code change needed.
-- =============================================================================
