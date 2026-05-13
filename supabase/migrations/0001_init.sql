-- =============================================================================
-- FOUND.community — Initial Schema
-- Run this in the Supabase SQL editor on a fresh project.
-- Idempotent: safe to re-run; CREATE statements use IF NOT EXISTS where possible.
-- =============================================================================

-- ---------- Extensions -------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "postgis";        -- for geo (nearby matches/groups)
create extension if not exists "citext";         -- case-insensitive emails/handles

-- ---------- Helper: updated_at trigger ---------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =============================================================================
-- Taxonomies (small, finite reference tables — seeded separately)
-- =============================================================================
create table if not exists public.life_stages (
  id text primary key,
  label text not null,
  icon text,
  icon_color text,
  sort_order int not null default 0,
  has_kids boolean not null default false
);

create table if not exists public.activities (
  id text primary key,
  label text not null,
  icon text,
  icon_color text,
  sort_order int not null default 0
);

create table if not exists public.community_goals (
  id text primary key,
  label text not null,
  icon text,
  icon_color text,
  sort_order int not null default 0
);

create table if not exists public.family_values (
  id text primary key,
  label text not null,
  icon text,
  icon_color text,
  sort_order int not null default 0
);

create table if not exists public.school_types (
  id text primary key,
  label text not null,
  icon text,
  icon_color text,
  sort_order int not null default 0
);

create table if not exists public.love_languages (
  id text primary key,
  label text not null,
  icon text,
  icon_color text,
  sort_order int not null default 0
);

-- =============================================================================
-- Churches
-- =============================================================================
create table if not exists public.churches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  city        text,
  state       text,
  zip         text,
  website     text,
  phone       text,
  location    geography(point, 4326),       -- WGS84 lat/lng
  members_count int,
  is_verified boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_churches_location on public.churches using gist (location);
create index if not exists idx_churches_name     on public.churches (lower(name));

drop trigger if exists trg_churches_updated_at on public.churches;
create trigger trg_churches_updated_at before update on public.churches
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Profiles  (1:1 with auth.users)
-- =============================================================================
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  handle          citext unique,                              -- @ryder etc; nullable until set
  full_name       text,
  bio             text,
  life_stage_id   text references public.life_stages(id) on delete set null,
  school_type_id  text references public.school_types(id) on delete set null,
  love_language_id text references public.love_languages(id) on delete set null,
  church_id       uuid references public.churches(id) on delete set null,
  city            text,
  state           text,
  -- Location used for proximity matching. Updated occasionally; not real-time tracking.
  location        geography(point, 4326),
  -- Discoverability radius (miles)
  match_radius_mi int not null default 25,
  onboarding_complete boolean not null default false,
  last_active_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_radius check (match_radius_mi between 1 and 500)
);
create index if not exists idx_profiles_location  on public.profiles using gist (location);
create index if not exists idx_profiles_lifestage on public.profiles (life_stage_id);
create index if not exists idx_profiles_church    on public.profiles (church_id);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- Profile <-> taxonomy join tables ---------------------------------
create table if not exists public.profile_activities (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  activity_id text not null references public.activities(id) on delete cascade,
  primary key (profile_id, activity_id)
);
create index if not exists idx_pact_activity on public.profile_activities (activity_id);

create table if not exists public.profile_goals (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  goal_id    text not null references public.community_goals(id) on delete cascade,
  primary key (profile_id, goal_id)
);
create index if not exists idx_pgoals_goal on public.profile_goals (goal_id);

create table if not exists public.profile_values (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  value_id   text not null references public.family_values(id) on delete cascade,
  primary key (profile_id, value_id)
);
create index if not exists idx_pvals_value on public.profile_values (value_id);

-- =============================================================================
-- Photos  (profile photos + group photos in one table, polymorphic via owner_kind)
-- =============================================================================
do $$ begin
  create type photo_owner as enum ('profile', 'group');
exception when duplicate_object then null; end $$;

create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  owner_kind  photo_owner not null,
  owner_id    uuid not null,                            -- profile_id or group_id
  storage_path text not null,                           -- key in supabase storage
  width       int,
  height      int,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_photos_owner on public.photos (owner_kind, owner_id, sort_order);

-- =============================================================================
-- Groups
-- =============================================================================
create table if not exists public.groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  icon            text,
  icon_color      text,
  icon_bg         text,
  church_id       uuid references public.churches(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  location        geography(point, 4326),
  city            text,
  state           text,
  schedule_text   text,                                  -- "Tuesdays 7pm"
  is_public       boolean not null default true,
  member_count    int not null default 0,                -- denormalized cache
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_groups_location on public.groups using gist (location);
create index if not exists idx_groups_church   on public.groups (church_id);
create index if not exists idx_groups_name     on public.groups (lower(name));

drop trigger if exists trg_groups_updated_at on public.groups;
create trigger trg_groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();

-- ---------- Group categories (M:M with activities reused as tags) ------------
create table if not exists public.group_activities (
  group_id    uuid not null references public.groups(id) on delete cascade,
  activity_id text not null references public.activities(id) on delete cascade,
  primary key (group_id, activity_id)
);

-- ---------- Group membership -------------------------------------------------
do $$ begin
  create type group_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

create table if not exists public.group_members (
  group_id   uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       group_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (group_id, profile_id)
);
create index if not exists idx_gm_profile on public.group_members (profile_id);

-- Keep member_count in sync
create or replace function public.bump_group_member_count() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set member_count = member_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set member_count = greatest(0, member_count - 1) where id = old.group_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_group_member_count_ins on public.group_members;
create trigger trg_group_member_count_ins after insert on public.group_members
  for each row execute function public.bump_group_member_count();

drop trigger if exists trg_group_member_count_del on public.group_members;
create trigger trg_group_member_count_del after delete on public.group_members
  for each row execute function public.bump_group_member_count();

-- =============================================================================
-- Messaging  (threads + participants + messages)
-- =============================================================================
do $$ begin
  create type thread_kind as enum ('direct', 'group');
exception when duplicate_object then null; end $$;

create table if not exists public.threads (
  id         uuid primary key default gen_random_uuid(),
  kind       thread_kind not null default 'direct',
  group_id   uuid references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint chk_group_link check (
    (kind = 'group' and group_id is not null) or
    (kind = 'direct' and group_id is null)
  )
);
create index if not exists idx_threads_group on public.threads (group_id);
create index if not exists idx_threads_last  on public.threads (last_message_at desc);

create table if not exists public.thread_participants (
  thread_id   uuid not null references public.threads(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (thread_id, profile_id)
);
create index if not exists idx_tp_profile on public.thread_participants (profile_id);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_thread on public.messages (thread_id, created_at desc);

create or replace function public.touch_thread_last_message() returns trigger
language plpgsql as $$
begin
  update public.threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end $$;
drop trigger if exists trg_touch_thread on public.messages;
create trigger trg_touch_thread after insert on public.messages
  for each row execute function public.touch_thread_last_message();

-- =============================================================================
-- Match preferences & connections
--   Matches are *computed on demand* via the match_score function below.
--   We persist explicit connections (like/skip) separately.
-- =============================================================================
do $$ begin
  create type connection_kind as enum ('like', 'skip', 'block');
exception when duplicate_object then null; end $$;

create table if not exists public.connections (
  from_profile uuid not null references public.profiles(id) on delete cascade,
  to_profile   uuid not null references public.profiles(id) on delete cascade,
  kind         connection_kind not null,
  created_at   timestamptz not null default now(),
  primary key (from_profile, to_profile, kind)
);
create index if not exists idx_connections_to on public.connections (to_profile);

-- =============================================================================
-- Match scoring function
--   Inputs: viewer profile + candidate profile
--   Output: integer 0..100
--   Heuristic: 30 pts shared activities, 30 pts shared goals, 25 pts life stage,
--              15 pts proximity (within match_radius).
-- =============================================================================
create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_radius_mi   int;
  v_loc         geography;
  c_loc         geography;
  dist_mi       numeric;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, match_radius_mi, location into v_lifestage, v_radius_mi, v_loc
    from public.profiles where id = viewer;
  select life_stage_id, location into c_lifestage, c_loc
    from public.profiles where id = candidate;

  -- Activities overlap (Jaccard scaled to 30)
  select count(*) into shared_acts from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- Goals overlap (scaled to 30)
  select count(*) into shared_goals from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 30)::int;
  end if;

  -- Life stage exact match (25)
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 25;
  end if;

  -- Proximity (15) — linear falloff within radius
  if v_loc is not null and c_loc is not null and v_radius_mi is not null then
    dist_mi := ST_Distance(v_loc, c_loc) / 1609.34;
    if dist_mi <= v_radius_mi then
      score := score + (15 * (1 - (dist_mi / nullif(v_radius_mi, 0))))::int;
    end if;
  end if;

  return greatest(0, least(100, score));
end $$;

-- Helper RPC: top N matches for the current user
create or replace function public.top_matches(p_limit int default 20)
returns table (
  profile_id uuid,
  score      int,
  distance_mi numeric
) language sql stable as $$
  with me as (select id, location, match_radius_mi from public.profiles where id = auth.uid())
  select p.id,
         public.match_score((select id from me), p.id) as score,
         case when (select location from me) is not null and p.location is not null
              then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
              else null end as distance_mi
  from public.profiles p, me
  where p.id <> me.id
    and p.onboarding_complete = true
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  order by score desc, distance_mi nulls last
  limit p_limit
$$;

-- =============================================================================
-- Auto-create profile row on auth.users insert
-- =============================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- ROW-LEVEL SECURITY
-- =============================================================================
alter table public.profiles            enable row level security;
alter table public.profile_activities  enable row level security;
alter table public.profile_goals       enable row level security;
alter table public.profile_values      enable row level security;
alter table public.photos              enable row level security;
alter table public.churches            enable row level security;
alter table public.groups              enable row level security;
alter table public.group_activities    enable row level security;
alter table public.group_members       enable row level security;
alter table public.threads             enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages            enable row level security;
alter table public.connections         enable row level security;

-- Taxonomies are public-read
alter table public.life_stages     enable row level security;
alter table public.activities      enable row level security;
alter table public.community_goals enable row level security;
alter table public.family_values   enable row level security;
alter table public.school_types    enable row level security;
alter table public.love_languages  enable row level security;

-- ---- helper: am I a participant of a thread? ---------------------------------
create or replace function public.is_thread_participant(p_thread uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.thread_participants
    where thread_id = p_thread and profile_id = auth.uid()
  );
$$;

-- ---- helper: am I a member of a group? ---------------------------------------
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from public.group_members
    where group_id = p_group and profile_id = auth.uid()
  );
$$;

-- ---------- Taxonomy read policies -------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array['life_stages','activities','community_goals','family_values','school_types','love_languages'])
  loop
    execute format($f$
      drop policy if exists "read %1$s" on public.%1$s;
      create policy "read %1$s" on public.%1$s for select using (true);
    $f$, t);
  end loop;
end $$;

-- ---------- Profiles ---------------------------------------------------------
drop policy if exists "profiles select" on public.profiles;
create policy "profiles select" on public.profiles
  for select using (true);  -- discoverable; tighten later if needed

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self" on public.profiles
  for insert with check (id = auth.uid());

-- ---------- Profile sub-tables (own rows only) -------------------------------
do $$
declare t text;
begin
  for t in select unnest(array['profile_activities','profile_goals','profile_values'])
  loop
    execute format($f$
      drop policy if exists "%1$s select" on public.%1$s;
      create policy "%1$s select" on public.%1$s for select using (true);

      drop policy if exists "%1$s write own" on public.%1$s;
      create policy "%1$s write own" on public.%1$s
        for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- ---------- Photos -----------------------------------------------------------
drop policy if exists "photos read" on public.photos;
create policy "photos read" on public.photos for select using (true);

drop policy if exists "photos write profile own" on public.photos;
create policy "photos write profile own" on public.photos
  for all using (
    (owner_kind = 'profile' and owner_id = auth.uid())
    or (owner_kind = 'group' and exists (
         select 1 from public.group_members gm
         where gm.group_id = owner_id and gm.profile_id = auth.uid()
           and gm.role in ('owner','admin')))
  ) with check (
    (owner_kind = 'profile' and owner_id = auth.uid())
    or (owner_kind = 'group' and exists (
         select 1 from public.group_members gm
         where gm.group_id = owner_id and gm.profile_id = auth.uid()
           and gm.role in ('owner','admin')))
  );

-- ---------- Churches ---------------------------------------------------------
drop policy if exists "churches read" on public.churches;
create policy "churches read" on public.churches for select using (true);
-- Writes are admin-only (no policy = denied for anon/authenticated)

-- ---------- Groups -----------------------------------------------------------
drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select using (is_public or is_group_member(id));

drop policy if exists "groups insert" on public.groups;
create policy "groups insert" on public.groups
  for insert with check (created_by = auth.uid());

drop policy if exists "groups update own" on public.groups;
create policy "groups update own" on public.groups
  for update using (
    exists (select 1 from public.group_members gm
            where gm.group_id = id and gm.profile_id = auth.uid()
              and gm.role in ('owner','admin'))
  );

-- group_activities + group_members similar
drop policy if exists "group_activities read" on public.group_activities;
create policy "group_activities read" on public.group_activities for select using (true);
drop policy if exists "group_activities write admin" on public.group_activities;
create policy "group_activities write admin" on public.group_activities
  for all using (
    exists (select 1 from public.group_members gm
            where gm.group_id = group_id and gm.profile_id = auth.uid()
              and gm.role in ('owner','admin'))
  );

drop policy if exists "group_members read" on public.group_members;
create policy "group_members read" on public.group_members for select using (true);

drop policy if exists "group_members join" on public.group_members;
create policy "group_members join" on public.group_members
  for insert with check (profile_id = auth.uid());

drop policy if exists "group_members leave" on public.group_members;
create policy "group_members leave" on public.group_members
  for delete using (profile_id = auth.uid());

-- ---------- Threads / participants / messages --------------------------------
drop policy if exists "threads read participants" on public.threads;
create policy "threads read participants" on public.threads
  for select using (is_thread_participant(id) or (group_id is not null and is_group_member(group_id)));

drop policy if exists "threads insert" on public.threads;
create policy "threads insert" on public.threads
  for insert with check (true);  -- creation handled via RPC in app code

drop policy if exists "tp read self" on public.thread_participants;
create policy "tp read self" on public.thread_participants
  for select using (profile_id = auth.uid() or is_thread_participant(thread_id));

drop policy if exists "tp insert self" on public.thread_participants;
create policy "tp insert self" on public.thread_participants
  for insert with check (profile_id = auth.uid());

drop policy if exists "tp update self" on public.thread_participants;
create policy "tp update self" on public.thread_participants
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages
  for select using (is_thread_participant(thread_id));

drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (sender_id = auth.uid() and is_thread_participant(thread_id));

-- ---------- Connections ------------------------------------------------------
drop policy if exists "connections read own" on public.connections;
create policy "connections read own" on public.connections
  for select using (from_profile = auth.uid() or to_profile = auth.uid());

drop policy if exists "connections write own" on public.connections;
create policy "connections write own" on public.connections
  for all using (from_profile = auth.uid()) with check (from_profile = auth.uid());

-- =============================================================================
-- Realtime: enable for messages + threads (subscribed from the app)
-- =============================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.threads;

-- =============================================================================
-- DONE. Next: run 0002_seed_taxonomies.sql
-- =============================================================================
