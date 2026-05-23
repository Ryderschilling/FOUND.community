-- =============================================================================
-- 0027_notifications.sql
-- In-app notification center.
--
-- One `notifications` table, fed by AFTER INSERT triggers on:
--   messages       → direct_message / group_message
--   group_posts    → group_post
--   connections    → connection / match  (like + wave only)
--
-- Each trigger checks the recipient's profiles.notification_prefs (from 0025)
-- before inserting — so the Settings → Notifications toggles are now real.
--
-- Trigger functions are SECURITY DEFINER: they must insert rows for OTHER
-- users, which the notifications RLS policy forbids for normal callers.
--
-- Reads go through RPCs (list_notifications / unread_notification_count);
-- the table is also added to the supabase_realtime publication so the client
-- can subscribe for live badge updates.
--
-- Single-pass. Safe to run once on top of 0001..0026. Idempotent.
-- =============================================================================

begin;

-- =============================================================================
-- 1. notifications table
--   user_id      — recipient
--   actor_id     — who triggered it (nullable; profile may be deleted)
--   entity_type  — 'thread' | 'group' | 'profile'  (deep-link target kind)
--   entity_id    — thread_id / group_id / actor profile id
--   type         — 'direct_message' | 'group_message' | 'group_post'
--                  | 'connection' | 'match'
-- =============================================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  actor_id    uuid references public.profiles(id) on delete cascade,
  entity_type text,
  entity_id   uuid,
  title       text not null,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id) where read_at is null;


-- =============================================================================
-- 2. RLS — a user only ever touches their own rows.
--   No INSERT policy: rows are created exclusively by the SECURITY DEFINER
--   triggers below, never by the client.
-- =============================================================================
alter table public.notifications enable row level security;

drop policy if exists "notifications: select own" on public.notifications;
create policy "notifications: select own" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifications: update own" on public.notifications;
create policy "notifications: update own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: delete own" on public.notifications
  for delete using (user_id = auth.uid());


-- =============================================================================
-- 3. Trigger: new message → notify every other thread participant
--   Direct threads  → type 'direct_message', gated by prefs.new_messages
--   Group threads   → type 'group_message',  gated by prefs.group_messages
-- =============================================================================
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind        text;
  v_group_id    uuid;
  v_group_name  text;
  v_sender_name text;
  v_type        text;
  v_pref        text;
  v_ent_type    text;
  v_ent_id      uuid;
  v_title       text;
  r             record;
begin
  select t.kind::text, t.group_id into v_kind, v_group_id
  from public.threads t where t.id = new.thread_id;

  select full_name into v_sender_name
  from public.profiles where id = new.sender_id;

  if v_kind = 'group' then
    v_type     := 'group_message';
    v_pref     := 'group_messages';
    v_ent_type := 'group';
    v_ent_id   := v_group_id;
    select name into v_group_name from public.groups where id = v_group_id;
    v_title := coalesce(v_sender_name, 'Someone')
               || ' messaged ' || coalesce(v_group_name, 'a group');
  else
    v_type     := 'direct_message';
    v_pref     := 'new_messages';
    v_ent_type := 'thread';
    v_ent_id   := new.thread_id;
    v_title    := coalesce(v_sender_name, 'Someone');
  end if;

  for r in
    select tp.profile_id
    from public.thread_participants tp
    where tp.thread_id = new.thread_id
      and tp.profile_id <> new.sender_id
  loop
    if coalesce(
         (select (notification_prefs ->> v_pref)::boolean
          from public.profiles where id = r.profile_id),
         true) then
      insert into public.notifications
        (user_id, type, actor_id, entity_type, entity_id, title, body)
      values
        (r.profile_id, v_type, new.sender_id, v_ent_type, v_ent_id,
         v_title, left(new.body, 140));
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_message on public.messages;
create trigger trg_notify_message
  after insert on public.messages
  for each row execute function public.notify_on_message();


-- =============================================================================
-- 4. Trigger: new group post → notify every other group member
--   gated by prefs.group_posts
-- =============================================================================
create or replace function public.notify_on_group_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author text;
  v_group  text;
  r        record;
begin
  select full_name into v_author from public.profiles where id = new.author_id;
  select name into v_group from public.groups where id = new.group_id;

  for r in
    select gm.profile_id
    from public.group_members gm
    where gm.group_id = new.group_id
      and gm.profile_id <> new.author_id
  loop
    if coalesce(
         (select (notification_prefs ->> 'group_posts')::boolean
          from public.profiles where id = r.profile_id),
         true) then
      insert into public.notifications
        (user_id, type, actor_id, entity_type, entity_id, title, body)
      values
        (r.profile_id, 'group_post', new.author_id, 'group', new.group_id,
         coalesce(v_author, 'Someone') || ' posted in '
           || coalesce(v_group, 'a group'),
         left(coalesce(nullif(btrim(new.body), ''), 'Shared a photo'), 140));
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_group_post on public.group_posts;
create trigger trg_notify_group_post
  after insert on public.group_posts
  for each row execute function public.notify_on_group_post();


-- =============================================================================
-- 5. Trigger: new connection (like / wave) → notify the recipient
--   A 'like' that completes a mutual like is surfaced as type 'match'.
--   gated by prefs.connections
-- =============================================================================
create or replace function public.notify_on_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_type  text;
  v_title text;
begin
  -- skip / block never notify; a self-row never notifies.
  if new.kind not in ('like', 'wave') or new.from_profile = new.to_profile then
    return new;
  end if;

  select full_name into v_actor
  from public.profiles where id = new.from_profile;

  if new.kind = 'like' and exists (
    select 1 from public.connections r
    where r.from_profile = new.to_profile
      and r.to_profile   = new.from_profile
      and r.kind = 'like'
  ) then
    v_type  := 'match';
    v_title := 'You and ' || coalesce(v_actor, 'someone') || ' connected';
  elsif new.kind = 'wave' then
    v_type  := 'connection';
    v_title := coalesce(v_actor, 'Someone') || ' waved at you';
  else
    v_type  := 'connection';
    v_title := coalesce(v_actor, 'Someone') || ' wants to connect';
  end if;

  if coalesce(
       (select (notification_prefs ->> 'connections')::boolean
        from public.profiles where id = new.to_profile),
       true) then
    insert into public.notifications
      (user_id, type, actor_id, entity_type, entity_id, title, body)
    values
      (new.to_profile, v_type, new.from_profile, 'profile', new.from_profile,
       v_title, null);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_connection on public.connections;
create trigger trg_notify_connection
  after insert on public.connections
  for each row execute function public.notify_on_connection();


-- =============================================================================
-- 6. Read RPCs
-- =============================================================================

-- Unread count for the header bell badge.
create or replace function public.unread_notification_count()
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;

grant execute on function public.unread_notification_count() to authenticated;


-- The feed itself — joins actor name + avatar for rendering.
create or replace function public.list_notifications(p_limit int default 50)
returns table (
  id               uuid,
  type             text,
  title            text,
  body             text,
  entity_type      text,
  entity_id        uuid,
  actor_id         uuid,
  actor_name       text,
  actor_avatar_url text,
  read_at          timestamptz,
  created_at       timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    n.id, n.type, n.title, n.body,
    n.entity_type, n.entity_id,
    n.actor_id, a.full_name, a.avatar_url,
    n.read_at, n.created_at
  from public.notifications n
  left join public.profiles a on a.id = n.actor_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

grant execute on function public.list_notifications(int) to authenticated;


-- Mark read. NULL p_ids → mark everything read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null
    and (p_ids is null or id = any(p_ids));
$$;

grant execute on function public.mark_notifications_read(uuid[]) to authenticated;


-- =============================================================================
-- 7. Realtime — let the client subscribe for live badge / feed updates.
--   Guarded so a re-run does not error on "table already in publication".
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;

-- =============================================================================
-- DONE.
-- =============================================================================
