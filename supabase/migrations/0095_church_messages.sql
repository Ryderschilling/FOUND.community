-- =============================================================================
-- 0095_church_messages.sql
--
-- Church ↔ Member messaging layer.
--
-- App members can send a message to any church they're connected to.
-- Church admins read and reply from the dashboard — never from the app.
-- Replies arrive as a 'church_reply' notification in the member's feed.
--
-- New objects:
--   1. church_messages table
--   2. send_message_to_church    — app user sends a message to a church
--   3. church_inbox              — dashboard: list all messages for a church
--   4. mark_church_message_read  — dashboard: mark a message read
--   5. reply_to_church_message   — dashboard: send a reply notification back
--   6. get_church_profile        — app: full church profile (info + staff + groups)
-- =============================================================================


-- =============================================================================
-- 1. church_messages
-- =============================================================================

create table if not exists public.church_messages (
  id               uuid        primary key default gen_random_uuid(),
  church_id        uuid        not null references public.churches(id)  on delete cascade,
  from_profile_id  uuid        not null references public.profiles(id)  on delete cascade,
  body             text        not null,
  read_at          timestamptz,
  replied_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_church_messages_church   on public.church_messages (church_id, created_at desc);
create index if not exists idx_church_messages_profile  on public.church_messages (from_profile_id);

-- RLS
alter table public.church_messages enable row level security;

-- Members can insert their own messages
drop policy if exists "church_messages insert"  on public.church_messages;
create policy "church_messages insert" on public.church_messages
  for insert with check (from_profile_id = auth.uid());

-- Members can see their own messages (so they know it sent)
drop policy if exists "church_messages select member" on public.church_messages;
create policy "church_messages select member" on public.church_messages
  for select using (from_profile_id = auth.uid());

-- Church admins can see all messages for their church
drop policy if exists "church_messages select admin" on public.church_messages;
create policy "church_messages select admin" on public.church_messages
  for select using (public.is_church_admin(church_id));

-- Church admins can update (mark read, set replied_at)
drop policy if exists "church_messages update admin" on public.church_messages;
create policy "church_messages update admin" on public.church_messages
  for update using (public.is_church_admin(church_id));


-- =============================================================================
-- 2. send_message_to_church
-- App member → church. Creates a message row and sends a notification to the
-- church admin(s) so they see it in their dashboard badge.
-- =============================================================================

create or replace function public.send_message_to_church(
  p_church_id  uuid,
  p_body       text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_mid  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if btrim(p_body) = '' then raise exception 'message body cannot be empty'; end if;

  insert into public.church_messages (church_id, from_profile_id, body)
  values (p_church_id, v_uid, btrim(p_body))
  returning id into v_mid;

  -- Notify church admin(s) — insert into notifications for each owner/admin
  insert into public.notifications (user_id, type, title, body, data)
  select
    ca.user_id,
    'church_message',
    (select full_name from public.profiles where id = v_uid) || ' sent a message',
    btrim(p_body),
    jsonb_build_object(
      'church_id',  p_church_id,
      'message_id', v_mid,
      'from_id',    v_uid
    )
  from public.church_admins ca
  where ca.church_id = p_church_id
    and ca.role in ('owner', 'admin');

  return v_mid;
end;
$$;

grant execute on function public.send_message_to_church(uuid, text) to authenticated;


-- =============================================================================
-- 3. church_inbox
-- Dashboard: list all messages for a church, newest first.
-- =============================================================================

create or replace function public.church_inbox(
  p_church_id uuid,
  p_limit     int default 50,
  p_offset    int default 0
) returns table (
  id               uuid,
  from_profile_id  uuid,
  full_name        text,
  city             text,
  state            text,
  life_stage_id    text,
  avatar_url       text,
  body             text,
  read_at          timestamptz,
  replied_at       timestamptz,
  created_at       timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    m.from_profile_id,
    p.full_name,
    p.city,
    p.state,
    p.life_stage_id,
    p.avatar_url,
    m.body,
    m.read_at,
    m.replied_at,
    m.created_at
  from public.church_messages m
  join public.profiles p on p.id = m.from_profile_id
  where m.church_id = p_church_id
    and public.is_church_admin(p_church_id)
  order by m.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.church_inbox(uuid, int, int) to authenticated;


-- =============================================================================
-- 4. mark_church_message_read
-- =============================================================================

create or replace function public.mark_church_message_read(p_message_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_church_id uuid;
begin
  select church_id into v_church_id
  from public.church_messages where id = p_message_id;

  if not public.is_church_admin(v_church_id) then
    raise exception 'not authorized';
  end if;

  update public.church_messages
  set read_at = now()
  where id = p_message_id and read_at is null;
end;
$$;

grant execute on function public.mark_church_message_read(uuid) to authenticated;


-- =============================================================================
-- 5. reply_to_church_message
-- Dashboard admin sends a reply → member gets a 'church_reply' notification.
-- =============================================================================

create or replace function public.reply_to_church_message(
  p_message_id uuid,
  p_reply_body text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_msg        record;
  v_church_name text;
begin
  select m.*, c.name as church_name
  into   v_msg
  from   public.church_messages m
  join   public.churches c on c.id = m.church_id
  where  m.id = p_message_id;

  if not found then raise exception 'message not found'; end if;
  if not public.is_church_admin(v_msg.church_id) then raise exception 'not authorized'; end if;

  -- Deliver as a notification to the member
  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_msg.from_profile_id,
    'church_reply',
    v_msg.church_name || ' replied to your message',
    btrim(p_reply_body),
    jsonb_build_object(
      'church_id',  v_msg.church_id,
      'message_id', p_message_id
    )
  );

  -- Mark original as replied + read
  update public.church_messages
  set replied_at = now(), read_at = coalesce(read_at, now())
  where id = p_message_id;
end;
$$;

grant execute on function public.reply_to_church_message(uuid, text) to authenticated;


-- =============================================================================
-- 6. get_church_profile
-- App: one call returns everything needed to render the church profile screen.
-- Returns a single row — caller wraps data.
-- =============================================================================

create or replace function public.get_church_profile(p_church_id uuid)
returns table (
  id            uuid,
  name          text,
  description   text,
  city          text,
  state         text,
  address       text,
  website       text,
  denomination  text,
  service_times jsonb,
  logo_url      text,
  slug          text,
  member_count  bigint,
  staff         jsonb,
  groups        jsonb
)
language sql stable security definer set search_path = public as $$
  select
    c.id,
    c.name,
    c.description,
    c.city,
    c.state,
    c.address,
    c.website,
    c.denomination,
    c.service_times,
    c.logo_url,
    c.slug,
    -- live member count
    (select count(*) from public.profiles p where p.church_id = c.id and p.onboarding_complete = true),
    -- staff array
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',         s.id,
          'name',       s.name,
          'title',      s.title,
          'bio',        s.bio,
          'avatar_url', s.avatar_url
        ) order by s.sort_order, s.created_at
      ), '[]'::jsonb)
      from public.church_staff s
      where s.church_id = c.id
    ),
    -- groups array (active groups only)
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',           g.id,
          'name',         g.name,
          'description',  g.description,
          'schedule_text',g.schedule_text,
          'city',         g.city,
          'state',        g.state,
          'member_count', g.member_count
        ) order by g.name
      ), '[]'::jsonb)
      from public.groups g
      where g.church_id = c.id
        and g.is_public = true
    )
  from public.churches c
  where c.id = p_church_id;
$$;

grant execute on function public.get_church_profile(uuid) to authenticated, anon;


-- =============================================================================
-- 7. unread_church_messages_count
-- Dashboard: badge count of unread messages.
-- =============================================================================

create or replace function public.unread_church_messages_count(p_church_id uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from public.church_messages
  where church_id = p_church_id
    and read_at is null
    and public.is_church_admin(p_church_id);
$$;

grant execute on function public.unread_church_messages_count(uuid) to authenticated;


-- =============================================================================
-- VERIFY:
--   select * from church_messages limit 5;
--   select get_church_profile('<church_id>');
--   select church_inbox('<church_id>');
-- =============================================================================
