-- =============================================================================
-- FOUND App — All migrations bundled in order for Sam's project
-- Run: psql "postgresql://postgres:[PASSWORD]@db.cspsglmopchuqkvdfvwc.supabase.co:5432/postgres" < found_migrations_bundle.sql
-- =============================================================================

-- Step 1: Enable required extensions first
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;


-- =============================================================================
-- Migration: 0001_init.sql
-- =============================================================================
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


-- =============================================================================
-- Migration: 0002_seed_taxonomies.sql
-- =============================================================================
-- =============================================================================
-- Seed taxonomies. Run AFTER 0001_init.sql.
-- Mirrors src/data/mock.js so app UI keeps the exact same ids/labels/icons.
-- Idempotent via ON CONFLICT.
-- =============================================================================

-- ---- life_stages ------------------------------------------------------------
insert into public.life_stages (id, label, icon, icon_color, sort_order, has_kids) values
  ('student',         'Student',                       'school-outline',        '#4A6FA5',  1, false),
  ('single',          'Single',                        'person-outline',        '#4A6FA5',  2, false),
  ('married-no-kids', 'Married — No Kids',             'heart-outline',         '#C0795A',  3, false),
  ('married-babies',  'Married w/ Babies (0–2)',       'happy-outline',         '#7A5AA8',  4, true),
  ('married-young',   'Married w/ Young Kids (2–12)',  'people-outline',        '#5A7A4A',  5, true),
  ('married-teens',   'Married w/ Teens (14–18)',      'bicycle-outline',       '#A8793A',  6, true),
  ('married-mixed',   'Married w/ Mixed Ages',         'people-circle-outline', '#4A8A6A',  7, true),
  ('empty-nester',    'Empty Nester',                  'home-outline',          '#5A8A6A',  8, false),
  ('grandparent',     'Grandparent',                   'sunny-outline',         '#C0795A',  9, false)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color,
  sort_order = excluded.sort_order, has_kids = excluded.has_kids;

-- ---- activities -------------------------------------------------------------
insert into public.activities (id, label, icon, icon_color, sort_order) values
  ('surfing',     'Surfing',              'water-outline',         '#4A6FA5',  1),
  ('skating',     'Skating',              'body-outline',          '#7A5AA8',  2),
  ('beach',       'Beach / Lake / River', 'sunny-outline',         '#A8793A',  3),
  ('music',       'Playing Music',        'musical-notes-outline', '#7A5AA8',  4),
  ('sports',      'Sports',               'football-outline',      '#4A8A6A',  5),
  ('camping',     'Camping',              'bonfire-outline',       '#A8793A',  6),
  ('hiking',      'Hiking',               'leaf-outline',          '#5A8A6A',  7),
  ('fitness',     'Working Out',          'barbell-outline',       '#C0795A',  8),
  ('playgrounds', 'Playgrounds / MDO',    'happy-outline',         '#4A6FA5',  9),
  ('hunting',     'Hunting / Fishing',    'fish-outline',          '#5A7A4A', 10),
  ('dining',      'Dinner Out',           'restaurant-outline',    '#C0795A', 11),
  ('concerts',    'Concerts',             'musical-note-outline',  '#7A5AA8', 12),
  ('shopping',    'Mall / Shopping',      'bag-outline',           '#A8793A', 13)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- community_goals --------------------------------------------------------
insert into public.community_goals (id, label, icon, icon_color, sort_order) values
  ('couple-friends',   'Couple Friends',         'people-outline',          '#C0795A',  1),
  ('family-community', 'Family Community',       'home-outline',            '#5A7A4A',  2),
  ('mentorship',       'Mentorship',             'trending-up-outline',     '#4A6FA5',  3),
  ('bible-study',      'Bible Study',            'book-outline',            '#5A7A4A',  4),
  ('activity-partners','Activity Partners',      'bicycle-outline',         '#4A8A6A',  5),
  ('prayer',           'Prayer Community',       'heart-outline',           '#C0795A',  6),
  ('accountability',   'Accountability',         'shield-outline',          '#7A5AA8',  7),
  ('church-connect',   'Church Connections',     'business-outline',        '#A8793A',  8),
  ('mom-friends',      'Mom Friends',            'happy-outline',           '#4A6FA5',  9),
  ('networking',       'Business Networking',    'briefcase-outline',       '#A8793A', 10),
  ('young-adult',      'Young Adult Community',  'people-circle-outline',   '#5A8A6A', 11)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- family_values ----------------------------------------------------------
insert into public.family_values (id, label, icon, icon_color, sort_order) values
  ('no-alcohol',     'No Alcohol',            'wine-outline',          '#C0795A', 1),
  ('no-cussing',     'No Cussing',            'chatbubble-outline',    '#A8793A', 2),
  ('no-smoking',     'No Smoking',            'ban-outline',           '#4A6FA5', 3),
  ('healthy-eating', 'Eating Healthy',        'nutrition-outline',     '#5A7A4A', 4),
  ('family-worship', 'Family Worship',        'book-outline',          '#5A7A4A', 5),
  ('limit-phones',   'Limit Phones for Kids', 'phone-portrait-outline','#4A6FA5', 6)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- school_types -----------------------------------------------------------
insert into public.school_types (id, label, icon, icon_color, sort_order) values
  ('public',     'Public School',         'school-outline',   '#4A6FA5', 1),
  ('private',    'Private School',        'business-outline', '#A8793A', 2),
  ('christian',  'Christian School',      'book-outline',     '#5A7A4A', 3),
  ('classical',  'Classical Christian',   'library-outline',  '#7A5AA8', 4),
  ('homeschool', 'Homeschool',            'home-outline',     '#C0795A', 5)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- love_languages ---------------------------------------------------------
insert into public.love_languages (id, label, icon, icon_color, sort_order) values
  ('acts-of-service', 'Acts of Service',      'hammer-outline',               '#5A7A4A', 1),
  ('receiving-gifts', 'Receiving Gifts',      'gift-outline',                 '#A8793A', 2),
  ('quality-time',    'Quality Time',         'time-outline',                 '#4A6FA5', 3),
  ('words',           'Words of Affirmation', 'chatbubble-ellipses-outline',  '#7A5AA8', 4),
  ('physical-touch',  'Physical Touch',       'hand-left-outline',            '#C0795A', 5)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- a handful of seed churches near 30A so the app isn't empty -------------
insert into public.churches (id, name, city, state, location, is_verified) values
  (gen_random_uuid(), 'Bayside Church',           'Santa Rosa Beach', 'FL', ST_SetSRID(ST_MakePoint(-86.205, 30.388), 4326)::geography, true),
  (gen_random_uuid(), 'Seacoast Community Church','Santa Rosa Beach', 'FL', ST_SetSRID(ST_MakePoint(-86.215, 30.378), 4326)::geography, true),
  (gen_random_uuid(), 'Calvary Chapel',           'Destin',           'FL', ST_SetSRID(ST_MakePoint(-86.495, 30.393), 4326)::geography, true),
  (gen_random_uuid(), 'CrossPoint Church',        'Niceville',        'FL', ST_SetSRID(ST_MakePoint(-86.481, 30.516), 4326)::geography, true)
on conflict do nothing;


-- =============================================================================
-- Migration: 0003_complete_onboarding.sql
-- =============================================================================
-- =============================================================================
-- 0003: Personality columns + complete_onboarding RPC
-- Run AFTER 0001_init.sql and 0002_seed_taxonomies.sql.
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------- Add personality bool columns to profiles -------------------------
-- Collected in the onboarding "personality" step (initiator? outgoing?).
alter table public.profiles
  add column if not exists is_initiator boolean,
  add column if not exists is_outgoing  boolean;

-- =============================================================================
-- complete_onboarding(...)
--   Single-transaction submit for the onboarding flow.
--   Updates the caller's profile row + replaces their M:M taxonomy rows
--   (activities, goals, values) atomically. Sets onboarding_complete = true so
--   the navigator routes the user past Onboarding on next render.
--
--   security definer so the function runs with elevated privileges to bypass
--   the RLS deletes on profile_activities/goals/values — auth.uid() is hardcoded
--   so callers can only ever modify their own rows.
-- =============================================================================
create or replace function public.complete_onboarding(
  p_life_stage    text,
  p_school_type   text,
  p_love_language text,
  p_church_id     uuid,
  p_city          text,
  p_state         text,
  p_is_initiator  boolean,
  p_is_outgoing   boolean,
  p_activities    text[],
  p_goals         text[],
  p_values        text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Core profile row
  update public.profiles set
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = p_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  -- Replace activities (delete + insert; supports re-running onboarding)
  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x
    on conflict do nothing;
  end if;

  -- Replace goals
  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x
    on conflict do nothing;
  end if;

  -- Replace values
  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[]
) to authenticated;

-- =============================================================================
-- DONE. Verify with: select proname from pg_proc where proname = 'complete_onboarding';
-- =============================================================================


-- =============================================================================
-- Migration: 0004_top_matches_detailed.sql
-- =============================================================================
-- =============================================================================
-- 0004: top_matches_detailed() RPC
-- Single-call enriched match feed for HomeScreen / Discover.
-- Returns score + distance + profile + life-stage label + church name +
-- activities[] for each match — everything the PersonCard needs in one shot.
-- =============================================================================

create or replace function public.top_matches_detailed(p_limit int default 25)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb
) language sql stable
set search_path = public
as $$
  with base as (
    select * from public.top_matches(p_limit)
  )
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int) to authenticated;


-- =============================================================================
-- Migration: 0005_thread_rpcs.sql
-- =============================================================================
-- =============================================================================
-- 0005: Thread RPCs
--   start_direct_thread(p_other)  — find-or-create a 1:1 direct thread
--   my_threads_detailed()         — enriched inbox feed for MessagesScreen
-- =============================================================================

-- ---------- start_direct_thread ---------------------------------------------
-- Idempotent: returns the existing direct thread if one already exists between
-- the caller and the target; otherwise creates a new thread + 2 participants.
-- security definer so we can insert into thread_participants for both users
-- in one transaction (the RLS "tp insert self" policy would only allow the
-- caller to insert their own row).
create or replace function public.start_direct_thread(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if v_me = p_other then
    raise exception 'cannot start a thread with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'target profile not found';
  end if;

  -- Existing direct thread that has BOTH of us as the only participants
  select t.id into v_thread
  from public.threads t
  where t.kind = 'direct'
    and exists (select 1 from public.thread_participants tp
                where tp.thread_id = t.id and tp.profile_id = v_me)
    and exists (select 1 from public.thread_participants tp
                where tp.thread_id = t.id and tp.profile_id = p_other)
    and (select count(*) from public.thread_participants tp
         where tp.thread_id = t.id) = 2
  limit 1;

  if v_thread is not null then
    return v_thread;
  end if;

  insert into public.threads (kind) values ('direct') returning id into v_thread;
  insert into public.thread_participants (thread_id, profile_id) values (v_thread, v_me);
  insert into public.thread_participants (thread_id, profile_id) values (v_thread, p_other);
  return v_thread;
end;
$$;

grant execute on function public.start_direct_thread(uuid) to authenticated;


-- ---------- my_threads_detailed ---------------------------------------------
-- Inbox feed. One row per thread the caller participates in, with:
--   other party's profile (1:1 case only — group threads return null other)
--   last message body + sender + timestamp
--   caller's last_read_at + unread count
create or replace function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  last_message_at       timestamptz,
  last_message_body     text,
  last_message_sender   uuid,
  last_read_at          timestamptz,
  unread_count          int
)
language sql
stable
set search_path = public
as $$
  with my_threads as (
    select tp.thread_id, tp.last_read_at
    from public.thread_participants tp
    where tp.profile_id = auth.uid()
  ),
  other_party as (
    -- For direct threads pick the single other participant. For group threads
    -- this returns one arbitrary other member (we'll improve when groups ship).
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id          as other_id,
           p.full_name   as other_name,
           p.handle::text as other_handle
    from public.thread_participants tp
    join public.profiles p on p.id = tp.profile_id
    where tp.thread_id in (select thread_id from my_threads)
      and tp.profile_id <> auth.uid()
    order by tp.thread_id, tp.joined_at asc
  ),
  last_msg as (
    select distinct on (m.thread_id)
           m.thread_id, m.body, m.sender_id, m.created_at
    from public.messages m
    where m.thread_id in (select thread_id from my_threads)
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::int as cnt
    from public.messages m
    join my_threads mt on mt.thread_id = m.thread_id
    where m.sender_id <> auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
    group by m.thread_id
  )
  select t.id              as thread_id,
         t.kind,
         op.other_id        as other_profile_id,
         op.other_name      as other_full_name,
         op.other_handle    as other_handle,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op on op.thread_id = t.id
  left join last_msg     lm on lm.thread_id = t.id
  left join unread       u  on u.thread_id  = t.id
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;


-- =============================================================================
-- Migration: 0006_avatars.sql
-- =============================================================================
-- =====================================================================
-- 0006_avatars.sql
-- Adds avatar support: profile column + public storage bucket + RLS.
-- =====================================================================

-- ---- 1. profiles.avatar_url -----------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;

-- ---- 2. Storage bucket: avatars -------------------------------------
-- Public bucket so we can serve URLs without signed-URL gymnastics.
-- File path convention: {user_id}/avatar.jpg
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = excluded.public;

-- ---- 3. RLS policies on storage.objects -----------------------------
-- Anyone (even anon) can READ — bucket is public.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Only the owner can INSERT/UPDATE/DELETE their own avatar files.
-- We enforce ownership by requiring the top-level folder of the path
-- to equal the user's auth.uid().
drop policy if exists "avatars: owner write" on storage.objects;
create policy "avatars: owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 4. Surface avatar_url in the matches feed ---------------------
-- top_matches_detailed must return avatar_url so the Discover feed and
-- MatchDetail screens can render real photos. We have to DROP the existing
-- function first because we're changing its return type (adding avatar_url) —
-- `create or replace function` cannot change a function's return signature.
drop function if exists public.top_matches_detailed(int);

create or replace function public.top_matches_detailed(p_limit int default 25)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb
) language sql stable
set search_path = public
as $$
  with base as (
    select * from public.top_matches(p_limit)
  )
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int) to authenticated;


-- =============================================================================
-- Migration: 0007_profile_photos.sql
-- =============================================================================
-- =============================================================================
-- 0007_profile_photos.sql
-- Multi-photo highlight reel: storage bucket, RLS, helper RPCs.
-- Uses the existing public.photos table (owner_kind='profile') from 0001.
-- =============================================================================

-- ---- 1. Storage bucket: profile-photos -------------------------------------
-- Public bucket. Path convention: {user_id}/{photo_id}.jpg
insert into storage.buckets (id, name, public)
  values ('profile-photos', 'profile-photos', true)
  on conflict (id) do update set public = excluded.public;

-- ---- 2. RLS on storage.objects --------------------------------------------
drop policy if exists "profile-photos: public read" on storage.objects;
create policy "profile-photos: public read"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

drop policy if exists "profile-photos: owner insert" on storage.objects;
create policy "profile-photos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'profile-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile-photos: owner update" on storage.objects;
create policy "profile-photos: owner update"
  on storage.objects for update
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile-photos: owner delete" on storage.objects;
create policy "profile-photos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 3. Helper RPC: get_profile_photos(p_profile) -------------------------
-- Returns photos for any profile, ordered by sort_order then created_at.
-- Includes the public URL so the client doesn't need to construct it.
create or replace function public.get_profile_photos(p_profile uuid)
returns table (
  id           uuid,
  storage_path text,
  url          text,
  sort_order   int,
  created_at   timestamptz
)
language sql stable
set search_path = public
as $$
  select
    ph.id,
    ph.storage_path,
    -- Build absolute URL using Supabase's public object path.
    -- This is hardcoded for the 'profile-photos' bucket.
    (
      select concat(
        rtrim(current_setting('app.settings.storage_url', true), '/'),
        '/storage/v1/object/public/profile-photos/',
        ph.storage_path
      )
    ) as url,
    ph.sort_order,
    ph.created_at
  from public.photos ph
  where ph.owner_kind = 'profile'
    and ph.owner_id   = p_profile
  order by ph.sort_order asc, ph.created_at asc;
$$;

grant execute on function public.get_profile_photos(uuid) to authenticated, anon;

-- NOTE: The `url` column above depends on a custom GUC that we don't actually
-- set in Supabase, so it will be NULL. That's fine — the client computes the
-- URL via supabase.storage.from('profile-photos').getPublicUrl(path), which
-- is the canonical Supabase way. We keep the column in the return type so
-- callers can use it later if we ever wire the GUC.

-- ---- 4. Reorder helper ----------------------------------------------------
-- Caller passes an array of photo IDs in the desired order. We update
-- sort_order to match. RLS ensures the caller can only update their own rows.
create or replace function public.reorder_profile_photos(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_idx int := 0;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  foreach v_id in array p_ids loop
    update public.photos
      set sort_order = v_idx
      where id = v_id
        and owner_kind = 'profile'
        and owner_id   = v_me;
    v_idx := v_idx + 1;
  end loop;
end;
$$;

grant execute on function public.reorder_profile_photos(uuid[]) to authenticated;


-- =============================================================================
-- Migration: 0008_wave_and_reciprocal.sql
-- =============================================================================
-- =============================================================================
-- 0008_wave_and_reciprocal.sql
-- Adds:
--   - 'wave' kind on connection_kind enum
--   - connection_status_with(p_other) RPC: my outbound + their inbound status
--   - inbound_connections(): people who've connected/waved at me (Likes-You feed)
--   - top_matches_detailed: now also returns inbound flags so the Discover feed
--     can render "they liked you" / "they waved" badges on first paint.
-- =============================================================================

-- ---- 1. Add 'wave' to connection_kind enum --------------------------------
do $$
begin
  alter type public.connection_kind add value if not exists 'wave';
exception when duplicate_object then null;
end $$;

-- ---- 2. connection_status_with(p_other) -----------------------------------
-- Returns a single row describing the connection state between me and p_other.
--   my_kind         — my outbound kind (NULL if I haven't acted)
--   their_kind      — their outbound kind toward me (NULL if they haven't)
--   is_match        — both sides have 'like' (mutual)
create or replace function public.connection_status_with(p_other uuid)
returns table (
  my_kind     public.connection_kind,
  their_kind  public.connection_kind,
  is_match    boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       mine as (
         select kind from public.connections
         where from_profile = (select id from me)
           and to_profile = p_other
           -- "Like" trumps "wave" if both exist; surface the strongest signal.
         order by case kind when 'like' then 0 when 'wave' then 1 else 2 end
         limit 1
       ),
       theirs as (
         select kind from public.connections
         where from_profile = p_other
           and to_profile = (select id from me)
         order by case kind when 'like' then 0 when 'wave' then 1 else 2 end
         limit 1
       )
  select
    (select kind from mine)                                          as my_kind,
    (select kind from theirs)                                        as their_kind,
    ((select kind from mine) = 'like' and (select kind from theirs) = 'like') as is_match;
$$;

grant execute on function public.connection_status_with(uuid) to authenticated;

-- ---- 3. inbound_connections() — "wants to connect with you" feed ----------
-- People who've sent me a 'like' or 'wave'. Most recent first.
-- For each, also returns my outbound kind so the UI can render the right CTA
-- (e.g. "Connect back" vs "Connected").
create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.avatar_url,
    ls.label                              as life_stage_label,
    p.city,
    p.state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;

grant execute on function public.inbound_connections() to authenticated;

-- ---- 4. top_matches_detailed: add inbound flags ---------------------------
-- Drop+recreate to change return type.
drop function if exists public.top_matches_detailed(int);

create or replace function public.top_matches_detailed(p_limit int default 25)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,  -- their outbound toward me
  my_kind           public.connection_kind,  -- my outbound toward them
  is_match          boolean
) language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (select * from public.top_matches(p_limit))
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int) to authenticated;


-- =============================================================================
-- Migration: 0009_update_profile.sql
-- =============================================================================
-- =============================================================================
-- 0009_update_profile.sql
-- Lightweight profile-editing RPC for the Edit Profile screen.
--
-- All params are nullable: pass NULL to leave a field unchanged.
-- Array params, when passed, REPLACE the existing set (matches onboarding).
-- Pass an empty array to clear a set; NULL to leave it as-is.
-- =============================================================================

create or replace function public.update_profile(
  p_full_name     text default null,
  p_bio           text default null,
  p_city          text default null,
  p_state         text default null,
  p_life_stage    text default null,
  p_church_id     uuid default null,
  p_love_language text default null,
  p_school_type   text default null,
  p_is_initiator  boolean default null,
  p_is_outgoing   boolean default null,
  -- arrays: NULL = leave unchanged; non-NULL (even empty) = replace
  p_activities    text[] default null,
  p_goals         text[] default null,
  p_values        text[] default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    full_name        = coalesce(p_full_name, full_name),
    bio              = coalesce(p_bio,       bio),
    city             = coalesce(p_city,      city),
    state            = coalesce(p_state,     state),
    life_stage_id    = coalesce(p_life_stage,    life_stage_id),
    church_id        = coalesce(p_church_id,     church_id),
    love_language_id = coalesce(p_love_language, love_language_id),
    school_type_id   = coalesce(p_school_type,   school_type_id),
    is_initiator     = coalesce(p_is_initiator,  is_initiator),
    is_outgoing      = coalesce(p_is_outgoing,   is_outgoing),
    last_active_at   = now()
  where id = v_uid;

  -- Activities: replace if passed
  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, x from unnest(p_activities) as x
      on conflict do nothing;
    end if;
  end if;

  -- Goals
  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, x from unnest(p_goals) as x
      on conflict do nothing;
    end if;
  end if;

  -- Values
  if p_values is not null then
    delete from public.profile_values where profile_id = v_uid;
    if array_length(p_values, 1) is not null then
      insert into public.profile_values (profile_id, value_id)
      select v_uid, x from unnest(p_values) as x
      on conflict do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.update_profile(
  text, text, text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[]
) to authenticated;


-- =============================================================================
-- Migration: 0010_group_rpcs.sql
-- =============================================================================
-- =============================================================================
-- 0010_group_rpcs.sql
-- Groups feed + actions:
--   - my_groups_feed()       : joined + suggested in one round-trip
--   - join_group(p_group)    : adds caller as member
--   - leave_group(p_group)   : removes caller
--   - create_group(...)      : creates group + owner membership
-- =============================================================================

-- ---- my_groups_feed --------------------------------------------------------
-- Returns rows for every public group + every group the user is a member of.
-- `is_member` indicates whether the caller is in the group, so the client
-- splits the response into "Joined" vs "Suggested" sections.
create or replace function public.my_groups_feed()
returns table (
  id            uuid,
  name          text,
  description   text,
  icon          text,
  icon_color    text,
  icon_bg       text,
  city          text,
  state         text,
  schedule_text text,
  member_count  int,
  church_id     uuid,
  is_member     boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member
  from public.groups g
  where g.is_public
     or exists (
       select 1 from public.group_members gm
       where gm.group_id = g.id and gm.profile_id = (select id from me)
     )
  order by
    -- joined groups float to the top, then by member_count desc
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    g.member_count desc,
    g.created_at  desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;

-- ---- join_group ------------------------------------------------------------
create or replace function public.join_group(p_group uuid)
returns void
language plpgsql
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  insert into public.group_members (group_id, profile_id, role)
    values (p_group, v_me, 'member')
    on conflict do nothing;
end;
$$;

grant execute on function public.join_group(uuid) to authenticated;

-- ---- leave_group -----------------------------------------------------------
create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.group_members
    where group_id = p_group and profile_id = v_me;
end;
$$;

grant execute on function public.leave_group(uuid) to authenticated;

-- ---- create_group ----------------------------------------------------------
-- Atomic: insert group row + owner membership. Returns new group id.
create or replace function public.create_group(
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
  p_icon          text default 'people-outline',
  p_icon_color    text default '#5A7A4A',
  p_icon_bg       text default '#EDF3EA'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  insert into public.groups
    (name, description, city, state, schedule_text, icon, icon_color, icon_bg,
     is_public, created_by)
    values
    (btrim(p_name), nullif(btrim(coalesce(p_description,'')),''),
     nullif(btrim(coalesce(p_city,'')),''),
     nullif(btrim(coalesce(p_state,'')),''),
     nullif(btrim(coalesce(p_schedule_text,'')),''),
     coalesce(p_icon,       'people-outline'),
     coalesce(p_icon_color, '#5A7A4A'),
     coalesce(p_icon_bg,    '#EDF3EA'),
     true, v_me)
  returning id into v_id;

  insert into public.group_members (group_id, profile_id, role)
    values (v_id, v_me, 'owner')
    on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function public.create_group(text, text, text, text, text, text, text, text) to authenticated;


-- =============================================================================
-- Migration: 0011_geocode_and_messaging.sql
-- =============================================================================
-- =============================================================================
-- 0011_geocode_and_messaging.sql
-- Adds:
--   - set_profile_location(lat, lng)   — writes PostGIS point from coords
--   - messageable_contacts()           — list for the "New Message" picker
--   - discover_debug()                 — debug RPC: every profile + why it
--                                        matches or doesn't (handy when an
--                                        account doesn't show up in Discover)
-- =============================================================================

-- ---- set_profile_location --------------------------------------------------
-- Takes lat/lng (WGS84), writes geography(point, 4326) to profiles.location.
-- Caller can only update their own row (auth.uid()).
create or replace function public.set_profile_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_lat is null or p_lng is null then
    -- Null coords = clear location
    update public.profiles set location = null where id = v_me;
    return;
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'lat/lng out of range';
  end if;
  update public.profiles
    set location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    where id = v_me;
end;
$$;

grant execute on function public.set_profile_location(double precision, double precision) to authenticated;


-- ---- messageable_contacts --------------------------------------------------
-- Returns profiles I can start a new direct thread with:
-- anyone I've connected/waved at, or who has connected/waved at me.
-- Sorted: matches first, then by most recent connection.
create or replace function public.messageable_contacts()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  is_match          boolean,
  last_touch        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  related as (
    -- People I've acted on
    select c.to_profile as other, max(c.created_at) as last_touch
    from public.connections c
    where c.from_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.to_profile
    union
    -- People who've acted on me
    select c.from_profile as other, max(c.created_at)
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.from_profile
  ),
  collapsed as (
    select other, max(last_touch) as last_touch
    from related
    group by other
  )
  select
    p.id              as profile_id,
    p.full_name,
    p.handle::text    as handle,
    p.avatar_url,
    ls.label          as life_stage_label,
    p.city,
    p.state,
    (
      exists (select 1 from public.connections cn
              where cn.from_profile = (select id from me)
                and cn.to_profile = p.id and cn.kind = 'like')
      and
      exists (select 1 from public.connections cn
              where cn.from_profile = p.id
                and cn.to_profile = (select id from me) and cn.kind = 'like')
    ) as is_match,
    c.last_touch
  from collapsed c
  join public.profiles p on p.id = c.other
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by is_match desc, c.last_touch desc;
$$;

grant execute on function public.messageable_contacts() to authenticated;


-- ---- discover_debug --------------------------------------------------------
-- Returns EVERY profile in the system, with the reason it's included/excluded
-- from your Discover feed. Useful when a freshly-onboarded account doesn't
-- appear. NOT used by the app — for SQL editor debugging only.
create or replace function public.discover_debug()
returns table (
  profile_id          uuid,
  full_name           text,
  handle              text,
  onboarding_complete boolean,
  has_location        boolean,
  is_self             boolean,
  is_blocked_by_me    boolean,
  is_blocked_by_them  boolean,
  score               int,
  appears_in_discover boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.onboarding_complete,
    (p.location is not null) as has_location,
    (p.id = (select id from me)) as is_self,
    exists (select 1 from public.connections c
            where c.from_profile = (select id from me)
              and c.to_profile = p.id
              and c.kind in ('skip','block')) as is_blocked_by_me,
    exists (select 1 from public.connections c
            where c.from_profile = p.id
              and c.to_profile = (select id from me)
              and c.kind = 'block') as is_blocked_by_them,
    public.match_score((select id from me), p.id) as score,
    (
      p.id <> (select id from me)
      and p.onboarding_complete = true
      and not exists (select 1 from public.connections c
                      where c.from_profile = (select id from me)
                        and c.to_profile = p.id
                        and c.kind in ('skip','block'))
      and not exists (select 1 from public.connections c
                      where c.from_profile = p.id
                        and c.to_profile = (select id from me)
                        and c.kind = 'block')
    ) as appears_in_discover
  from public.profiles p
  order by appears_in_discover desc, score desc;
$$;

grant execute on function public.discover_debug() to authenticated;


-- =============================================================================
-- Migration: 0012_activity_inbox.sql
-- =============================================================================
-- =============================================================================
-- 0012_activity_inbox.sql
-- Activity inbox: lets the recipient of a connect/wave mark notifications as
-- seen (so the badge clears) or soft-dismiss them (so they stop showing in
-- the Activity feed, but the underlying connection row stays — they can still
-- appear in the matches feed and can re-request).
--
-- New columns on connections:
--   seen_at       — when the recipient opened Activity for this row
--   dismissed_at  — when the recipient soft-dismissed the row
--
-- New RPCs:
--   mark_inbound_seen(p_from)    — mark inbound rows from one sender as seen
--                                  (or all when p_from is NULL)
--   dismiss_inbound(p_from)      — soft-dismiss inbound rows from one sender
--   unread_inbound_count()       — int count for tab badge
--
-- Also updates inbound_connections() to filter out dismissed rows and to
-- return seen_at so the UI can render unseen-state styling.
-- =============================================================================

-- ---- 1. Schema: seen_at + dismissed_at -----------------------------------
alter table public.connections
  add column if not exists seen_at      timestamptz,
  add column if not exists dismissed_at timestamptz;

-- Partial index for the unread-count query (cheap; most rows will be seen).
create index if not exists idx_connections_to_unread
  on public.connections (to_profile)
  where seen_at is null and dismissed_at is null;

-- ---- 2. mark_inbound_seen(p_from) ----------------------------------------
-- Recipient marks inbound row(s) as seen. Pass NULL to mark ALL inbound seen
-- (used when the user opens the Activity tab). SECURITY DEFINER because the
-- recipient doesn't own these rows (the sender does); RLS would block them.
create or replace function public.mark_inbound_seen(p_from uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
  set seen_at = coalesce(seen_at, now())
  where to_profile = auth.uid()
    and (p_from is null or from_profile = p_from)
    and seen_at is null
    and kind in ('like','wave');
$$;
grant execute on function public.mark_inbound_seen(uuid) to authenticated;

-- ---- 3. dismiss_inbound(p_from) ------------------------------------------
-- Soft-dismiss: hides the row from the Activity feed but leaves the
-- underlying like/wave intact (so the sender can still appear in the
-- recipient's matches feed and can re-request).
create or replace function public.dismiss_inbound(p_from uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
  set dismissed_at = now()
  where to_profile = auth.uid()
    and from_profile = p_from
    and kind in ('like','wave');
$$;
grant execute on function public.dismiss_inbound(uuid) to authenticated;

-- ---- 4. unread_inbound_count() — tab badge -------------------------------
create or replace function public.unread_inbound_count()
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.connections
  where to_profile = auth.uid()
    and kind in ('like','wave')
    and seen_at is null
    and dismissed_at is null;
$$;
grant execute on function public.unread_inbound_count() to authenticated;

-- ---- 5. Rebuild inbound_connections() to filter dismissed + return seen_at
-- Drop+recreate to change return type.
drop function if exists public.inbound_connections();

create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.avatar_url,
    ls.label                              as life_stage_label,
    p.city,
    p.state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;
grant execute on function public.inbound_connections() to authenticated;


-- =============================================================================
-- Migration: 0013_my_connections.sql
-- =============================================================================
-- =============================================================================
-- 0013_my_connections.sql
-- my_connections(): returns everyone the caller is *mutually* connected with
-- (both sides have kind='like'). This is the LinkedIn-style "Connected"
-- definition, used by the Profile screen's stat card + popup list.
--
-- Replaces the old "outbound likes" count, which was misleading after the
-- accept/decline flow shipped (it counted unaccepted requests as connections).
-- =============================================================================

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  -- For each outbound like of mine, find the reciprocal like from the other
  -- side. "connected_at" is the later of the two timestamps (when it became
  -- mutual).
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.avatar_url,
    ls.label                        as life_stage_label,
    p.city,
    p.state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;


-- =============================================================================
-- Migration: 0014_remove_connection.sql
-- =============================================================================
-- =============================================================================
-- 0014_remove_connection.sql
-- Lets the caller un-do a connect or a wave they sent.
--
-- remove_connection(p_other, p_kind)
--   - p_kind = 'like'  → cancels a pending request OR disconnects a mutual match
--   - p_kind = 'wave'  → cancels a wave
--   - p_kind = null    → removes ALL my outbound connections to that person
--                        (like + wave). Use this for a single "undo everything" tap.
--
-- Only ever deletes rows where from_profile = auth.uid(); enforced by both the
-- WHERE clause and RLS.
-- =============================================================================

create or replace function public.remove_connection(p_other uuid, p_kind public.connection_kind default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_other is null then raise exception 'p_other required'; end if;

  if p_kind is null then
    delete from public.connections
    where from_profile = v_me
      and to_profile   = p_other
      and kind in ('like','wave');
  else
    delete from public.connections
    where from_profile = v_me
      and to_profile   = p_other
      and kind         = p_kind;
  end if;
end;
$$;

grant execute on function public.remove_connection(uuid, public.connection_kind) to authenticated;


-- =============================================================================
-- Migration: 0015_unread_messages_count.sql
-- =============================================================================
-- =============================================================================
-- 0015_unread_messages_count.sql
-- Tab-badge counter for the Messages tab.
--
-- Returns the total number of messages across all my threads where:
--   - I'm a participant
--   - I am NOT the sender
--   - either I've never read the thread (last_read_at IS NULL)
--     or the message arrived after my last_read_at
--
-- Polled from the FloatingTabBar every ~45s; cheap thanks to the
-- (thread_id, created_at) index on messages.
-- =============================================================================

create or replace function public.unread_messages_count()
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.messages m
  join public.thread_participants tp
    on tp.thread_id  = m.thread_id
   and tp.profile_id = auth.uid()
  where m.sender_id <> auth.uid()
    and (tp.last_read_at is null or m.created_at > tp.last_read_at);
$$;

grant execute on function public.unread_messages_count() to authenticated;


-- =============================================================================
-- Migration: 0016_location_filter.sql
-- =============================================================================
-- =============================================================================
-- 0016_location_filter.sql
-- Adds location-filter overrides to the discover RPCs so the user can
-- "search by location" without changing their profile location.
--
--   top_matches(p_limit, p_lat, p_lng, p_radius_mi)
--   top_matches_detailed(p_limit, p_lat, p_lng, p_radius_mi)
--
-- All overrides are optional:
--   - If lat+lng are NULL, no hard radius filter (current behavior — every
--     onboarded profile returned, distance computed against MY profile
--     location when both sides have one).
--   - If lat+lng are provided, results are STRICTLY filtered to profiles
--     with a location within p_radius_mi of (lat,lng). No-location profiles
--     are excluded in that case (they can't be matched against geography).
-- =============================================================================

-- ---- top_matches (now with optional override) -----------------------------
drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);

create or replace function public.top_matches(
  p_limit       int               default 20,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, match_radius_mi
    from public.profiles
    where id = auth.uid()
  ),
  -- Materialize the override point (NULL if no override)
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if not provided)
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    -- Distance is measured from the override point when present, else from
    -- my profile location. NULL if neither side has coordinates.
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi
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
    -- Hard radius filter applies only when caller passes an override point.
    -- Default discover (no override) keeps showing no-location profiles so
    -- new users without geocoded city/state aren't invisible.
    and (
      (select pt from filter_pt) is null
      or (
        p.location is not null
        and ST_DWithin(
          (select pt from filter_pt),
          p.location,
          (select meters from filter_radius_m)
        )
      )
    )
  order by score desc, distance_mi nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- ---- top_matches_detailed (pass-through) ----------------------------------
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- ---- get_my_location ------------------------------------------------------
-- Returns the caller's profile location as plain lat/lng. NULL row when
-- the user hasn't set a location yet. Used by the Discover screen so the
-- "Near Me" filter mode can pass an override point to top_matches.
create or replace function public.get_my_location()
returns table (lat double precision, lng double precision)
language sql stable
set search_path = public
as $$
  select
    ST_Y(location::geometry)::double precision as lat,
    ST_X(location::geometry)::double precision as lng
  from public.profiles
  where id = auth.uid()
    and location is not null;
$$;

grant execute on function public.get_my_location() to authenticated;


-- =============================================================================
-- Migration: 0017_signup_fields.sql
-- =============================================================================
-- =============================================================================
-- 0017: Signup fields — phone + zip on profiles, expanded new-user trigger
-- Run AFTER 0016_location_filter.sql.
-- Idempotent: safe to re-run.
--
-- Context: the found.community website signup collects full_name, phone, zip,
-- city, state and stashes them on auth.users.raw_user_meta_data. The app signup
-- now collects the same fields. This migration:
--   1. Adds phone + zip columns to profiles.
--   2. Rewrites handle_new_user() to copy ALL signup fields into the new
--      profile row (was: full_name only).
--   3. Backfills existing profiles from metadata (covers every website
--      early-access signup created before this migration).
-- =============================================================================

-- ---------- 1. New profile columns -------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists zip   text;

-- ---------- 2. Expand the new-user trigger -----------------------------------
-- Copies full_name, phone, zip, city, state from raw_user_meta_data.
-- nullif(trim(...), '') keeps empty metadata strings out of the table so
-- location logic and `complete_onboarding` see a clean NULL, not ''.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, zip, city, state)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'zip'),   ''),
    nullif(trim(new.raw_user_meta_data->>'city'),  ''),
    upper(nullif(trim(new.raw_user_meta_data->>'state'), ''))
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Trigger already exists from 0001; re-bind defensively in case 0017 is run
-- against a DB where the trigger was dropped.
drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. Backfill existing profiles from metadata ----------------------
-- Only fills columns that are currently NULL, so it never clobbers data a user
-- already entered through onboarding / Edit Profile.
update public.profiles p
set
  phone = coalesce(p.phone, nullif(trim(u.raw_user_meta_data->>'phone'), '')),
  zip   = coalesce(p.zip,   nullif(trim(u.raw_user_meta_data->>'zip'),   '')),
  city  = coalesce(p.city,  nullif(trim(u.raw_user_meta_data->>'city'),  '')),
  state = coalesce(p.state, upper(nullif(trim(u.raw_user_meta_data->>'state'), '')))
from auth.users u
where u.id = p.id
  and (
       p.phone is null
    or p.zip   is null
    or p.city  is null
    or p.state is null
  );

-- =============================================================================
-- DONE.
-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name in ('phone','zip');
--   -- expect 2 rows
-- =============================================================================


-- =============================================================================
-- Migration: 0018_groups_full.sql
-- =============================================================================
-- =============================================================================
-- 0018_groups_full.sql
-- Completes the Groups vertical: trigger fix, geocoding, detail/member/chat
-- RPCs, owner management, and the group-photos storage bucket.
--
-- Single-pass. No enum changes. Safe to run once on top of 0001..0017.
--
-- Sections:
--   1.  Fix bump_group_member_count (SECURITY DEFINER — the member_count bug)
--   2.  is_group_admin() helper
--   3.  create_group   (drop+recreate: adds p_lat / p_lng geocoding)
--   4.  my_groups_feed (drop+recreate: adds created_by + cover_path)
--   5.  group_detail()
--   6.  group_members_list()
--   7.  open_group_thread()
--   8.  join_group / leave_group (SECURITY DEFINER + thread participant sync)
--   9.  update_group()
--   10. delete_group()
--   11. remove_group_member()
--   12. set_group_member_role()
--   13. my_threads_detailed (replace: group threads show the group name)
--   14. group-photos storage bucket + RLS
-- =============================================================================


-- =============================================================================
-- 1. Fix member_count trigger
--   The trigger function had no SECURITY DEFINER, so its `UPDATE public.groups`
--   ran as the joining user and was blocked by the "groups update own" RLS
--   policy (owner/admin only). A regular member joined → count never moved.
--   CREATE OR REPLACE keeps the existing triggers bound to this function.
-- =============================================================================
create or replace function public.bump_group_member_count() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set member_count = member_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set member_count = greatest(0, member_count - 1) where id = old.group_id;
  end if;
  return null;
end $$;


-- =============================================================================
-- 2. is_group_admin — am I owner or admin of this group?
--   SECURITY DEFINER so it can be used inside storage.objects RLS policies.
-- =============================================================================
create or replace function public.is_group_admin(p_group uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group
      and profile_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_group_admin(uuid) to authenticated;


-- =============================================================================
-- 3. create_group — now geocodes city/state into `location`.
--   Return type unchanged (uuid) but signature changes → DROP first.
--   New params p_lat / p_lng sit between p_schedule_text and p_icon.
-- =============================================================================
drop function if exists public.create_group(text, text, text, text, text, text, text, text);

create function public.create_group(
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_icon          text default 'people-outline',
  p_icon_color    text default '#5A7A4A',
  p_icon_bg       text default '#EDF3EA'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  insert into public.groups
    (name, description, city, state, schedule_text, location,
     icon, icon_color, icon_bg, is_public, created_by)
  values
    (btrim(p_name),
     nullif(btrim(coalesce(p_description,'')),''),
     nullif(btrim(coalesce(p_city,'')),''),
     nullif(btrim(coalesce(p_state,'')),''),
     nullif(btrim(coalesce(p_schedule_text,'')),''),
     case when p_lat is not null and p_lng is not null
          then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
          else null end,
     coalesce(p_icon,       'people-outline'),
     coalesce(p_icon_color, '#5A7A4A'),
     coalesce(p_icon_bg,    '#EDF3EA'),
     true, v_me)
  returning id into v_id;

  insert into public.group_members (group_id, profile_id, role)
    values (v_id, v_me, 'owner')
    on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function public.create_group(
  text, text, text, text, text, double precision, double precision, text, text, text
) to authenticated;


-- =============================================================================
-- 4. my_groups_feed — adds created_by + cover_path.
--   Return type changes → DROP first.
--   cover_path = storage_path of the group's first photo (sort_order, created_at).
-- =============================================================================
drop function if exists public.my_groups_feed();

create function public.my_groups_feed()
returns table (
  id            uuid,
  name          text,
  description   text,
  icon          text,
  icon_color    text,
  icon_bg       text,
  city          text,
  state         text,
  schedule_text text,
  member_count  int,
  church_id     uuid,
  created_by    uuid,
  cover_path    text,
  is_member     boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member
  from public.groups g
  where g.is_public
     or exists (
       select 1 from public.group_members gm
       where gm.group_id = g.id and gm.profile_id = (select id from me)
     )
  order by
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    g.member_count desc,
    g.created_at  desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- =============================================================================
-- 5. group_detail — one row for the Group Detail screen.
--   Includes caller's membership state + role, and the cover photo path.
-- =============================================================================
create or replace function public.group_detail(p_group uuid)
returns table (
  id            uuid,
  name          text,
  description   text,
  icon          text,
  icon_color    text,
  icon_bg       text,
  city          text,
  state         text,
  schedule_text text,
  member_count  int,
  church_id     uuid,
  created_by    uuid,
  cover_path    text,
  created_at    timestamptz,
  is_member     boolean,
  my_role       text
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.created_at,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- =============================================================================
-- 6. group_members_list — roster for the Group Detail screen.
--   Ordered owner → admin → member, then by join date.
-- =============================================================================
create or replace function public.group_members_list(p_group uuid)
returns table (
  profile_id uuid,
  full_name  text,
  handle     text,
  avatar_url text,
  role       text,
  joined_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.avatar_url,
    gm.role::text,
    gm.joined_at
  from public.group_members gm
  join public.profiles p on p.id = gm.profile_id
  where gm.group_id = p_group
  order by
    case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    gm.joined_at asc;
$$;

grant execute on function public.group_members_list(uuid) to authenticated;


-- =============================================================================
-- 7. open_group_thread — find-or-create the group's chat thread.
--   SECURITY DEFINER: backfills ALL current members as thread_participants so
--   the existing messages RLS (is_thread_participant) works unchanged.
-- =============================================================================
create or replace function public.open_group_thread(p_group uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_me
  ) then
    raise exception 'not a group member';
  end if;

  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is null then
    insert into public.threads (kind, group_id)
      values ('group', p_group)
      returning id into v_thread;
  end if;

  -- Sync every current member into the thread (idempotent)
  insert into public.thread_participants (thread_id, profile_id)
    select v_thread, gm.profile_id
      from public.group_members gm
     where gm.group_id = p_group
  on conflict do nothing;

  return v_thread;
end;
$$;

grant execute on function public.open_group_thread(uuid) to authenticated;


-- =============================================================================
-- 8. join_group / leave_group — SECURITY DEFINER, keep thread participants
--    in sync. leave_group blocks the owner (must transfer or delete instead).
-- =============================================================================
create or replace function public.join_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  insert into public.group_members (group_id, profile_id, role)
    values (p_group, v_me, 'member')
    on conflict do nothing;

  -- If the group chat already exists, add the new member to it.
  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is not null then
    insert into public.thread_participants (thread_id, profile_id)
      values (v_thread, v_me)
      on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.join_group(uuid) to authenticated;


create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_role   group_role;
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select role into v_role
    from public.group_members
   where group_id = p_group and profile_id = v_me;

  if v_role is null then return; end if;   -- not a member, no-op

  if v_role = 'owner' then
    raise exception 'owner cannot leave; transfer ownership or delete the group';
  end if;

  delete from public.group_members
   where group_id = p_group and profile_id = v_me;

  -- Drop them from the group chat too.
  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is not null then
    delete from public.thread_participants
     where thread_id = v_thread and profile_id = v_me;
  end if;
end;
$$;

grant execute on function public.leave_group(uuid) to authenticated;


-- =============================================================================
-- 9. update_group — owner/admin edits group fields. Re-geocodes when lat/lng
--    are supplied; otherwise keeps the existing location.
-- =============================================================================
create or replace function public.update_group(
  p_group         uuid,
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can edit this group';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  update public.groups set
    name          = btrim(p_name),
    description   = nullif(btrim(coalesce(p_description,'')),''),
    city          = nullif(btrim(coalesce(p_city,'')),''),
    state         = nullif(btrim(coalesce(p_state,'')),''),
    schedule_text = nullif(btrim(coalesce(p_schedule_text,'')),''),
    location      = case when p_lat is not null and p_lng is not null
                         then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
                         else location end
  where id = p_group;
end;
$$;

grant execute on function public.update_group(
  uuid, text, text, text, text, text, double precision, double precision
) to authenticated;


-- =============================================================================
-- 10. delete_group — owner only. The polymorphic `photos` table has no FK to
--     groups, so its rows must be deleted manually. The groups row delete then
--     cascades group_members, group_activities, threads → participants/messages.
--
--     NOTE: storage objects in the group-photos bucket are NOT removed here.
--     The client deletes those before calling this RPC.
-- =============================================================================
create or replace function public.delete_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select profile_id into v_owner
    from public.group_members
   where group_id = p_group and role = 'owner'
   limit 1;

  if v_owner is null or v_owner <> v_me then
    raise exception 'only the owner can delete this group';
  end if;

  delete from public.photos
   where owner_kind = 'group' and owner_id = p_group;

  delete from public.groups where id = p_group;
end;
$$;

grant execute on function public.delete_group(uuid) to authenticated;


-- =============================================================================
-- 11. remove_group_member — owner/admin removes someone else.
--     Cannot remove yourself (use leave_group) or the owner.
-- =============================================================================
create or replace function public.remove_group_member(p_group uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  v_target_role group_role;
  v_thread      uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can remove members';
  end if;
  if p_profile = v_me then
    raise exception 'use leave_group to remove yourself';
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group and profile_id = p_profile;

  if v_target_role is null then return; end if;   -- already gone, no-op
  if v_target_role = 'owner' then
    raise exception 'cannot remove the group owner';
  end if;

  delete from public.group_members
   where group_id = p_group and profile_id = p_profile;

  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is not null then
    delete from public.thread_participants
     where thread_id = v_thread and profile_id = p_profile;
  end if;
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated;


-- =============================================================================
-- 12. set_group_member_role — owner only. Promote/demote between member/admin.
--     Cannot change your own role or the owner's role.
-- =============================================================================
create or replace function public.set_group_member_role(
  p_group   uuid,
  p_profile uuid,
  p_role    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  v_my_role     group_role;
  v_target_role group_role;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_role not in ('member', 'admin') then
    raise exception 'role must be member or admin';
  end if;

  select role into v_my_role
    from public.group_members
   where group_id = p_group and profile_id = v_me;

  if v_my_role is distinct from 'owner' then
    raise exception 'only the owner can change member roles';
  end if;
  if p_profile = v_me then
    raise exception 'cannot change your own role';
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group and profile_id = p_profile;

  if v_target_role is null then
    raise exception 'that person is not a member of this group';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot change the owner role';
  end if;

  update public.group_members
     set role = p_role::group_role
   where group_id = p_group and profile_id = p_profile;
end;
$$;

grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;


-- =============================================================================
-- 13. my_threads_detailed — group threads now show the group name instead of
--     an arbitrary other participant, and expose group_id so the Messages tab
--     can open them in group mode. Return type changes → DROP first.
-- =============================================================================
drop function if exists public.my_threads_detailed();

create function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  group_id              uuid,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  last_message_at       timestamptz,
  last_message_body     text,
  last_message_sender   uuid,
  last_read_at          timestamptz,
  unread_count          int
)
language sql
stable
set search_path = public
as $$
  with my_threads as (
    select tp.thread_id, tp.last_read_at
    from public.thread_participants tp
    where tp.profile_id = auth.uid()
  ),
  other_party as (
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id           as other_id,
           p.full_name    as other_name,
           p.handle::text as other_handle
    from public.thread_participants tp
    join public.profiles p on p.id = tp.profile_id
    where tp.thread_id in (select thread_id from my_threads)
      and tp.profile_id <> auth.uid()
    order by tp.thread_id, tp.joined_at asc
  ),
  last_msg as (
    select distinct on (m.thread_id)
           m.thread_id, m.body, m.sender_id, m.created_at
    from public.messages m
    where m.thread_id in (select thread_id from my_threads)
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::int as cnt
    from public.messages m
    join my_threads mt on mt.thread_id = m.thread_id
    where m.sender_id <> auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
    group by m.thread_id
  )
  select t.id              as thread_id,
         t.kind,
         t.group_id,
         case when t.kind = 'group' then null else op.other_id end      as other_profile_id,
         case when t.kind = 'group' then g.name else op.other_name end   as other_full_name,
         case when t.kind = 'group' then null else op.other_handle end   as other_handle,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread       u   on u.thread_id  = t.id
  left join public.groups g  on g.id = t.group_id
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;


-- =============================================================================
-- 14. group-photos storage bucket + RLS
--   Public bucket. Path convention: {group_id}/{photo_id}.jpg
--   Write access gated by is_group_admin() on the first path segment.
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('group-photos', 'group-photos', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "group-photos: public read" on storage.objects;
create policy "group-photos: public read"
  on storage.objects for select
  using (bucket_id = 'group-photos');

drop policy if exists "group-photos: admin insert" on storage.objects;
create policy "group-photos: admin insert"
  on storage.objects for insert
  with check (
    bucket_id = 'group-photos'
    and auth.role() = 'authenticated'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "group-photos: admin update" on storage.objects;
create policy "group-photos: admin update"
  on storage.objects for update
  using (
    bucket_id = 'group-photos'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'group-photos'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "group-photos: admin delete" on storage.objects;
create policy "group-photos: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'group-photos'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0019_matches_created_at.sql
-- =============================================================================
-- 0019_matches_created_at.sql
-- Adds `created_at` to top_matches_detailed so the Discover "New" filter chip
-- can surface profiles created within the last N days. Pure pass-through add:
-- the returns table gains one column and the select gains `p.created_at`.
-- Based verbatim on the 0016 definition — nothing else changes.

-- Postgres can't change a function's return type via CREATE OR REPLACE
-- (error 42P13). Drop the existing signatures first, then recreate.
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match,
    p.created_at
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- Migration: 0020_saved_profiles.sql
-- =============================================================================
-- 0020_saved_profiles.sql
-- "Connect Later" — a PRIVATE saved list. Replaces the old "Wave" action.
--
-- Why a separate table (not a new connection_kind):
--   public.connections RLS lets the *recipient* read rows where they're the
--   target (to_profile = auth.uid()). Putting "saves" there would leak to the
--   saved person that they'd been saved. Connect Later must be private to the
--   saver, so it gets its own table with owner-only RLS.

create table if not exists public.saved_profiles (
  saver_id   uuid not null references public.profiles(id) on delete cascade,
  saved_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (saver_id, saved_id),
  check (saver_id <> saved_id)
);

-- Lookup by owner (the only access pattern) is already covered by the PK,
-- whose leading column is saver_id.

alter table public.saved_profiles enable row level security;

-- Owner-only: you can read, add, and remove ONLY your own saved rows.
drop policy if exists "saved_profiles read own" on public.saved_profiles;
create policy "saved_profiles read own" on public.saved_profiles
  for select using (saver_id = auth.uid());

drop policy if exists "saved_profiles write own" on public.saved_profiles;
create policy "saved_profiles write own" on public.saved_profiles
  for all using (saver_id = auth.uid()) with check (saver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Retire "Wave": the action is gone from the app. Purge any existing wave
-- rows so they stop surfacing in Activity inboxes. The 'wave' enum value is
-- left in connection_kind (Postgres can't drop enum values cleanly) — nothing
-- writes it anymore.
delete from public.connections where kind = 'wave';


-- =============================================================================
-- Migration: 0021_bio_in_connection_rpcs.sql
-- =============================================================================
-- =============================================================================
-- 0021_bio_in_connection_rpcs.sql
-- Adds `bio` to inbound_connections() and my_connections() so the new
-- MatchDetail "About" section renders no matter which surface opened it
-- (Discover already had bio via top_matches_detailed; this closes the gap for
-- the Activity inbox and the Profile "Connected" list).
--
-- Pure pass-through add for both RPCs: returns table gains one column, the
-- select gains p.bio. Nothing else changes — recreated verbatim from 0012/0013.
--
-- CREATE OR REPLACE can't change a function's return type (error 42P13), so
-- each function is dropped first.
-- =============================================================================

-- ---- 1. inbound_connections() -------------------------------------------------
drop function if exists public.inbound_connections();

create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.bio,
    p.avatar_url,
    ls.label                              as life_stage_label,
    p.city,
    p.state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;
grant execute on function public.inbound_connections() to authenticated;

-- ---- 2. my_connections() ------------------------------------------------------
drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    p.city,
    p.state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;
grant execute on function public.my_connections() to authenticated;


-- =============================================================================
-- Migration: 0022_location_soft_filter.sql
-- =============================================================================
-- =============================================================================
-- 0022_location_soft_filter.sql
-- Converts the location override from a HARD radius filter to a SOFT sort.
--
-- Problem (QA P2-4):
--   0016 made `top_matches` STRICTLY exclude every profile outside the radius
--   AND every profile with a NULL location. Most profiles have no geocoded
--   PostGIS `location`, so turning on the "Near Me" filter emptied Discover.
--
-- Fix:
--   - No profile is excluded for geography reasons anymore.
--   - Each row gets an `in_radius` boolean (true only when an override point
--     is supplied AND the profile has a location inside the radius).
--   - Results are SORTED by `in_radius` first, so nearby people float to the
--     top of the feed while everyone else still shows below them.
--
-- This changes the return shape of both RPCs (adds `in_radius`), so the
-- functions are dropped and recreated. The client ignores unknown columns,
-- so no app-side change is required.
-- =============================================================================

-- ---- top_matches (soft location sort) -------------------------------------
drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);

create or replace function public.top_matches(
  p_limit       int               default 20,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, match_radius_mi
    from public.profiles
    where id = auth.uid()
  ),
  -- Materialize the override point (NULL if no override)
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if not provided)
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    -- Distance is measured from the override point when present, else from
    -- my profile location. NULL if neither side has coordinates.
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    -- Soft flag: true only when an override point is supplied AND this
    -- profile has a location inside the radius. Drives sort order, not
    -- inclusion — nobody is filtered out for geography anymore.
    case
      when (select pt from filter_pt) is null then false
      when p.location is not null
        and ST_DWithin(
          (select pt from filter_pt),
          p.location,
          (select meters from filter_radius_m)
        )
        then true
      else false
    end as in_radius
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
  -- In-radius people first, then by score, then nearest. No hard filter.
  order by in_radius desc, score desc, distance_mi asc nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- ---- top_matches_detailed (pass-through, in_radius preserved) --------------
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  in_radius         boolean,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  -- Mirror top_matches: in-radius first, then score, then nearest.
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- Migration: 0023_group_address.sql
-- =============================================================================
-- =============================================================================
-- 0023_group_address.sql
-- Adds a physical meeting address to groups.
--
--   1. groups.address          — new nullable text column.
--   2. create_group(...)       — drop+recreate with a p_address param.
--   3. group_detail(...)       — drop+recreate; returns `address` ONLY to
--                                members. Non-members get NULL so a group's
--                                meeting place (often a home) isn't exposed
--                                to anyone just browsing.
-- =============================================================================

-- ---- 1. Column -----------------------------------------------------------
alter table public.groups
  add column if not exists address text;


-- ---- 2. create_group (adds p_address) ------------------------------------
-- Signature changes → must DROP the old one first.
drop function if exists public.create_group(
  text, text, text, text, text, double precision, double precision, text, text, text
);

create or replace function public.create_group(
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_address       text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_icon          text default 'people-outline',
  p_icon_color    text default '#5A7A4A',
  p_icon_bg       text default '#EDF3EA'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  insert into public.groups
    (name, description, city, state, address, schedule_text, location,
     icon, icon_color, icon_bg, is_public, created_by)
  values
    (btrim(p_name),
     nullif(btrim(coalesce(p_description,'')),''),
     nullif(btrim(coalesce(p_city,'')),''),
     nullif(btrim(coalesce(p_state,'')),''),
     nullif(btrim(coalesce(p_address,'')),''),
     nullif(btrim(coalesce(p_schedule_text,'')),''),
     case when p_lat is not null and p_lng is not null
          then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
          else null end,
     coalesce(p_icon,       'people-outline'),
     coalesce(p_icon_color, '#5A7A4A'),
     coalesce(p_icon_bg,    '#EDF3EA'),
     true, v_me)
  returning id into v_id;

  insert into public.group_members (group_id, profile_id, role)
    values (v_id, v_me, 'owner')
    on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function public.create_group(
  text, text, text, text, text, text, double precision, double precision, text, text, text
) to authenticated;


-- ---- 3. group_detail (returns address, members only) ---------------------
-- Return type changes → must DROP the old one first.
drop function if exists public.group_detail(uuid);

create function public.group_detail(p_group uuid)
returns table (
  id            uuid,
  name          text,
  description   text,
  icon          text,
  icon_color    text,
  icon_bg       text,
  city          text,
  state         text,
  address       text,
  schedule_text text,
  member_count  int,
  church_id     uuid,
  created_by    uuid,
  cover_path    text,
  created_at    timestamptz,
  is_member     boolean,
  my_role       text
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    -- Address is members-only. Many groups meet at homes — don't leak the
    -- meeting location to people who haven't joined.
    case
      when exists (select 1 from public.group_members gm
                   where gm.group_id = g.id and gm.profile_id = auth.uid())
        then g.address
      else null
    end as address,
    g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.created_at,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- =============================================================================
-- Migration: 0024_group_posts.sql
-- =============================================================================
-- =============================================================================
-- 0024_group_posts.sql
-- Group activity feed: members + admins post text (and an optional photo);
-- the feed is visible to anyone who can see the group.
--
-- Single-pass. No enum changes. Safe to run once on top of 0001..0023.
--
-- Sections:
--   1. is_group_member()  helper (SECURITY DEFINER — usable inside RLS)
--   2. group_posts table + index
--   3. RLS policies (public read, member insert, author/admin delete)
--   4. create_group_post()   RPC
--   5. group_posts_feed()    RPC  (joined with author + can_delete flag)
--   6. delete_group_post()   RPC
--   7. group-post-photos storage bucket + RLS
-- =============================================================================


-- =============================================================================
-- 1. is_group_member — am I a member (any role) of this group?
--   SECURITY DEFINER so it can be used inside RLS + storage.objects policies.
--   Mirrors is_group_admin() from 0018.
-- =============================================================================
create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group
      and profile_id = auth.uid()
  );
$$;

grant execute on function public.is_group_member(uuid) to authenticated;


-- =============================================================================
-- 2. group_posts table
--   A post must have a body, a photo, or both — enforced by the check.
--   ON DELETE CASCADE on both FKs: deleting a group or a profile removes
--   their posts. (Storage objects are purged client-side, like group photos.)
-- =============================================================================
create table if not exists public.group_posts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id)   on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text,
  photo_url  text,
  created_at timestamptz not null default now(),
  constraint group_posts_not_empty
    check (
      (body is not null and btrim(body) <> '')
      or photo_url is not null
    )
);

create index if not exists group_posts_group_created_idx
  on public.group_posts (group_id, created_at desc);


-- =============================================================================
-- 3. RLS — direct table access is safe even though the app uses the RPCs below.
--   read:   anyone who can see the group (public group, or a member)
--   insert: members only, and you can only post as yourself
--   delete: the author, or a group owner/admin
--   (no update policy — posts are not editable in this version)
-- =============================================================================
alter table public.group_posts enable row level security;

drop policy if exists "group_posts: read" on public.group_posts;
create policy "group_posts: read"
  on public.group_posts for select
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_posts.group_id
        and (g.is_public or public.is_group_member(g.id))
    )
  );

drop policy if exists "group_posts: member insert" on public.group_posts;
create policy "group_posts: member insert"
  on public.group_posts for insert
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id)
  );

drop policy if exists "group_posts: author or admin delete" on public.group_posts;
create policy "group_posts: author or admin delete"
  on public.group_posts for delete
  using (
    author_id = auth.uid()
    or public.is_group_admin(group_id)
  );


-- =============================================================================
-- 4. create_group_post — member/admin adds a post.
--   Validates membership + non-empty content server-side.
-- =============================================================================
create or replace function public.create_group_post(
  p_group     uuid,
  p_body      text default null,
  p_photo_url text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_url  text := nullif(btrim(coalesce(p_photo_url, '')), '');
  v_id   uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'only group members can post';
  end if;
  if v_body is null and v_url is null then
    raise exception 'post must have text or a photo';
  end if;

  insert into public.group_posts (group_id, author_id, body, photo_url)
    values (p_group, v_me, v_body, v_url)
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_group_post(uuid, text, text) to authenticated;


-- =============================================================================
-- 5. group_posts_feed — the activity feed for one group, newest first.
--   Joined with the author's name/handle/avatar/role, plus a can_delete flag
--   so the client knows whether to show the delete control.
--   SECURITY DEFINER + the same public-or-member visibility gate as the RLS.
-- =============================================================================
create or replace function public.group_posts_feed(p_group uuid)
returns table (
  id            uuid,
  body          text,
  photo_url     text,
  created_at    timestamptz,
  author_id     uuid,
  author_name   text,
  author_handle text,
  author_avatar text,
  author_role   text,
  can_delete    boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    gp.id,
    gp.body,
    gp.photo_url,
    gp.created_at,
    gp.author_id,
    p.full_name                                          as author_name,
    p.handle::text                                       as author_handle,
    p.avatar_url                                         as author_avatar,
    coalesce(gm.role::text, 'member')                    as author_role,
    (gp.author_id = auth.uid() or public.is_group_admin(p_group)) as can_delete
  from public.group_posts gp
  join public.profiles p on p.id = gp.author_id
  left join public.group_members gm
    on gm.group_id = gp.group_id and gm.profile_id = gp.author_id
  where gp.group_id = p_group
    and exists (
      select 1 from public.groups g
      where g.id = p_group
        and (g.is_public or public.is_group_member(p_group))
    )
  order by gp.created_at desc;
$$;

grant execute on function public.group_posts_feed(uuid) to authenticated;


-- =============================================================================
-- 6. delete_group_post — the author or a group owner/admin removes a post.
--   Storage object for the photo (if any) is removed client-side.
-- =============================================================================
create or replace function public.delete_group_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_author uuid;
  v_group  uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select author_id, group_id into v_author, v_group
    from public.group_posts
   where id = p_post;

  if v_author is null then return; end if;   -- already gone, no-op

  if v_author <> v_me and not public.is_group_admin(v_group) then
    raise exception 'only the author or a group admin can delete this post';
  end if;

  delete from public.group_posts where id = p_post;
end;
$$;

grant execute on function public.delete_group_post(uuid) to authenticated;


-- =============================================================================
-- 7. group-post-photos storage bucket + RLS
--   Public bucket. Path convention: {group_id}/{photo_id}.jpg
--   Write access gated by is_group_member() — unlike group-photos (the gallery,
--   admin-only), any member may attach a photo to their own post.
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('group-post-photos', 'group-post-photos', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "group-post-photos: public read" on storage.objects;
create policy "group-post-photos: public read"
  on storage.objects for select
  using (bucket_id = 'group-post-photos');

drop policy if exists "group-post-photos: member insert" on storage.objects;
create policy "group-post-photos: member insert"
  on storage.objects for insert
  with check (
    bucket_id = 'group-post-photos'
    and auth.role() = 'authenticated'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "group-post-photos: member delete" on storage.objects;
create policy "group-post-photos: member delete"
  on storage.objects for delete
  using (
    bucket_id = 'group-post-photos'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0025_account_settings.sql
-- =============================================================================
-- =============================================================================
-- 0025_account_settings.sql
-- Backing store for the Profile → Settings screens (Notifications, Privacy,
-- Location). Adds three preference columns to `profiles` and one RPC to
-- update them.
--
-- Single-pass. No enum changes. Safe to run once on top of 0001..0024.
--
-- Sections:
--   1. profiles preference columns
--   2. update_account_settings() RPC
--   3. account_settings() read RPC
-- =============================================================================


-- =============================================================================
-- 1. Preference columns
--   notification_prefs / privacy_prefs — jsonb so new toggles can be added
--     without further migrations.
--   discovery_radius_miles — int; 0 means "Anywhere" (no distance limit).
-- =============================================================================
alter table public.profiles
  add column if not exists notification_prefs jsonb not null
    default '{"new_messages":true,"connections":true,"group_posts":true,"group_messages":true}'::jsonb,
  add column if not exists privacy_prefs jsonb not null
    default '{"discoverable":true,"show_church":true,"show_location":true}'::jsonb,
  add column if not exists discovery_radius_miles int not null default 50;


-- =============================================================================
-- 2. update_account_settings — partial update; pass only the group you changed.
--   jsonb params: null leaves that group untouched.
--   discovery_radius_miles: null leaves it untouched; 0 = Anywhere.
-- =============================================================================
create or replace function public.update_account_settings(
  p_notification_prefs     jsonb default null,
  p_privacy_prefs          jsonb default null,
  p_discovery_radius_miles int   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  if p_discovery_radius_miles is not null
     and (p_discovery_radius_miles < 0 or p_discovery_radius_miles > 1000) then
    raise exception 'discovery radius out of range';
  end if;

  update public.profiles set
    notification_prefs     = coalesce(p_notification_prefs, notification_prefs),
    privacy_prefs          = coalesce(p_privacy_prefs, privacy_prefs),
    discovery_radius_miles = coalesce(p_discovery_radius_miles, discovery_radius_miles)
  where id = v_me;
end;
$$;

grant execute on function public.update_account_settings(jsonb, jsonb, int) to authenticated;


-- =============================================================================
-- 3. account_settings — read the caller's current preferences in one call.
-- =============================================================================
create or replace function public.account_settings()
returns table (
  notification_prefs     jsonb,
  privacy_prefs          jsonb,
  discovery_radius_miles int,
  city                   text,
  state                  text
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.notification_prefs,
    p.privacy_prefs,
    p.discovery_radius_miles,
    p.city,
    p.state
  from public.profiles p
  where p.id = auth.uid();
$$;

grant execute on function public.account_settings() to authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0026_privacy_discovery_wiring.sql
-- =============================================================================
-- =============================================================================
-- 0026_privacy_discovery_wiring.sql
-- Makes the Profile → Settings → Privacy / Location toggles actually do
-- something. Until now the columns from 0025 were written but never read.
--
-- What this wires up:
--   privacy_prefs.discoverable  → non-discoverable profiles are EXCLUDED from
--                                 the Discover feed (top_matches).
--   discovery_radius_miles      → the viewer's saved radius now filters the
--                                 Discover feed by distance. 0 = Anywhere.
--   privacy_prefs.show_church   → other people don't see your church.
--   privacy_prefs.show_location → other people don't see your city/state or
--                                 distance.
--
-- Design notes:
--   * The radius is a HARD filter, but ONLY for profiles that have a geocoded
--     location. Profiles with no location are always kept — we can't measure
--     them, so dropping them would silently empty the feed (the bug 0022 fixed).
--   * The persistent radius is ignored while a "Near Me" location override is
--     active (the override has its own soft in_radius sort). Explicit action
--     beats a saved default.
--   * show_church / show_location are enforced server-side in every RPC that
--     returns someone else's church/location, so no client can bypass them.
--   * No signature changes → plain CREATE OR REPLACE everywhere. Grants are
--     preserved by REPLACE but re-stated for clarity.
-- =============================================================================


-- =============================================================================
-- 0. Schema guard — connections.seen_at / dismissed_at
--    inbound_connections() (section 3) reads these columns. They were added
--    by migration 0012, which was never applied to this database. Without
--    this guard the CREATE of inbound_connections fails immediately with
--    42703 (language sql bodies are validated at create time).
--    `add column if not exists` makes this a no-op if 0012 was applied.
-- =============================================================================
alter table public.connections
  add column if not exists seen_at      timestamptz,
  add column if not exists dismissed_at timestamptz;

create index if not exists idx_connections_to_unread
  on public.connections (to_profile)
  where seen_at is null and dismissed_at is null;


-- =============================================================================
-- 1. top_matches — discoverable filter + persistent discovery-radius filter
-- =============================================================================
create or replace function public.top_matches(
  p_limit       int               default 20,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  -- Materialize the "Near Me" override point (NULL if no override).
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if not provided).
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    case
      when (select pt from filter_pt) is null then false
      when p.location is not null
        and ST_DWithin(
          (select pt from filter_pt),
          p.location,
          (select meters from filter_radius_m)
        )
        then true
      else false
    end as in_radius
  from public.profiles p, me
  where p.id <> me.id
    and p.onboarding_complete = true
    -- Privacy → Discoverable. Opted-out profiles never appear in Discover.
    -- coalesce defends against a missing/edited jsonb key.
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    -- Persistent discovery radius. Skipped when a "Near Me" override is active
    -- (p_lat not null), when the viewer has no location to measure from, or
    -- when the viewer chose "Anywhere" (0). Ungeocoded candidates always pass.
    and (
      p_lat is not null
      or me.location is null
      or coalesce(me.discovery_radius_miles, 0) = 0
      or p.location is null
      or ST_DWithin(
           me.location,
           p.location,
           coalesce(me.discovery_radius_miles, 0)::float * 1609.34
         )
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  order by in_radius desc, score desc, distance_mi asc nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 2. top_matches_detailed — hide church / city / state / distance per the
--    target profile's privacy_prefs. Sort still uses the REAL base distance,
--    so hiding a location never changes feed ordering, only what's displayed.
-- =============================================================================
create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  in_radius         boolean,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    -- Distance is part of "location" — hidden when show_location is off.
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                       as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                              as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 3. inbound_connections — hide city/state per the sender's show_location.
--    (No church column here, so show_church does not apply.)
-- =============================================================================
-- Return type changes (city/state nulling) → DROP before recreate.
drop function if exists public.inbound_connections();

create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.bio,
    p.avatar_url,
    ls.label                              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end        as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end       as state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;

grant execute on function public.inbound_connections() to authenticated;


-- =============================================================================
-- 4. my_connections — hide city/state per the connection's show_location.
-- =============================================================================
-- Return type changes (city/state nulling) → DROP before recreate.
drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0027_notifications.sql
-- =============================================================================
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


-- =============================================================================
-- Migration: 0028_push_notifications.sql
-- =============================================================================
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


-- =============================================================================
-- Migration: 0029_radius_hard_filter.sql
-- =============================================================================
-- =============================================================================
-- 0029_radius_hard_filter.sql
-- Makes the mile radius an ACTUAL filter — in both places it can be set.
--
--   1. Discover location pill (Near Me / Search a city) — the p_lat/p_lng/
--      p_radius_mi override. Before 0029 this was a SOFT sort (migration 0022):
--      picking "10 mi" only floated nearby people up — everyone else still
--      showed. Now it is a HARD filter: only profiles within p_radius_mi of
--      the override point come back.
--
--   2. Settings -> Location Settings -> Discovery radius — the viewer's
--      profiles.discovery_radius_miles. It was already a hard filter as of
--      0026, but it leaked every profile with no geocoded location, and it
--      was bypassed whenever a Discover override was active. Cleaned up here.
--
-- RULE from 0029 on:
--   * If a radius is active, a profile with no `location` does NOT appear.
--     You can't place them on a map, so they can't satisfy a distance filter.
--   * "Anywhere" still shows everyone:
--       - Discover pill = Anywhere  -> no override; falls back to the saved
--         Discovery radius.
--       - Discovery radius = 0      -> no distance limit at all.
--       - Viewer has no location    -> nothing to measure from -> no limit.
--   * An active Discover override (Near Me / Search a city) takes precedence
--     over the saved Discovery radius — explicit action beats a saved default.
--
-- DATA DEPENDENCY — read this:
--   Most older seed/test profiles have a NULL `location`. After this migration
--   they disappear from any radius-filtered feed until they are geocoded.
--   Run `scripts/backfill-locations.js` once to geocode them from city/state.
--   New users are already geocoded at the end of onboarding, so this only
--   affects pre-existing rows.
--
-- DRIFT-SAFE: both functions are DROPped (all known signatures) before being
-- recreated, so this applies cleanly regardless of which earlier migration
-- last touched them. top_matches_detailed also regains `created_at` (the
-- Discover "New" chip reads it; the RUN_IN_SUPABASE bundle had dropped it).
-- =============================================================================


-- =============================================================================
-- 1. top_matches — hard radius filter (override point OR saved discovery radius)
-- =============================================================================
drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);

create or replace function public.top_matches(
  p_limit       int               default 20,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  -- "Near Me" / "Search a city" override point (NULL when no override).
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  -- Override radius in meters (defaults to 25 mi if somehow omitted).
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    -- Distance from the override point when present, else from my location.
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me)  is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    -- True whenever an override is active (every returned row passed the hard
    -- filter). Kept so the client can still badge "nearby" and for sort.
    ((select pt from filter_pt) is not null) as in_radius
  from public.profiles p, me
  where p.id <> me.id
    and p.onboarding_complete = true
    -- Privacy -> Discoverable. Opted-out profiles never appear in Discover.
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    -- ── Mile radius — HARD filter ──────────────────────────────────────────
    and (
      case
        -- (A) Discover override active (Near Me / Search a city).
        --     Strict: candidate must have a location within p_radius_mi of
        --     the override point. No location -> excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (B) No override -> the viewer's saved Discovery radius.
        --     0 = Anywhere -> no filter. Viewer has no location -> nothing to
        --     measure from -> no filter. Otherwise strict; no location on the
        --     candidate -> excluded.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        when me.location is null then true
        else
          p.location is not null
          and ST_DWithin(
                me.location,
                p.location,
                me.discovery_radius_miles::float * 1609.34
              )
      end
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  order by in_radius desc, score desc, distance_mi asc nulls last
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 2. top_matches_detailed — pass-through; keeps the 0026 privacy nulling and
--    re-adds `created_at` (needed by the Discover "New" filter chip).
-- =============================================================================
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  in_radius         boolean,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    -- Distance is part of "location" — hidden when show_location is off.
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                       as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                              as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match,
    p.created_at
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- 3. set_location_by_id — admin RPC used by scripts/backfill-locations.js to
--    geocode pre-existing profiles. SECURITY DEFINER so it can write any row;
--    execute is REVOKEd from public and granted ONLY to service_role, so no
--    signed-in app user can move another person's location.
-- =============================================================================
create or replace function public.set_location_by_id(
  p_id   uuid,
  p_lat  double precision,
  p_lng  double precision
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
   where id = p_id;
$$;

revoke execute on function public.set_location_by_id(uuid, double precision, double precision) from public;
grant  execute on function public.set_location_by_id(uuid, double precision, double precision) to service_role;

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0029_welcome_email.sql
-- =============================================================================
-- =============================================================================
-- 0029_welcome_email.sql
-- Sends a welcome email via Resend on new user signup.
--
-- Architecture — 100% in-database, same pattern as push notifications (0028):
--   1. User row inserted into profiles (via handle_new_user trigger).
--   2. trg_welcome_email AFTER INSERT trigger fires send_welcome_email().
--   3. send_welcome_email() uses pg_net to POST to the Resend API.
--   4. Resend delivers from hello@found.community.
--
-- BEFORE RUNNING THIS MIGRATION you must store your Resend API key:
--   Run this once in the Supabase SQL editor (replace with your real key):
--     alter database postgres set app.resend_api_key = 're_your_key_here';
--   Get your key from: https://resend.com/api-keys
--
-- The FROM address must be a domain you've verified in Resend.
-- found.community is already verified — use any @found.community address.
--
-- Single-pass. Safe to run once on top of 0001..0028. Idempotent.
-- =============================================================================

begin;

-- Ensure pg_net is available (already created in 0028, but idempotent).
create extension if not exists pg_net;


-- =============================================================================
-- send_welcome_email()
--
-- Triggered AFTER INSERT on profiles. Reads the new user's name + email from
-- auth.users (the profiles row is created by handle_new_user which only copies
-- select fields — email lives on auth.users).
--
-- The HTML body is inlined here as a compact version. The full designed HTML
-- lives in Found.community/_emails/email-00-welcome.html — keep them in sync
-- if you redesign the email.
--
-- pg_net is fire-and-forget: the HTTP call is queued asynchronously and this
-- trigger returns immediately. A failed Resend call never blocks signup.
-- =============================================================================
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
  -- Pull email + name from auth.users (profiles only stores the UUID).
  select au.email,
         coalesce(au.raw_user_meta_data->>'full_name', au.email)
    into v_email, v_name
  from auth.users au
  where au.id = new.id;

  -- No email = can't send; bail silently (magic-link-only accounts).
  if v_email is null or btrim(v_email) = '' then
    return new;
  end if;

  -- First name for the greeting.
  v_first := split_part(coalesce(new.full_name, v_name, 'Friend'), ' ', 1);
  if v_first = '' then v_first := 'Friend'; end if;

  -- Resend API key stored as a database config parameter.
  -- Set once via: alter database postgres set app.resend_api_key = 're_xxx';
  v_api_key := current_setting('app.resend_api_key', true);
  if v_api_key is null or btrim(v_api_key) = '' then
    raise warning '[welcome_email] app.resend_api_key not set — skipping welcome email for %', v_email;
    return new;
  end if;

  -- ── Email HTML (compact inline version) ──────────────────────────────────
  -- Full designed version: Found.community/_emails/email-00-welcome.html
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

  -- ── POST to Resend ────────────────────────────────────────────────────────
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


-- =============================================================================
-- Trigger — fires once per new profile row (one new user = one welcome email).
-- profiles is written by handle_new_user() which runs AFTER INSERT on auth.users,
-- so by the time we fire here the user's email is confirmed and the row exists.
-- =============================================================================
drop trigger if exists trg_welcome_email on public.profiles;
create trigger trg_welcome_email
  after insert on public.profiles
  for each row execute function public.send_welcome_email();


commit;

-- =============================================================================
-- DONE.
--
-- Setup checklist:
--   1. Run this migration in Supabase SQL editor.
--   2. Store your Resend key:
--        alter database postgres set app.resend_api_key = 're_your_key_here';
--   3. Verify found.community is added in your Resend dashboard (already done).
--   4. Test: create a new user → check Resend logs for delivery.
--
-- To redesign the email: edit Found.community/_emails/email-00-welcome.html
-- then copy the HTML back into v_html above (escape single quotes as '').
-- =============================================================================


-- =============================================================================
-- Migration: 0030_location_from_signup.sql
-- =============================================================================
-- =============================================================================
-- 0030_location_from_signup.sql
-- Geocode ONCE, at signup. The user never enters a location again.
--
-- The app resolves the signup ZIP to coordinates (Zippopotam.us, same call the
-- ZIP -> City/State auto-fill already makes) and ships lat/lng in the signup
-- metadata. This rewrites handle_new_user() so the PostGIS `location` point is
-- written the instant the account row is created — no onboarding step, no
-- Edit Profile round-trip, no re-entry, ever.
--
-- Pre-existing accounts (created before this change) have city/zip but a NULL
-- `location`. Those are healed CLIENT-SIDE: AuthContext geocodes the stored ZIP
-- and calls set_profile_location() the first time such a profile loads. SQL
-- can't geocode, so there is intentionally no server-side backfill here.
--
-- Idempotent. Safe to re-run. Run AFTER 0029_radius_hard_filter.sql.
-- =============================================================================

-- ---------- Rewrite the new-user trigger -------------------------------------
-- Adds `location` to the inserted row. lat/lng arrive as text in
-- raw_user_meta_data; nullif(trim(...),'') yields NULL when the key is absent
-- (e.g. the website signup, which doesn't send coords yet) so the cast is only
-- ever applied to a real numeric string. Out-of-range values fall back to NULL
-- rather than failing the signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lat double precision := nullif(trim(new.raw_user_meta_data->>'lat'), '')::double precision;
  v_lng double precision := nullif(trim(new.raw_user_meta_data->>'lng'), '')::double precision;
begin
  insert into public.profiles (id, full_name, phone, zip, city, state, location)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'zip'),   ''),
    nullif(trim(new.raw_user_meta_data->>'city'),  ''),
    upper(nullif(trim(new.raw_user_meta_data->>'state'), '')),
    case
      when v_lat is not null and v_lng is not null
           and v_lat between  -90 and  90
           and v_lng between -180 and 180
        then ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Trigger exists from 0001 / 0017 — re-bind defensively in case it was dropped.
drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- set_profile_location (drift-safe re-create) ----------------------
-- The client self-heal (AuthContext) calls this to geocode pre-existing
-- accounts from their stored ZIP. Originally shipped in 0011; re-declared here
-- so the self-heal is guaranteed a working RPC even on a drifted database.
create or replace function public.set_profile_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_lat is null or p_lng is null then
    update public.profiles set location = null where id = v_me;
    return;
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'lat/lng out of range';
  end if;
  update public.profiles
    set location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    where id = v_me;
end;
$$;

grant execute on function public.set_profile_location(double precision, double precision) to authenticated;

-- =============================================================================
-- DONE.
-- Verify (run as a logged-in user, or check a specific row):
--   select id, zip, city, state, (location is not null) as has_location
--   from public.profiles;
-- New signups should have has_location = true. Pre-existing rows flip to true
-- the first time that user opens the app (client-side ZIP self-heal).
-- =============================================================================


-- =============================================================================
-- Migration: 0031_profile_detail.sql
-- =============================================================================
-- =============================================================================
-- 0031_profile_detail.sql
--
-- get_profile_detail(p_profile uuid)
--   Single-call fetch for everything MatchDetailScreen needs when opening a
--   profile that wasn't loaded through top_matches_detailed (e.g. inbound
--   connection requests, Activity screen rows).
--
--   Returns:
--     • Full profile fields (bio, church, city, state, life stage)
--     • match_score against the calling user
--     • Activities list (same jsonb shape as top_matches_detailed)
--     • connection_count  — how many mutual connections the viewed profile has
--     • group_count       — how many groups the viewed profile belongs to
--     • my_kind / their_kind / is_match — current relationship state
-- =============================================================================

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  score             int,
  activities        jsonb,
  connection_count  int,
  group_count       int,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    p.id                  as profile_id,
    p.full_name,
    p.handle::text        as handle,
    p.bio,
    p.avatar_url,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.life_stage_id,
    ls.label              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end                             as church_name,
    public.match_score((select id from me), p.id)               as score,
    -- Activities — same jsonb shape used in top_matches_detailed
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    -- connection_count: mutual connections (both sides have 'like')
    (
      select count(*)::int
      from public.connections c1
      join public.connections c2
        on c2.from_profile = c1.to_profile
       and c2.to_profile   = c1.from_profile
       and c2.kind         = 'like'
      where c1.from_profile = p.id
        and c1.kind         = 'like'
    )                                                           as connection_count,
    -- group_count: groups the viewed profile is a member of
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    -- My relationship to this profile
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    -- Their relationship to me
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    -- is_match = both sides have 'like'
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile   = p.id and m.kind = 'like'
      ) and exists (
        select 1 from public.connections t
        where t.from_profile = p.id
          and t.to_profile   = (select id from me) and t.kind = 'like'
      )
    )                                                           as is_match
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- =============================================================================
-- Migration: 0032_fix_thread_touch_trigger.sql
-- =============================================================================
-- =============================================================================
-- 0032_fix_thread_touch_trigger.sql
--
-- The touch_thread_last_message trigger function was defined without
-- SECURITY DEFINER, so its UPDATE on public.threads was blocked by RLS
-- (no UPDATE policy exists). This caused last_message_at to stay null on
-- every thread, breaking the Messages feed sort order and any filter that
-- relied on that column.
--
-- Fix: recreate the function as SECURITY DEFINER so it runs with the
-- privileges of the definer (postgres) and bypasses RLS on threads.
--
-- Also backfill last_message_at for any existing threads that have messages
-- but a null last_message_at.
-- =============================================================================

create or replace function public.touch_thread_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.threads
  set last_message_at = new.created_at
  where id = new.thread_id;
  return new;
end $$;

-- Backfill existing threads whose last_message_at is still null
-- but have at least one message in the messages table.
update public.threads t
set last_message_at = (
  select max(m.created_at)
  from public.messages m
  where m.thread_id = t.id
)
where t.last_message_at is null
  and exists (
    select 1 from public.messages m where m.thread_id = t.id
  );


-- =============================================================================
-- Migration: 0033_dismiss_all_inbound.sql
-- =============================================================================
-- =============================================================================
-- 0033_dismiss_all_inbound.sql
--
-- dismiss_all_inbound()
--   Soft-dismisses every pending inbound row for the calling user by setting
--   dismissed_at = now() on the connections rows. Mirrors dismiss_inbound()
--   but applies to all senders at once. Used by "Mark all read" on Activity.
-- =============================================================================

create or replace function public.dismiss_all_inbound()
returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
  set dismissed_at = now()
  where to_profile   = auth.uid()
    and kind         in ('like', 'wave')
    and dismissed_at is null;
$$;

grant execute on function public.dismiss_all_inbound() to authenticated;


-- =============================================================================
-- Migration: 0034_group_members_is_connection.sql
-- =============================================================================
-- 0034_group_members_is_connection.sql
--
-- Adds `is_connection` to group_members_list so the Group Detail screen can
-- show a "Friends in this group" strip to non-members and badge connected
-- members in the full roster modal.
--
-- is_connection = true when the calling user has a mutual 'like' with that
-- member (same definition used by my_connections()).
-- =============================================================================

drop function if exists public.group_members_list(uuid);

create or replace function public.group_members_list(p_group uuid)
returns table (
  profile_id    uuid,
  full_name     text,
  handle        text,
  avatar_url    text,
  role          text,
  joined_at     timestamptz,
  is_connection boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.avatar_url,
    gm.role::text,
    gm.joined_at,
    -- Mutual connection check: caller liked them AND they liked caller.
    exists (
      select 1
      from public.connections c1
      join public.connections c2
        on  c1.to_profile   = c2.from_profile
        and c1.from_profile = c2.to_profile
        and c2.kind = 'like'
      where c1.from_profile = auth.uid()
        and c1.kind         = 'like'
        and c2.from_profile = p.id
    ) as is_connection
  from public.group_members gm
  join public.profiles       p  on p.id = gm.profile_id
  where gm.group_id = p_group
  order by
    case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    gm.joined_at asc;
$$;

grant execute on function public.group_members_list(uuid) to authenticated;


-- =============================================================================
-- Migration: 0035_add_activities.sql
-- =============================================================================
-- =============================================================================
-- 0035 — Add Coffee, Golf, Tennis/Pickleball to the activities taxonomy.
-- Keeps the activities table in sync with src/data/mock.js (ACTIVITIES).
-- Idempotent via ON CONFLICT. Run BEFORE deploying the app build that offers
-- these in onboarding — profile_activities.activity_id has an FK to this table,
-- so complete_onboarding will fail if a user picks an id that doesn't exist yet.
-- =============================================================================

insert into public.activities (id, label, icon, icon_color, sort_order) values
  ('coffee',            'Coffee',              'cafe-outline',       '#A8793A', 14),
  ('golf',              'Golf',                'golf-outline',       '#5A7A4A', 15),
  ('tennis-pickleball', 'Tennis / Pickleball', 'tennisball-outline', '#4A6FA5', 16)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon,
  icon_color = excluded.icon_color, sort_order = excluded.sort_order;


-- =============================================================================
-- Migration: 0036_block_report_delete.sql
-- =============================================================================
-- =============================================================================
-- 0036_block_report_delete.sql
-- App Store compliance pack. Three mandatory features for any app with
-- user-generated content:
--
--   * Block a user        — Apple Guideline 1.2
--   * Report a user/content — Apple Guideline 1.2
--   * Delete your account  — Apple Guideline 5.1.1(v)
--
-- Single-pass. No enum changes ('block' already exists in connection_kind).
-- Safe to run once on top of 0001..0035. Idempotent where possible.
--
-- Sections:
--   1.  block_user / unblock_user / list_blocked_users
--   2.  Defensive block filters in inbound_connections, my_connections,
--       messageable_contacts, my_threads_detailed
--   3.  reports table + RLS
--   4.  report_content() RPC
--   5.  delete_account() RPC
-- =============================================================================


-- =============================================================================
-- 1. BLOCK
--   A block is a connections row with kind='block'. block_user also wipes any
--   like/wave/skip rows in BOTH directions, so the blocked pair drops out of
--   every mutual-connection RPC for free. The explicit block row is what the
--   filters in section 2 (and top_matches from 0026) key off of.
--   SECURITY DEFINER: needs to delete the other user's rows too, which the
--   "connections write own" RLS policy would block.
-- =============================================================================
create or replace function public.block_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_target is null then raise exception 'no target'; end if;
  if p_target = v_me then raise exception 'cannot block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'that profile does not exist';
  end if;

  -- Wipe every non-block connection between the two of us, both directions.
  delete from public.connections
   where kind <> 'block'
     and (
       (from_profile = v_me     and to_profile = p_target)
       or (from_profile = p_target and to_profile = v_me)
     );

  -- Record the block (idempotent).
  insert into public.connections (from_profile, to_profile, kind)
    values (v_me, p_target, 'block')
  on conflict (from_profile, to_profile, kind) do nothing;
end;
$$;

grant execute on function public.block_user(uuid) to authenticated;


create or replace function public.unblock_user(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.connections
   where from_profile = v_me
     and to_profile   = p_target
     and kind = 'block';
end;
$$;

grant execute on function public.unblock_user(uuid) to authenticated;


-- People I have blocked — backs the "Blocked Users" settings screen.
create or replace function public.list_blocked_users()
returns table (
  profile_id  uuid,
  full_name   text,
  handle      text,
  avatar_url  text,
  blocked_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id            as profile_id,
    p.full_name,
    p.handle::text  as handle,
    p.avatar_url,
    c.created_at    as blocked_at
  from public.connections c
  join public.profiles p on p.id = c.to_profile
  where c.from_profile = auth.uid()
    and c.kind = 'block'
  order by c.created_at desc;
$$;

grant execute on function public.list_blocked_users() to authenticated;


-- =============================================================================
-- 2. DEFENSIVE BLOCK FILTERS
--   block_user already deletes the like/wave rows the mutual-connection RPCs
--   rely on, so blocked pairs mostly drop out on their own. These filters are
--   belt-and-suspenders — and for my_threads_detailed they are REQUIRED:
--   blocking does not delete an existing direct thread, so without this filter
--   a blocked person would still show up in the Messages list.
--   None of these change signature/return type → plain CREATE OR REPLACE.
-- =============================================================================

-- ---- inbound_connections — drop senders I've blocked / who've blocked me ----
create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c.from_profile)
            or (b.from_profile = c.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.bio,
    p.avatar_url,
    ls.label                              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end        as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end       as state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;

grant execute on function public.inbound_connections() to authenticated;


-- ---- my_connections — drop anyone in a block relationship with me -----------
create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;


-- ---- messageable_contacts — drop anyone in a block relationship with me -----
create or replace function public.messageable_contacts()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  is_match          boolean,
  last_touch        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  related as (
    select c.to_profile as other, max(c.created_at) as last_touch
    from public.connections c
    where c.from_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.to_profile
    union
    select c.from_profile as other, max(c.created_at)
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.from_profile
  ),
  collapsed as (
    select other, max(last_touch) as last_touch
    from related
    group by other
  )
  select
    p.id              as profile_id,
    p.full_name,
    p.handle::text    as handle,
    p.avatar_url,
    ls.label          as life_stage_label,
    p.city,
    p.state,
    (
      exists (select 1 from public.connections cn
              where cn.from_profile = (select id from me)
                and cn.to_profile = p.id and cn.kind = 'like')
      and
      exists (select 1 from public.connections cn
              where cn.from_profile = p.id
                and cn.to_profile = (select id from me) and cn.kind = 'like')
    ) as is_match,
    c.last_touch
  from collapsed c
  join public.profiles p on p.id = c.other
  left join public.life_stages ls on ls.id = p.life_stage_id
  where not exists (
    select 1 from public.connections b
    where b.kind = 'block'
      and (
        (b.from_profile = (select id from me) and b.to_profile = p.id)
        or (b.from_profile = p.id and b.to_profile = (select id from me))
      )
  )
  order by is_match desc, c.last_touch desc;
$$;

grant execute on function public.messageable_contacts() to authenticated;


-- ---- my_threads_detailed — hide DIRECT threads with a blocked person -------
--   Group threads are not filtered here — leaving a group is the way out of a
--   group chat. Direct threads survive a block, so they MUST be filtered.
create or replace function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  group_id              uuid,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  last_message_at       timestamptz,
  last_message_body     text,
  last_message_sender   uuid,
  last_read_at          timestamptz,
  unread_count          int
)
language sql
stable
set search_path = public
as $$
  with my_threads as (
    select tp.thread_id, tp.last_read_at
    from public.thread_participants tp
    where tp.profile_id = auth.uid()
  ),
  other_party as (
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id           as other_id,
           p.full_name    as other_name,
           p.handle::text as other_handle
    from public.thread_participants tp
    join public.profiles p on p.id = tp.profile_id
    where tp.thread_id in (select thread_id from my_threads)
      and tp.profile_id <> auth.uid()
    order by tp.thread_id, tp.joined_at asc
  ),
  last_msg as (
    select distinct on (m.thread_id)
           m.thread_id, m.body, m.sender_id, m.created_at
    from public.messages m
    where m.thread_id in (select thread_id from my_threads)
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::int as cnt
    from public.messages m
    join my_threads mt on mt.thread_id = m.thread_id
    where m.sender_id <> auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
    group by m.thread_id
  )
  select t.id              as thread_id,
         t.kind,
         t.group_id,
         case when t.kind = 'group' then null else op.other_id end      as other_profile_id,
         case when t.kind = 'group' then g.name else op.other_name end   as other_full_name,
         case when t.kind = 'group' then null else op.other_handle end   as other_handle,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread       u   on u.thread_id  = t.id
  left join public.groups g  on g.id = t.group_id
  where t.kind = 'group'
     or op.other_id is null
     or not exists (
       select 1 from public.connections b
       where b.kind = 'block'
         and (
           (b.from_profile = auth.uid() and b.to_profile = op.other_id)
           or (b.from_profile = op.other_id and b.to_profile = auth.uid())
         )
     )
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;


-- =============================================================================
-- 3. REPORTS TABLE
--   One row per report. target_kind tells a reviewer what target_id points at.
--   target_id is intentionally NOT a foreign key — it is polymorphic and we
--   want the report to survive even if the offending content is deleted.
-- =============================================================================
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('profile','message','group','group_post')),
  target_id   uuid not null,
  reason      text not null check (reason in ('spam','harassment','inappropriate','safety','fake','other')),
  details     text,
  status      text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_reports_status  on public.reports (status, created_at desc);
create index if not exists idx_reports_target  on public.reports (target_kind, target_id);

alter table public.reports enable row level security;

-- A user can see the reports they filed; nobody else can read them.
-- Review happens via the Supabase dashboard / service role, which bypasses RLS.
drop policy if exists "reports: read own" on public.reports;
create policy "reports: read own"
  on public.reports for select
  using (reporter_id = auth.uid());

-- Inserts go through report_content() (SECURITY DEFINER), but allow a direct
-- self-insert too so the table is usable without the RPC.
drop policy if exists "reports: insert own" on public.reports;
create policy "reports: insert own"
  on public.reports for insert
  with check (reporter_id = auth.uid());


-- =============================================================================
-- 4. report_content — validated insert into reports.
-- =============================================================================
create or replace function public.report_content(
  p_target_kind text,
  p_target_id   uuid,
  p_reason      text,
  p_details     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_target_kind not in ('profile','message','group','group_post') then
    raise exception 'invalid target kind';
  end if;
  if p_target_id is null then raise exception 'no target'; end if;
  if p_reason not in ('spam','harassment','inappropriate','safety','fake','other') then
    raise exception 'invalid reason';
  end if;
  if p_target_kind = 'profile' and p_target_id = v_me then
    raise exception 'cannot report yourself';
  end if;

  insert into public.reports (reporter_id, target_kind, target_id, reason, details)
    values (v_me, p_target_kind, p_target_id, p_reason,
            nullif(btrim(coalesce(p_details, '')), ''))
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.report_content(text, uuid, text, text) to authenticated;


-- =============================================================================
-- 5. delete_account — Apple Guideline 5.1.1(v): in-app account deletion.
--   Removes everything the user owns, then deletes the auth.users row, which
--   cascades profiles -> profile_activities/goals/values, group_members,
--   messages, thread_participants, connections, group_posts, reports.
--
--   Hand-cleaned first (no FK cascade reaches them):
--     * photos rows for the user's profile (polymorphic table, no FK)
--     * groups the user OWNS — deleted outright (a group can't survive losing
--       its owner). Their photos rows are polymorphic too, so removed first.
--
--   Storage objects (avatars / profile-photos / group photo buckets) are NOT
--   touched here — the client purges its own storage before calling this,
--   mirroring delete_group(). Any miss is an orphaned file, not leaked data.
-- =============================================================================
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- Profile photo rows (polymorphic table, no FK to profiles).
  delete from public.photos
   where owner_kind = 'profile' and owner_id = v_me;

  -- Groups this user owns: purge their photo rows, then delete the groups.
  -- Deleting a group cascades its members, threads, messages, posts, activities.
  delete from public.photos
   where owner_kind = 'group'
     and owner_id in (
       select gm.group_id from public.group_members gm
       where gm.profile_id = v_me and gm.role = 'owner'
     );

  delete from public.groups
   where id in (
     select gm.group_id from public.group_members gm
     where gm.profile_id = v_me and gm.role = 'owner'
   );

  -- Remove the auth user. FK cascades from auth.users -> profiles take the rest.
  delete from auth.users where id = v_me;
end;
$$;

grant execute on function public.delete_account() to authenticated;


-- Force PostgREST to pick up the new functions immediately.
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0037_group_privacy.sql
-- =============================================================================
-- =============================================================================
-- 0037_group_privacy.sql
-- Public / private groups + a join-request approval flow.
--
--   Public group  → tapping Join joins instantly (existing behaviour).
--   Private group → tapping Join files a request; an owner/admin approves it.
--
-- Design:
--   * Pending requests live in their own table (group_join_requests), NOT in
--     group_members. This keeps group_members = "real members only", so
--     is_group_member(), the member_count trigger, and every membership RLS
--     check stay correct with zero changes.
--   * my_groups_feed becomes SECURITY DEFINER so private groups are still
--     browseable (you can see them and request to join). Their posts/chat
--     stay protected — those RPCs gate on actual membership.
--
-- Single-pass. Safe to run once on top of 0001..0036.
--
-- Sections:
--   1. group_join_requests table + RLS
--   2. join_group        (drop+recreate: returns 'joined' | 'pending')
--   3. cancel_join_request / approve_join_request / decline_join_request
--   4. list_join_requests
--   5. set_group_privacy
--   6. group_detail      (drop+recreate: + is_public, has_pending_request)
--   7. my_groups_feed    (drop+recreate: SECURITY DEFINER, + is_public,
--                         has_pending_request, shows private groups too)
-- =============================================================================


-- =============================================================================
-- 1. group_join_requests — one pending request per (group, profile).
-- =============================================================================
create table if not exists public.group_join_requests (
  group_id   uuid not null references public.groups(id)   on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index if not exists idx_gjr_group on public.group_join_requests (group_id);

alter table public.group_join_requests enable row level security;

-- Read: the requester sees their own; owners/admins see their group's queue.
drop policy if exists "gjr: read" on public.group_join_requests;
create policy "gjr: read"
  on public.group_join_requests for select
  using (profile_id = auth.uid() or public.is_group_admin(group_id));

-- Insert: you can only file a request as yourself.
drop policy if exists "gjr: insert own" on public.group_join_requests;
create policy "gjr: insert own"
  on public.group_join_requests for insert
  with check (profile_id = auth.uid());

-- Delete: the requester can withdraw; an owner/admin can clear it.
drop policy if exists "gjr: delete" on public.group_join_requests;
create policy "gjr: delete"
  on public.group_join_requests for delete
  using (profile_id = auth.uid() or public.is_group_admin(group_id));


-- =============================================================================
-- 2. join_group — public joins instantly, private files a request.
--   Return type changes (void → text) → DROP first.
--   Returns 'joined' or 'pending' so the client can update its UI correctly.
-- =============================================================================
drop function if exists public.join_group(uuid);

create function public.join_group(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_is_public boolean;
  v_thread    uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- Already in → nothing to do.
  if exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_me
  ) then
    return 'joined';
  end if;

  select is_public into v_is_public from public.groups where id = p_group;
  if v_is_public is null then raise exception 'group not found'; end if;

  if v_is_public then
    insert into public.group_members (group_id, profile_id, role)
      values (p_group, v_me, 'member')
      on conflict do nothing;

    -- Clear any stale request.
    delete from public.group_join_requests
      where group_id = p_group and profile_id = v_me;

    -- If the group chat already exists, add the new member to it.
    select id into v_thread
      from public.threads
     where kind = 'group' and group_id = p_group
     limit 1;
    if v_thread is not null then
      insert into public.thread_participants (thread_id, profile_id)
        values (v_thread, v_me)
        on conflict do nothing;
    end if;

    return 'joined';
  else
    insert into public.group_join_requests (group_id, profile_id)
      values (p_group, v_me)
      on conflict do nothing;
    return 'pending';
  end if;
end;
$$;

grant execute on function public.join_group(uuid) to authenticated;


-- =============================================================================
-- 3. cancel / approve / decline a join request
-- =============================================================================

-- The requester withdraws their own pending request.
create or replace function public.cancel_join_request(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.group_join_requests
   where group_id = p_group and profile_id = v_me;
end;
$$;

grant execute on function public.cancel_join_request(uuid) to authenticated;


-- Owner/admin approves a request → real membership + thread sync.
create or replace function public.approve_join_request(p_group uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can approve requests';
  end if;

  if not exists (
    select 1 from public.group_join_requests
    where group_id = p_group and profile_id = p_profile
  ) then
    return;   -- no pending request → no-op
  end if;

  insert into public.group_members (group_id, profile_id, role)
    values (p_group, p_profile, 'member')
    on conflict do nothing;

  delete from public.group_join_requests
   where group_id = p_group and profile_id = p_profile;

  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;
  if v_thread is not null then
    insert into public.thread_participants (thread_id, profile_id)
      values (v_thread, p_profile)
      on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.approve_join_request(uuid, uuid) to authenticated;


-- Owner/admin declines (deletes) a request.
create or replace function public.decline_join_request(p_group uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can decline requests';
  end if;
  delete from public.group_join_requests
   where group_id = p_group and profile_id = p_profile;
end;
$$;

grant execute on function public.decline_join_request(uuid, uuid) to authenticated;


-- =============================================================================
-- 4. list_join_requests — the pending queue for one group (owner/admin only).
-- =============================================================================
create or replace function public.list_join_requests(p_group uuid)
returns table (
  profile_id   uuid,
  full_name    text,
  handle       text,
  avatar_url   text,
  requested_at timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id            as profile_id,
    p.full_name,
    p.handle::text  as handle,
    p.avatar_url,
    r.created_at    as requested_at
  from public.group_join_requests r
  join public.profiles p on p.id = r.profile_id
  where r.group_id = p_group
    and public.is_group_admin(p_group)
  order by r.created_at asc;
$$;

grant execute on function public.list_join_requests(uuid) to authenticated;


-- =============================================================================
-- 5. set_group_privacy — owner/admin flips the public/private toggle.
-- =============================================================================
create or replace function public.set_group_privacy(p_group uuid, p_is_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can change group privacy';
  end if;
  if p_is_public is null then raise exception 'privacy value required'; end if;

  update public.groups set is_public = p_is_public where id = p_group;
end;
$$;

grant execute on function public.set_group_privacy(uuid, boolean) to authenticated;


-- =============================================================================
-- 6. group_detail — adds is_public + has_pending_request.
--   Return type changes → DROP first. Rebuilt from the 0023 definition
--   (members-only address) so nothing already shipped is lost.
-- =============================================================================
drop function if exists public.group_detail(uuid);

create function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    -- Address is members-only — many groups meet at homes.
    case
      when exists (select 1 from public.group_members gm
                   where gm.group_id = g.id and gm.profile_id = auth.uid())
        then g.address
      else null
    end as address,
    g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role,
    exists (select 1 from public.group_join_requests r
            where r.group_id = g.id and r.profile_id = auth.uid()) as has_pending_request
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- =============================================================================
-- 7. my_groups_feed — adds is_public + has_pending_request.
--   Now SECURITY DEFINER so private groups are still browseable (you can see
--   one and request to join). Posts/chat stay protected — those RPCs gate on
--   real membership. Return type changes → DROP first.
-- =============================================================================
drop function if exists public.my_groups_feed();

create function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.is_public,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member,
    exists (
      select 1 from public.group_join_requests r
      where r.group_id = g.id and r.profile_id = (select id from me)
    ) as has_pending_request
  from public.groups g
  order by
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    g.member_count desc,
    g.created_at  desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- Force PostgREST to pick up the new functions immediately.
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0038_admin_moderation.sql
-- =============================================================================
-- =============================================================================
-- 0038_admin_moderation.sql
-- Moderation backend for the admin web panel (admin.html).
--
-- WHY THIS EXISTS:
--   0036 created the `reports` table but its RLS only lets a user read their
--   OWN reports — there is no way to REVIEW reports. The Terms legally promise
--   reported content is actioned within 24h, so a reviewer surface is required.
--
-- DESIGN — no service-role key in the browser:
--   The admin panel logs in as a normal Supabase user. Every admin action goes
--   through a SECURITY DEFINER RPC that first checks `profiles.is_admin` for the
--   caller. A non-admin (or anon) calling any admin_* RPC gets "not authorized".
--   This means the panel only ever needs the public anon key — the same key the
--   app and website already ship. The service-role key never leaves Supabase.
--
-- Single-pass. Safe to run once on top of 0001..0037. Idempotent where possible.
--
-- Sections:
--   1.  Schema: is_admin + suspension columns on profiles
--   1b. Defensive guard: reports table (in case 0036 was never applied)
--   2.  _require_admin() guard helper
--   3.  admin_stats()            — dashboard counters
--   4.  admin_list_reports()     — the reviewer queue, with target previews
--   5.  admin_resolve_report()   — change a report's status
--   6.  admin_delete_message / admin_delete_group_post / admin_delete_group
--   7.  admin_suspend_user / admin_unsuspend_user
--   8.  admin_delete_user()      — nuclear: full account cascade for any profile
--   9.  admin_list_users / admin_list_groups — moderation + test-data cleanup
--   10. Make yourself an admin (commented — run once with your email)
-- =============================================================================


-- =============================================================================
-- 1. SCHEMA — admin flag + suspension state on profiles
--   suspended is enforced app-side (AuthContext): a suspended profile is bounced
--   to a "Account Suspended" screen on next load. Reversible via unsuspend.
-- =============================================================================
alter table public.profiles
  add column if not exists is_admin         boolean     not null default false,
  add column if not exists suspended        boolean     not null default false,
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_reason text;


-- =============================================================================
-- 1b. DEFENSIVE GUARD — reports table.
--   0036 created this. If 0036 was applied this whole block is a no-op. If it
--   was not, 0038 still stands on its own. (Migration drift is a known issue on
--   this DB — see the gotchas note about ad-hoc SQL-editor patching.)
-- =============================================================================
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('profile','message','group','group_post')),
  target_id   uuid not null,
  reason      text not null check (reason in ('spam','harassment','inappropriate','safety','fake','other')),
  details     text,
  status      text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_reports_status on public.reports (status, created_at desc);
create index if not exists idx_reports_target on public.reports (target_kind, target_id);
alter table public.reports enable row level security;


-- =============================================================================
-- 2. ADMIN GUARD
--   Raises 42501 (insufficient privilege) unless the caller is an admin.
--   Every admin_* RPC calls this as its first statement. SECURITY DEFINER so it
--   can read profiles.is_admin regardless of the caller's RLS.
-- =============================================================================
create or replace function public._require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not coalesce(
       (select p.is_admin from public.profiles p where p.id = auth.uid()),
       false
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._require_admin() from public;
grant execute on function public._require_admin() to authenticated;


-- =============================================================================
-- 3. admin_stats — counters for the panel header.
-- =============================================================================
create or replace function public.admin_stats()
returns table (
  open_reports     int,
  total_reports    int,
  total_users      int,
  suspended_users  int,
  total_groups     int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    (select count(*)::int from public.reports  where status = 'open'),
    (select count(*)::int from public.reports),
    (select count(*)::int from public.profiles),
    (select count(*)::int from public.profiles where suspended),
    (select count(*)::int from public.groups);
end;
$$;

revoke all on function public.admin_stats() from public;
grant execute on function public.admin_stats() to authenticated;


-- =============================================================================
-- 4. admin_list_reports — THE reviewer queue.
--   For every report it resolves the target into a human-readable preview so a
--   reviewer never has to go digging. target_id is polymorphic (no FK), so each
--   kind is LEFT JOINed separately and gated by target_kind.
--
--   target_owner_id is the profile RESPONSIBLE for the reported content
--   (the message sender / post author / group creator / the profile itself) —
--   so the panel can offer a one-click "suspend the offender" action.
--
--   target_exists tells the reviewer if the content is already gone (deleted by
--   the user, or by an earlier moderation action) — a report can outlive it.
-- =============================================================================
create or replace function public.admin_list_reports(p_status text default null)
returns table (
  report_id          uuid,
  created_at         timestamptz,
  status             text,
  reason             text,
  details            text,
  reporter_id        uuid,
  reporter_name      text,
  reporter_handle    text,
  target_kind        text,
  target_id          uuid,
  target_exists      boolean,
  target_label       text,
  target_preview     text,
  target_owner_id    uuid,
  target_owner_name  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  if p_status is not null
     and p_status not in ('open','reviewed','actioned','dismissed') then
    raise exception 'invalid status filter';
  end if;

  return query
  select
    r.id,
    r.created_at,
    r.status,
    r.reason,
    r.details,
    r.reporter_id,
    rp.full_name,
    rp.handle::text,
    r.target_kind,
    r.target_id,
    -- target_exists
    case r.target_kind
      when 'profile'    then (tp.id is not null)
      when 'message'    then (m.id  is not null)
      when 'group'      then (g.id  is not null)
      when 'group_post' then (gp.id is not null)
      else false
    end,
    -- target_label
    case r.target_kind
      when 'profile'    then coalesce(tp.full_name, '(deleted profile)')
      when 'message'    then 'Direct message'
      when 'group'      then coalesce(g.name, '(deleted group)')
      when 'group_post' then coalesce('Post in "' || gpg.name || '"', 'Group post')
      else r.target_kind
    end,
    -- target_preview
    case r.target_kind
      when 'profile'    then tp.bio
      when 'message'    then m.body
      when 'group'      then g.description
      when 'group_post' then gp.body
      else null
    end,
    -- target_owner_id  (who is responsible for the content)
    case r.target_kind
      when 'profile'    then tp.id
      when 'message'    then m.sender_id
      when 'group'      then g.created_by
      when 'group_post' then gp.author_id
      else null
    end,
    -- target_owner_name
    case r.target_kind
      when 'profile'    then tp.full_name
      when 'message'    then mo.full_name
      when 'group'      then go.full_name
      when 'group_post' then gpo.full_name
      else null
    end
  from public.reports r
  left join public.profiles    rp  on rp.id  = r.reporter_id
  left join public.profiles    tp  on r.target_kind = 'profile'    and tp.id  = r.target_id
  left join public.messages    m   on r.target_kind = 'message'    and m.id   = r.target_id
  left join public.profiles    mo  on mo.id  = m.sender_id
  left join public.groups      g   on r.target_kind = 'group'      and g.id   = r.target_id
  left join public.profiles    go  on go.id  = g.created_by
  left join public.group_posts gp  on r.target_kind = 'group_post' and gp.id  = r.target_id
  left join public.profiles    gpo on gpo.id = gp.author_id
  left join public.groups      gpg on gpg.id = gp.group_id
  where p_status is null or r.status = p_status
  order by
    case r.status when 'open' then 0 else 1 end,
    r.created_at desc;
end;
$$;

revoke all on function public.admin_list_reports(text) from public;
grant execute on function public.admin_list_reports(text) to authenticated;


-- =============================================================================
-- 5. admin_resolve_report — move a report through its lifecycle.
--   open -> reviewed (looked at, no action) / actioned (content removed or user
--   suspended) / dismissed (not a real violation). Reversible to 'open'.
-- =============================================================================
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_status not in ('open','reviewed','actioned','dismissed') then
    raise exception 'invalid status';
  end if;
  update public.reports set status = p_status where id = p_report_id;
  if not found then
    raise exception 'report not found';
  end if;
end;
$$;

revoke all on function public.admin_resolve_report(uuid, text) from public;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;


-- =============================================================================
-- 6. CONTENT REMOVAL
--   Each deletes the offending content. They do NOT auto-resolve the report —
--   the panel calls admin_resolve_report('actioned') right after, so the
--   reviewer stays in control of the report lifecycle.
-- =============================================================================

-- ---- delete a direct message -------------------------------------------------
create or replace function public.admin_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.messages where id = p_message_id;
end;
$$;
revoke all on function public.admin_delete_message(uuid) from public;
grant execute on function public.admin_delete_message(uuid) to authenticated;


-- ---- delete a group post -----------------------------------------------------
--   group_posts stores its image in a `photo_url` column (not the polymorphic
--   `photos` table), so there is no photos row to clean. The storage object, if
--   any, is left orphaned — not leaked data, just an unreferenced file.
create or replace function public.admin_delete_group_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.group_posts where id = p_post_id;
end;
$$;
revoke all on function public.admin_delete_group_post(uuid) from public;
grant execute on function public.admin_delete_group_post(uuid) to authenticated;


-- ---- delete an entire group --------------------------------------------------
--   Cascades members, threads, messages, posts, activities via FKs. Polymorphic
--   `photos` rows for the group have no FK, so they are cleaned by hand first —
--   same pattern as delete_account() in 0036.
create or replace function public.admin_delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.photos
   where owner_kind = 'group' and owner_id = p_group_id;
  delete from public.groups where id = p_group_id;
end;
$$;
revoke all on function public.admin_delete_group(uuid) from public;
grant execute on function public.admin_delete_group(uuid) to authenticated;


-- =============================================================================
-- 7. USER SUSPENSION — the normal, reversible moderation action.
--   Sets the suspended flag; enforcement is app-side (AuthContext bounces a
--   suspended profile to the "Account Suspended" screen). Cannot suspend an
--   admin (prevents a compromised/rogue admin locking out another).
-- =============================================================================
create or replace function public.admin_suspend_user(
  p_profile_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_profile_id is null then raise exception 'no target'; end if;
  if coalesce((select is_admin from public.profiles where id = p_profile_id), false) then
    raise exception 'cannot suspend an admin';
  end if;
  update public.profiles
     set suspended        = true,
         suspended_at     = now(),
         suspended_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_profile_id;
  if not found then raise exception 'profile not found'; end if;
end;
$$;
revoke all on function public.admin_suspend_user(uuid, text) from public;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated;


create or replace function public.admin_unsuspend_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles
     set suspended        = false,
         suspended_at     = null,
         suspended_reason = null
   where id = p_profile_id;
  if not found then raise exception 'profile not found'; end if;
end;
$$;
revoke all on function public.admin_unsuspend_user(uuid) from public;
grant execute on function public.admin_unsuspend_user(uuid) to authenticated;


-- =============================================================================
-- 8. admin_delete_user — nuclear option. Full account cascade for ANY profile.
--   Mirrors delete_account() from 0036 but targets an arbitrary profile. Use
--   for confirmed bad actors and for purging junk/test accounts. Irreversible.
--   Refuses to delete an admin.
-- =============================================================================
create or replace function public.admin_delete_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_profile_id is null then raise exception 'no target'; end if;
  if coalesce((select is_admin from public.profiles where id = p_profile_id), false) then
    raise exception 'cannot delete an admin account';
  end if;

  -- Profile photo rows (polymorphic table, no FK to profiles).
  delete from public.photos
   where owner_kind = 'profile' and owner_id = p_profile_id;

  -- Groups this user owns: purge polymorphic photo rows, then the groups.
  delete from public.photos
   where owner_kind = 'group'
     and owner_id in (
       select gm.group_id from public.group_members gm
       where gm.profile_id = p_profile_id and gm.role = 'owner'
     );
  delete from public.groups
   where id in (
     select gm.group_id from public.group_members gm
     where gm.profile_id = p_profile_id and gm.role = 'owner'
   );

  -- Remove the auth user. FK cascades auth.users -> profiles -> everything else.
  delete from auth.users where id = p_profile_id;
end;
$$;
revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- =============================================================================
-- 9. LISTING RPCs — power the Users and Groups tabs of the panel.
--   Also the fastest way to eyeball junk/test data for cleanup.
-- =============================================================================
create or replace function public.admin_list_users()
returns table (
  profile_id          uuid,
  full_name           text,
  handle              text,
  email               text,
  city                text,
  state               text,
  onboarding_complete boolean,
  suspended           boolean,
  is_admin            boolean,
  report_count        int,
  created_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    p.id,
    p.full_name,
    p.handle::text,
    u.email::text,
    p.city,
    p.state,
    p.onboarding_complete,
    p.suspended,
    p.is_admin,
    (select count(*)::int from public.reports r
       where r.target_kind = 'profile' and r.target_id = p.id),
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;


create or replace function public.admin_list_groups()
returns table (
  group_id     uuid,
  name         text,
  description  text,
  city         text,
  state        text,
  created_by   uuid,
  owner_name   text,
  member_count int,
  is_public    boolean,
  report_count int,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    g.id,
    g.name,
    g.description,
    g.city,
    g.state,
    g.created_by,
    o.full_name,
    g.member_count,
    g.is_public,
    (select count(*)::int from public.reports r
       where r.target_kind = 'group' and r.target_id = g.id),
    g.created_at
  from public.groups g
  left join public.profiles o on o.id = g.created_by
  order by g.created_at desc;
end;
$$;
revoke all on function public.admin_list_groups() from public;
grant execute on function public.admin_list_groups() to authenticated;


-- Force PostgREST to pick up the new functions + column immediately.
notify pgrst, 'reload schema';


-- =============================================================================
-- 10. MAKE YOURSELF AN ADMIN  —  RUN THIS ONCE, SEPARATELY.
--   Uncomment, set your FOUND login email, run it. Until you do, every admin_*
--   RPC returns "not authorized" — including for you.
-- =============================================================================
-- update public.profiles set is_admin = true
--  where id = (select id from auth.users where lower(email) = lower('you@example.com'));

-- =============================================================================
-- DONE.
-- =============================================================================


-- =============================================================================
-- Migration: 0039_fix_group_member_count.sql
-- =============================================================================
-- =============================================================================
-- 0039_fix_group_member_count.sql
-- Fixes inconsistent group member counts across the app.
--
-- Root cause:
--   groups.member_count is a denormalized counter maintained by the
--   bump_group_member_count() trigger. That trigger was broken before 0018
--   (no SECURITY DEFINER → member joins blocked by RLS, count never moved),
--   and migrations were applied ad-hoc out of order. Result: the cached
--   member_count column drifted away from the true row count.
--
--   my_groups_feed() and group_detail() both displayed the stale cached
--   column, while GroupDetailScreen's roster section shows the live
--   group_members_list() count — so the same group reads differently
--   depending on which screen / which number you look at.
--
-- Fix:
--   1. Backfill groups.member_count to the true count (one-time repair).
--   2. Rewrite my_groups_feed() and group_detail() to compute the count
--      LIVE from group_members instead of trusting the cached column.
--      group_members PK is (group_id, profile_id) → count() is index-fast.
--
-- The cached column + trigger are left in place (harmless, low blast radius)
-- but are no longer the source of truth for anything displayed.
--
-- Single-pass. Safe to run once on top of 0001..0038.
-- =============================================================================


-- =============================================================================
-- 1. One-time backfill — resync the cached column to reality.
-- =============================================================================
update public.groups g
set member_count = (
  select count(*) from public.group_members gm where gm.group_id = g.id
)
where g.member_count is distinct from (
  select count(*) from public.group_members gm where gm.group_id = g.id
);


-- =============================================================================
-- 2. group_detail — count computed live. Signature unchanged; drop+recreate
--    defensively in case the deployed signature drifted.
-- =============================================================================
drop function if exists public.group_detail(uuid);

create function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    -- Address is members-only — many groups meet at homes.
    case
      when exists (select 1 from public.group_members gm
                   where gm.group_id = g.id and gm.profile_id = auth.uid())
        then g.address
      else null
    end as address,
    g.schedule_text,
    -- LIVE count — not the cached groups.member_count column.
    (select count(*)::int from public.group_members gm
      where gm.group_id = g.id) as member_count,
    g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role,
    exists (select 1 from public.group_join_requests r
            where r.group_id = g.id and r.profile_id = auth.uid()) as has_pending_request
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- =============================================================================
-- 3. my_groups_feed — count computed live, in both the SELECT and the
--    ORDER BY (so "most members" sort stays correct even as the cached
--    column drifts). Signature unchanged; drop+recreate defensively.
-- =============================================================================
drop function if exists public.my_groups_feed();

create function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text,
    -- LIVE count — not the cached groups.member_count column.
    (select count(*)::int from public.group_members gm
      where gm.group_id = g.id) as member_count,
    g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.is_public,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member,
    exists (
      select 1 from public.group_join_requests r
      where r.group_id = g.id and r.profile_id = (select id from me)
    ) as has_pending_request
  from public.groups g
  order by
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    (select count(*) from public.group_members gm where gm.group_id = g.id) desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- Force PostgREST to pick up the rebuilt functions immediately.
notify pgrst, 'reload schema';


-- =============================================================================
-- Migration: 0040_csam_incidents.sql
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────
-- 0040_csam_incidents.sql
--
-- Schema support for the Thorn Safer photo-scanning Edge Function.
--
--   * adds scan-state columns to public.photos
--   * creates a private quarantine storage bucket
--   * creates the csam_incidents table (admin-only RLS)
--
-- Idempotent — safe to re-run.
-- Runs after migration 0039.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Scan-state on photos -----------------------------------------------------

alter table public.photos
  add column if not exists scanned boolean not null default false,
  add column if not exists scanned_at timestamptz;

create index if not exists photos_unscanned_idx
  on public.photos (created_at)
  where scanned = false;

-- 2. Quarantine bucket --------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('quarantine', 'quarantine', false)
  on conflict (id) do nothing;

-- Deny-all RLS on quarantine bucket — only service role can touch it.
drop policy if exists "quarantine deny all" on storage.objects;
create policy "quarantine deny all"
  on storage.objects
  as restrictive
  for all
  to authenticated, anon
  using ( bucket_id <> 'quarantine' )
  with check ( bucket_id <> 'quarantine' );

-- 3. Incident table -----------------------------------------------------------

create table if not exists public.csam_incidents (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  bucket_id             text not null,
  storage_path          text not null,
  profile_id            uuid references public.profiles(id) on delete set null,
  thorn_match_id        text,
  reported_to_ncmec     boolean not null default false,
  cybertip_id           text,
  notes                 text
);

alter table public.csam_incidents enable row level security;

drop policy if exists "csam_incidents admin read"  on public.csam_incidents;
drop policy if exists "csam_incidents admin write" on public.csam_incidents;

-- Boolean admin predicate inline — RLS USING/WITH CHECK requires boolean,
-- whereas public._require_admin() returns void (raises on failure).
create policy "csam_incidents admin read"
  on public.csam_incidents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

create policy "csam_incidents admin write"
  on public.csam_incidents
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

create index if not exists csam_incidents_profile_idx
  on public.csam_incidents (profile_id);
create index if not exists csam_incidents_open_idx
  on public.csam_incidents (created_at)
  where reported_to_ncmec = false;

comment on table public.csam_incidents is
  'Auto-quarantined CSAM matches from Thorn Safer. Preserved per 18 U.S.C. § 2258A.';


-- =============================================================================
-- Migration: 0041_hometown.sql
-- =============================================================================
-- =============================================================================
-- 0041_hometown.sql
--
-- Adds `hometown` — "Where are you from?" — to profiles.
--
-- Separate from city/state (which is *where you live now*). Hometown is a
-- soft identity field that helps fill out a bio and unlocks a future
-- "match people from the same place" signal.
--
-- Changes:
--   1. profiles.hometown text (nullable)
--   2. update_profile() RPC gains p_hometown param
--   3. get_profile_detail() returns hometown so the public profile can show it
-- =============================================================================

-- 1) Column ------------------------------------------------------------------
alter table public.profiles
  add column if not exists hometown text;

-- 2) update_profile RPC ------------------------------------------------------
-- Need to drop the old signature since we're adding a positional param.
drop function if exists public.update_profile(
  text, text, text, text, text, uuid, text, text, boolean, boolean,
  text[], text[], text[]
);

create or replace function public.update_profile(
  p_full_name     text default null,
  p_bio           text default null,
  p_city          text default null,
  p_state         text default null,
  p_life_stage    text default null,
  p_church_id     uuid default null,
  p_love_language text default null,
  p_school_type   text default null,
  p_is_initiator  boolean default null,
  p_is_outgoing   boolean default null,
  p_hometown      text default null,
  p_activities    text[] default null,
  p_goals         text[] default null,
  p_values        text[] default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    full_name        = coalesce(p_full_name, full_name),
    bio              = coalesce(p_bio,       bio),
    city             = coalesce(p_city,      city),
    state            = coalesce(p_state,     state),
    hometown         = coalesce(p_hometown,  hometown),
    life_stage_id    = coalesce(p_life_stage,    life_stage_id),
    church_id        = coalesce(p_church_id,     church_id),
    love_language_id = coalesce(p_love_language, love_language_id),
    school_type_id   = coalesce(p_school_type,   school_type_id),
    is_initiator     = coalesce(p_is_initiator,  is_initiator),
    is_outgoing      = coalesce(p_is_outgoing,   is_outgoing),
    last_active_at   = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, x from unnest(p_activities) as x
      on conflict do nothing;
    end if;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, x from unnest(p_goals) as x
      on conflict do nothing;
    end if;
  end if;

  if p_values is not null then
    delete from public.profile_values where profile_id = v_uid;
    if array_length(p_values, 1) is not null then
      insert into public.profile_values (profile_id, value_id)
      select v_uid, x from unnest(p_values) as x
      on conflict do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.update_profile(
  text, text, text, text, text, uuid, text, text, boolean, boolean, text,
  text[], text[], text[]
) to authenticated;

-- 3) get_profile_detail RPC --------------------------------------------------
-- Adds `hometown` to the return shape. Original logic preserved verbatim.
drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  hometown          text,
  avatar_url        text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  score             int,
  activities        jsonb,
  connection_count  int,
  group_count       int,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    p.id                  as profile_id,
    p.full_name,
    p.handle::text        as handle,
    p.bio,
    p.hometown,
    p.avatar_url,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.life_stage_id,
    ls.label              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end                             as church_name,
    public.match_score((select id from me), p.id)               as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    (
      select count(*)::int
      from public.connections c1
      join public.connections c2
        on c2.from_profile = c1.to_profile
       and c2.to_profile   = c1.from_profile
       and c2.kind         = 'like'
      where c1.from_profile = p.id
        and c1.kind         = 'like'
    )                                                           as connection_count,
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile   = p.id and m.kind = 'like'
      ) and exists (
        select 1 from public.connections t
        where t.from_profile = p.id
          and t.to_profile   = (select id from me) and t.kind = 'like'
      )
    )                                                           as is_match
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- =============================================================================
-- Migration: 0042_hometown_match.sql
-- =============================================================================
-- =============================================================================
-- 0042_hometown_match.sql
--
-- Wires hometown into the match score.
--
-- Adds a +10 bonus when viewer.hometown and candidate.hometown match
-- (case-insensitive, whitespace-trimmed, both non-null).
--
-- Pre-change weights:  30 acts + 30 goals + 25 life_stage + 15 proximity = 100
-- New weights:         + 10 hometown = 110, clamped to 100.
--
-- Intentional that the total exceeds 100 — hometown is a tiebreaker that
-- lifts otherwise-mediocre matches and lets strong matches still cap at 100.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
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

  select life_stage_id, hometown, match_radius_mi, location
    into v_lifestage, v_hometown, v_radius_mi, v_loc
    from public.profiles where id = viewer;
  select life_stage_id, hometown, location
    into c_lifestage, c_hometown, c_loc
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

  -- Hometown match (+10) — case-insensitive, trimmed, both non-blank
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  return greatest(0, least(100, score));
end $$;


-- =============================================================================
-- Migration: 0043_same_hometown_flag.sql
-- =============================================================================
-- =============================================================================
-- 0043_same_hometown_flag.sql
--
-- Adds `same_hometown` to top_matches_detailed so the Discover feed can render
-- a "Same hometown" chip on each PersonCard.
--
-- Comparison rule matches match_score() exactly:
--   case-insensitive, whitespace-trimmed, both non-blank.
--
-- Whole RPC is dropped + recreated (same pattern as 0029). Logic preserved
-- verbatim aside from the joined `me_p` CTE that pulls viewer hometown and
-- the new `same_hometown` output column. `get_profile_detail` also gains the
-- flag so MatchDetailScreen can show the chip later if we want.
-- =============================================================================

drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  in_radius         boolean,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  same_hometown     boolean,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       me_p as (
         select id, hometown from public.profiles where id = (select id from me)
       ),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                       as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                              as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                       as same_hometown,
    p.created_at
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.in_radius desc, b.score desc, b.distance_mi asc nulls last;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;


-- get_profile_detail also gets same_hometown so MatchDetail can use it.
drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  hometown          text,
  avatar_url        text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  score             int,
  activities        jsonb,
  connection_count  int,
  group_count       int,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean,
  same_hometown     boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       me_p as (select id, hometown from public.profiles where id = (select id from me))
  select
    p.id                  as profile_id,
    p.full_name,
    p.handle::text        as handle,
    p.bio,
    p.hometown,
    p.avatar_url,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.life_stage_id,
    ls.label              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end                             as church_name,
    public.match_score((select id from me), p.id)               as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    (
      select count(*)::int
      from public.connections c1
      join public.connections c2
        on c2.from_profile = c1.to_profile
       and c2.to_profile   = c1.from_profile
       and c2.kind         = 'like'
      where c1.from_profile = p.id
        and c1.kind         = 'like'
    )                                                           as connection_count,
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile   = p.id and m.kind = 'like'
      ) and exists (
        select 1 from public.connections t
        where t.from_profile = p.id
          and t.to_profile   = (select id from me) and t.kind = 'like'
      )
    )                                                           as is_match,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                                           as same_hometown
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- =============================================================================
-- Migration: 0044_discover_show_everyone.sql
-- =============================================================================
-- =============================================================================
-- 0044_discover_show_everyone.sql
--
-- Discover rules (final):
--   * "Anywhere" (no location override, viewer's saved radius = 0 OR viewer
--     has no location): show EVERY real account, including those with no
--     geocoded location. Sort closest first; unmapped users fall to the bottom.
--   * Location override active (Near Me / Search a city) OR saved radius
--     active: HARD filter by radius; profiles with no location are excluded
--     (can't place them on a map). Sort closest first within the radius.
--
-- Visibility gate changed from `onboarding_complete = true` to
-- `coalesce(full_name,'') <> ''`. A real account = a person with a name.
-- Website-signup users who haven't finished the 9-step app onboarding now
-- appear in Discover immediately (with low match scores until they finish).
--
-- Sort changed from (in_radius desc, score desc, distance asc) to
-- (distance asc nulls last, score desc) — closest first, unmapped last.
--
-- Run AFTER 0043. Idempotent (drop + recreate both functions).
-- =============================================================================

drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);

create or replace function public.top_matches(
  p_limit       int               default 20,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me) is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    ((select pt from filter_pt) is not null) as in_radius
  from public.profiles p, me
  where p.id <> me.id
    -- A real account = somebody with a name. No longer requires full onboarding.
    and coalesce(p.full_name, '') <> ''
    -- Privacy opt-out still hides the profile (default true).
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    and (
      case
        -- (A) Override active (Near Me / Search city): HARD radius; unmapped excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (B) No override + saved Anywhere (radius = 0): show everyone.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        -- (C) No override + viewer has no location: nothing to measure from, show everyone.
        when me.location is null then true
        -- (D) No override + saved radius > 0: HARD filter; unmapped excluded.
        else
          p.location is not null
          and ST_DWithin(
                me.location,
                p.location,
                me.discovery_radius_miles::float * 1609.34
              )
      end
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  -- Closest first. Unmapped users (distance null) drop to the bottom.
  order by distance_mi asc nulls last, score desc, p.created_at desc
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int) to authenticated;


-- =============================================================================
-- top_matches_detailed: re-create from the 0043 body with the new ORDER BY.
-- Only the final sort differs vs 0043 (closest first instead of in_radius first).
-- =============================================================================
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);

create or replace function public.top_matches_detailed(
  p_limit       int               default 25,
  p_lat         double precision  default null,
  p_lng         double precision  default null,
  p_radius_mi   int               default null
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  in_radius         boolean,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  same_hometown     boolean,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       me_p as (
         select id, hometown from public.profiles where id = (select id from me)
       ),
       base as (
         select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi)
       )
  select
    b.profile_id,
    b.score,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                       as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                              as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                       as same_hometown,
    p.created_at
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  -- Closest first; unmapped users at the bottom. Matches top_matches sort.
  order by b.distance_mi asc nulls last, b.score desc;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select profile_id, full_name, distance_mi, in_radius, score
--     from top_matches_detailed(100, null, null, null);
-- Should now return every real account except the caller, closest first, with
-- unmapped users showing distance_mi = null at the bottom.
-- =============================================================================


-- =============================================================================
-- Migration: 0045_interests_overhaul.sql
-- =============================================================================
-- =============================================================================
-- 0045_interests_overhaul.sql
--
-- 1) Big tasteful expansion of the `activities` taxonomy (≈45 items total)
--    with NEUTRAL icon colors — matches Sam's "less green/yellow tint, more
--    black-and-white" branding direction. Existing rows are normalized to the
--    same neutral palette via UPSERT.
--
-- 2) `interest_requests` table — users can submit a new interest from inside
--    the app. Ryder reviews the queue in Supabase and approves rows into
--    `activities` manually.
--
-- 3) `request_interest(p_name, p_description)` RPC for the client to call.
--
-- 4) Updates `handle_new_user()` to copy `hometown` from signup metadata onto
--    the profile row (signup form gains an optional Hometown field).
--
-- Idempotent. Safe to re-run.
-- Run AFTER 0043_same_hometown_flag.sql and 0044_discover_show_everyone.sql.
-- =============================================================================

-- ─── 1) Expand activities ────────────────────────────────────────────────────
-- Neutral icon palette (`#1A1A1A` text-black). One pass via UPSERT so existing
-- rows (surfing, golf, etc.) get re-skinned to the new palette too.

insert into public.activities (id, label, icon, icon_color, sort_order) values
  -- Outdoors / sports
  ('surfing',           'Surfing',                'water-outline',          '#1A1A1A', 10),
  ('beach',             'Beach / Lake / River',   'sunny-outline',          '#1A1A1A', 12),
  ('hiking',            'Hiking',                 'leaf-outline',           '#1A1A1A', 14),
  ('camping',           'Camping',                'bonfire-outline',        '#1A1A1A', 16),
  ('hunting',           'Hunting / Fishing',      'fish-outline',           '#1A1A1A', 18),
  ('running',           'Running',                'walk-outline',           '#1A1A1A', 20),
  ('cycling',           'Cycling',                'bicycle-outline',        '#1A1A1A', 22),
  ('fitness',           'Working Out',            'barbell-outline',        '#1A1A1A', 24),
  ('crossfit',          'CrossFit',               'flame-outline',          '#1A1A1A', 26),
  ('yoga',              'Yoga / Pilates',         'body-outline',           '#1A1A1A', 28),
  ('sports',            'Team Sports',            'football-outline',       '#1A1A1A', 30),
  ('golf',              'Golf',                   'golf-outline',           '#1A1A1A', 32),
  ('tennis-pickleball', 'Tennis / Pickleball',    'tennisball-outline',     '#1A1A1A', 34),
  ('skating',           'Skating',                'body-outline',           '#1A1A1A', 36),
  ('boating',           'Boating',                'boat-outline',           '#1A1A1A', 38),
  ('horseback',         'Horseback Riding',       'paw-outline',            '#1A1A1A', 40),

  -- Faith / community
  ('bible-study',       'Bible Study',            'book-outline',           '#1A1A1A', 50),
  ('worship-music',     'Worship Music',          'musical-notes-outline',  '#1A1A1A', 52),
  ('prayer',            'Prayer Group',           'heart-outline',          '#1A1A1A', 54),
  ('serving',           'Serving / Missions',     'hand-left-outline',      '#1A1A1A', 56),
  ('mens-ministry',     'Men''s Ministry',        'people-outline',         '#1A1A1A', 58),
  ('womens-ministry',   'Women''s Ministry',      'people-outline',         '#1A1A1A', 60),
  ('youth-ministry',    'Youth Ministry',         'happy-outline',          '#1A1A1A', 62),

  -- Family / home
  ('playgrounds',       'Playgrounds / MDO',      'happy-outline',          '#1A1A1A', 70),
  ('parenting',         'Parenting',              'people-circle-outline',  '#1A1A1A', 72),
  ('homeschool',        'Homeschool Community',   'school-outline',         '#1A1A1A', 74),
  ('cooking',           'Cooking / Baking',       'restaurant-outline',     '#1A1A1A', 76),
  ('gardening',         'Gardening',              'leaf-outline',           '#1A1A1A', 78),
  ('hosting',           'Hosting at Home',        'home-outline',           '#1A1A1A', 80),

  -- Arts / hobbies
  ('music',             'Playing Music',          'musical-note-outline',   '#1A1A1A', 90),
  ('singing',           'Singing',                'mic-outline',            '#1A1A1A', 92),
  ('art',               'Art / Painting',         'color-palette-outline',  '#1A1A1A', 94),
  ('photography',       'Photography',            'camera-outline',         '#1A1A1A', 96),
  ('writing',           'Writing',                'create-outline',         '#1A1A1A', 98),
  ('reading',           'Reading',                'library-outline',        '#1A1A1A', 100),
  ('podcasts',          'Podcasts',               'headset-outline',        '#1A1A1A', 102),

  -- Lifestyle / social
  ('coffee',            'Coffee',                 'cafe-outline',           '#1A1A1A', 110),
  ('dining',            'Dinner Out',             'restaurant-outline',     '#1A1A1A', 112),
  ('concerts',          'Concerts',               'musical-note-outline',   '#1A1A1A', 114),
  ('shopping',          'Mall / Shopping',        'bag-outline',            '#1A1A1A', 116),
  ('board-games',       'Board Games',            'dice-outline',           '#1A1A1A', 118),
  ('movies',            'Movies',                 'film-outline',           '#1A1A1A', 120),
  ('travel',            'Travel',                 'airplane-outline',       '#1A1A1A', 122),

  -- Work / growth
  ('entrepreneurship',  'Entrepreneurship',       'rocket-outline',         '#1A1A1A', 130),
  ('investing',         'Investing / Finance',    'trending-up-outline',    '#1A1A1A', 132),
  ('mentorship',        'Mentorship',             'school-outline',         '#1A1A1A', 134)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order;

-- Normalize any pre-existing rows we DIDN'T touch above to the neutral color.
update public.activities set icon_color = '#1A1A1A' where icon_color <> '#1A1A1A';


-- ─── 2) interest_requests table ──────────────────────────────────────────────
create table if not exists public.interest_requests (
  id                  uuid primary key default gen_random_uuid(),
  requested_by        uuid references public.profiles(id) on delete set null,
  name                text not null check (length(btrim(name)) between 1 and 80),
  description         text check (description is null or length(btrim(description)) <= 500),
  status              text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  approved_activity_id text references public.activities(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_interest_requests_status_created
  on public.interest_requests (status, created_at desc);

alter table public.interest_requests enable row level security;

-- Authenticated users can read THEIR OWN requests (so the client can refresh
-- the form after submit). No global read.
drop policy if exists interest_requests_select_own on public.interest_requests;
create policy interest_requests_select_own
  on public.interest_requests for select
  to authenticated
  using (requested_by = auth.uid());

-- Insert path goes through the RPC (security definer); deny direct INSERTs.
drop policy if exists interest_requests_no_direct_insert on public.interest_requests;


-- ─── 3) request_interest RPC ─────────────────────────────────────────────────
create or replace function public.request_interest(
  p_name        text,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_name text := btrim(p_name);
  v_desc text := nullif(btrim(p_description), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_name is null or length(v_name) = 0 then
    raise exception 'name is required';
  end if;
  if length(v_name) > 80 then
    raise exception 'name too long (max 80)';
  end if;
  if v_desc is not null and length(v_desc) > 500 then
    raise exception 'description too long (max 500)';
  end if;

  insert into public.interest_requests (requested_by, name, description)
  values (v_uid, v_name, v_desc)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.request_interest(text, text) to authenticated;


-- ─── 4) Hometown copied from signup metadata ─────────────────────────────────
-- handle_new_user() now reads `hometown` out of raw_user_meta_data and writes
-- it to the profile row. Combined with the existing lat/lng + city/state
-- copy. Idempotent — re-declares the whole function.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lat double precision := nullif(trim(new.raw_user_meta_data->>'lat'), '')::double precision;
  v_lng double precision := nullif(trim(new.raw_user_meta_data->>'lng'), '')::double precision;
begin
  insert into public.profiles (id, full_name, phone, zip, city, state, hometown, location)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(trim(new.raw_user_meta_data->>'phone'),    ''),
    nullif(trim(new.raw_user_meta_data->>'zip'),      ''),
    nullif(trim(new.raw_user_meta_data->>'city'),     ''),
    upper(nullif(trim(new.raw_user_meta_data->>'state'), '')),
    nullif(trim(new.raw_user_meta_data->>'hometown'), ''),
    case
      when v_lat is not null and v_lng is not null
           and v_lat between  -90 and  90
           and v_lng between -180 and 180
        then ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- DONE.
-- Verify:
--   select count(*) from public.activities;            -- ~45
--   select id, name, status from public.interest_requests order by created_at desc;
-- =============================================================================


-- =============================================================================
-- Migration: 0047_church_name_freeform.sql
-- =============================================================================
-- =============================================================================
-- 0047_church_name_freeform.sql
--
-- We don't have a curated church list yet. Replace the picker with a free-text
-- field on profiles. The existing church_id FK stays in place for when we add
-- a curated directory later.
-- =============================================================================

alter table public.profiles
  add column if not exists church_name text;

comment on column public.profiles.church_name is
  'Free-text church the user attends. Used until we ship a curated church directory.';

-- Standalone setter — leaves complete_onboarding/update_profile untouched.
create or replace function public.set_church_name(p_church_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_name := nullif(btrim(coalesce(p_church_name, '')), '');
  if v_name is not null and length(v_name) > 120 then
    raise exception 'church name too long (max 120 characters)';
  end if;

  update public.profiles
     set church_name = v_name
   where id = v_uid;
end;
$$;

grant execute on function public.set_church_name(text) to authenticated;


-- =============================================================================
-- Migration: 0048_group_invites.sql
-- =============================================================================
-- =============================================================================
-- 0048_group_invites.sql
-- Lets group owners (and, for public groups, any member) invite their
-- connections to a group. Creates one in-app notification per invitee.
--
-- Tables / RPCs:
--   1. group_invites           — pending/accepted/declined invites
--   2. invite_to_group(...)    — bulk-invite RPC (creates rows + notifications)
--   3. respond_to_group_invite — accept/decline (accept = auto-join)
--   4. my_group_invites()      — list pending invites for the current user
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

-- ---- 1. group_invites table -------------------------------------------------
create table if not exists public.group_invites (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id)   on delete cascade,
  inviter_id    uuid not null references public.profiles(id) on delete cascade,
  invitee_id    uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined','revoked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (group_id, invitee_id)
);

create index if not exists idx_group_invites_invitee_pending
  on public.group_invites (invitee_id) where status = 'pending';

create index if not exists idx_group_invites_group
  on public.group_invites (group_id);

-- ---- 2. RLS ----------------------------------------------------------------
alter table public.group_invites enable row level security;

drop policy if exists "group_invites: select own" on public.group_invites;
create policy "group_invites: select own"
  on public.group_invites for select
  using (invitee_id = auth.uid() or inviter_id = auth.uid());

-- All writes go through SECURITY DEFINER RPCs; no direct INSERT/UPDATE/DELETE.

-- ---- 3. invite_to_group RPC ------------------------------------------------
-- Anyone who is a member of the group can invite. (Tightens easily later by
-- restricting to owner if you want.)
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
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_invitees is null or array_length(p_invitees, 1) is null then
    return 0;
  end if;

  -- Must be a member of the group.
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
    -- Skip self, existing members, and dupes (unique constraint also blocks).
    if v_invitee = v_uid then continue; end if;
    if exists (
      select 1 from public.group_members
      where group_id = p_group and profile_id = v_invitee
    ) then continue; end if;

    -- Upsert the invite — re-invite resets status to pending.
    insert into public.group_invites (group_id, inviter_id, invitee_id, status)
    values (p_group, v_uid, v_invitee, 'pending')
    on conflict (group_id, invitee_id)
      do update set status = 'pending', responded_at = null, inviter_id = excluded.inviter_id;

    -- Fire a notification (uses the 0027 notifications table directly —
    -- there's no trigger because invites aren't a message/post).
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

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.invite_to_group(uuid, uuid[]) to authenticated;

-- ---- 4. respond_to_group_invite RPC ----------------------------------------
-- p_accept = true  → status='accepted' + join_group()
-- p_accept = false → status='declined'
create or replace function public.respond_to_group_invite(
  p_invite uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_group   uuid;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select group_id, status into v_group, v_status
  from public.group_invites
  where id = p_invite and invitee_id = v_uid;

  if v_group is null then
    raise exception 'invite not found';
  end if;
  if v_status <> 'pending' then
    return v_status;
  end if;

  if p_accept then
    update public.group_invites
       set status = 'accepted', responded_at = now()
     where id = p_invite;
    perform public.join_group(v_group);
    return 'accepted';
  else
    update public.group_invites
       set status = 'declined', responded_at = now()
     where id = p_invite;
    return 'declined';
  end if;
end;
$$;

grant execute on function public.respond_to_group_invite(uuid, boolean) to authenticated;

-- ---- 5. my_group_invites RPC -----------------------------------------------
create or replace function public.my_group_invites()
returns table (
  id            uuid,
  group_id      uuid,
  group_name    text,
  group_cover   text,
  inviter_id    uuid,
  inviter_name  text,
  created_at    timestamptz
)
language sql stable
set search_path = public
as $$
  select gi.id, gi.group_id, g.name, g.cover_path,
         gi.inviter_id, p.full_name, gi.created_at
    from public.group_invites gi
    join public.groups   g on g.id = gi.group_id
    left join public.profiles p on p.id = gi.inviter_id
   where gi.invitee_id = auth.uid()
     and gi.status     = 'pending'
   order by gi.created_at desc;
$$;

grant execute on function public.my_group_invites() to authenticated;

commit;


-- =============================================================================
-- Migration: 0049_anywhere_mutual_sort.sql
-- =============================================================================
-- =============================================================================
-- 0049_anywhere_mutual_sort.sql
--
-- Fixes "Anywhere" mode never actually showing everyone, and adds mutual
-- connection count to drive ranking.
--
-- Problems solved:
--   1. "Anywhere" in the UI passed no RPC args, so the SQL fell to condition (D)
--      and hard-filtered by the profile's saved discovery_radius_miles (default
--      50 mi). Nowhere near "anywhere". Fixed via explicit p_anywhere flag.
--   2. Anywhere sort was distance-first, which is meaningless when showing the
--      whole world. Now sorts by score desc, mutual_count desc.
--   3. mutual_count (shared mutual friends between viewer and candidate) was not
--      computed or surfaced. Now returned so the feed can show "X mutual".
--
-- Changes:
--   top_matches()         → new p_anywhere boolean param; Anywhere sort = score desc
--   top_matches_detailed() → new p_anywhere boolean param; adds mutual_count int output
--
-- Hometown: already wired (+10 in match_score, same_hometown flag in detailed).
-- No change needed — it's a key input to score and surfaced in the card.
--
-- Run AFTER 0048. Idempotent (drop + recreate).
-- =============================================================================

-- Drop all existing overloads
drop function if exists public.top_matches(int);
drop function if exists public.top_matches(int, double precision, double precision, int);
drop function if exists public.top_matches(int, double precision, double precision, int, boolean);

create or replace function public.top_matches(
  p_limit     int               default 20,
  p_lat       double precision  default null,
  p_lng       double precision  default null,
  p_radius_mi int               default null,
  p_anywhere  boolean           default false
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me) is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    ((select pt from filter_pt) is not null) as in_radius
  from public.profiles p, me
  where p.id <> me.id
    and coalesce(p.full_name, '') <> ''
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    and (
      case
        -- (A) Explicit Anywhere flag: show every real account, no geo gate.
        when p_anywhere = true then true
        -- (B) Override active (Near Me / Search city): HARD radius; unmapped excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (C) No override + saved Anywhere (radius = 0): show everyone.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        -- (D) No override + viewer has no location: show everyone.
        when me.location is null then true
        -- (E) No override + saved radius > 0: HARD filter; unmapped excluded.
        else
          p.location is not null
          and ST_DWithin(
                me.location,
                p.location,
                me.discovery_radius_miles::float * 1609.34
              )
      end
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  -- Anywhere: score-first (distance is meaningless world-wide).
  -- Near Me:  closest first; unmapped users fall to the bottom.
  order by
    (case when p_anywhere then 0::float
          else coalesce(
            case
              when (select pt from filter_pt) is not null and p.location is not null
                then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::float
              when (select location from me) is not null and p.location is not null
                then (ST_Distance((select location from me), p.location) / 1609.34)::float
              else 9999999::float
            end, 9999999::float)
     end) asc,
    public.match_score((select id from me), p.id) desc,
    p.created_at desc
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int, boolean) to authenticated;


-- =============================================================================
-- top_matches_detailed: add p_anywhere + mutual_count
-- =============================================================================
drop function if exists public.top_matches_detailed(int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int);
drop function if exists public.top_matches_detailed(int, double precision, double precision, int, boolean);

create or replace function public.top_matches_detailed(
  p_limit     int               default 25,
  p_lat       double precision  default null,
  p_lng       double precision  default null,
  p_radius_mi int               default null,
  p_anywhere  boolean           default false
)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  in_radius         boolean,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  same_hometown     boolean,
  mutual_count      int,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with
  me as (select auth.uid() as id),
  me_p as (
    select id, hometown from public.profiles where id = (select id from me)
  ),
  -- My mutual matches: people where we've both liked each other.
  -- Used to compute shared mutual friends per candidate.
  my_matches as (
    select c1.to_profile as friend_id
    from public.connections c1
    join public.connections c2
      on  c2.from_profile = c1.to_profile
      and c2.to_profile   = (select id from me)
      and c2.kind         = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind         = 'like'
  ),
  base as (
    select * from public.top_matches(p_limit, p_lat, p_lng, p_radius_mi, p_anywhere)
  )
  select
    b.profile_id,
    b.score,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then b.distance_mi else null end                         as distance_mi,
    b.in_radius,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end                                as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                               as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label                                                      as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                           as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then c.name else null end                                as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                               as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile   = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                             as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile   = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                             as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile   = p.id
          and cn.kind         = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile   = (select id from me)
          and cn.kind         = 'like'
      )
    )                                                             as is_match,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                                             as same_hometown,
    -- Shared mutual friends: people both the viewer AND this candidate
    -- are mutually matched with (bidirectional like). Shows social proof.
    (
      select count(distinct mm.friend_id)::int
      from my_matches mm
      -- candidate → mutual friend (like)
      join public.connections c3
        on  c3.from_profile = b.profile_id
        and c3.to_profile   = mm.friend_id
        and c3.kind         = 'like'
      -- mutual friend → candidate (like back)
      join public.connections c4
        on  c4.from_profile = mm.friend_id
        and c4.to_profile   = b.profile_id
        and c4.kind         = 'like'
    )                                                             as mutual_count,
    p.created_at
  from base b
  join public.profiles   p  on p.id  = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  -- Anywhere: best score first, then most mutual connections.
  -- Near Me:  closest first; unmapped users at the bottom.
  order by
    (case when p_anywhere then 0::float
          else coalesce(b.distance_mi, 9999)::float
     end) asc,
    b.score desc,
    mutual_count desc;
$$;

grant execute on function public.top_matches_detailed(int, double precision, double precision, int, boolean) to authenticated;

-- =============================================================================
-- DONE.
-- Verify Anywhere shows everyone:
--   select profile_id, full_name, distance_mi, score, mutual_count
--     from top_matches_detailed(100, null, null, null, true);
--   → should return every real account except caller, ordered by score desc.
--
-- Verify Near Me still uses distance:
--   select profile_id, full_name, distance_mi, score
--     from top_matches_detailed(25, 30.28, -86.13, 25, false);
--   → should return profiles within 25 mi, closest first.
-- =============================================================================


-- =============================================================================
-- Migration: 0050_add_mahjong_and_single_parent.sql
-- =============================================================================
-- =============================================================================
-- 0050_add_mahjong_and_single_parent.sql
--
-- 1) Add 'Mahjong' to activities (lifestyle/social section, sort_order 119)
-- 2) Add 'Single Parent' to life_stages (sort_order 10)
--
-- Idempotent via ON CONFLICT. Safe to re-run.
-- Run AFTER 0049_anywhere_mutual_sort.sql.
-- =============================================================================

-- ─── 1) Mahjong interest ─────────────────────────────────────────────────────
insert into public.activities (id, label, icon, icon_color, sort_order) values
  ('mahjong', 'Mahjong', 'dice-outline', '#1A1A1A', 119)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order;

-- ─── 2) Single Parent life stage ─────────────────────────────────────────────
insert into public.life_stages (id, label, icon, icon_color, sort_order, has_kids) values
  ('single-parent', 'Single Parent', 'people-outline', '#5A7A4A', 10, true)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order,
  has_kids   = excluded.has_kids;

-- =============================================================================
-- DONE.
-- Verify:
--   select id, label from public.activities where id = 'mahjong';
--   select id, label, has_kids from public.life_stages where id = 'single-parent';
-- =============================================================================


-- =============================================================================
-- Migration: 0051_threads_avatar_url.sql
-- =============================================================================
-- 0051: Add other_avatar_url to my_threads_detailed
-- Threads list needs the other person's photo for the chat header.

create or replace function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  group_id              uuid,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  other_avatar_url      text,
  last_message_at       timestamptz,
  last_message_body     text,
  last_message_sender   uuid,
  last_read_at          timestamptz,
  unread_count          int
)
language sql
stable
set search_path = public
as $$
  with my_threads as (
    select tp.thread_id, tp.last_read_at
    from public.thread_participants tp
    where tp.profile_id = auth.uid()
  ),
  other_party as (
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id             as other_id,
           p.full_name      as other_name,
           p.handle::text   as other_handle,
           p.avatar_url     as other_avatar_url
    from public.thread_participants tp
    join public.profiles p on p.id = tp.profile_id
    where tp.thread_id in (select thread_id from my_threads)
      and tp.profile_id <> auth.uid()
    order by tp.thread_id, tp.joined_at asc
  ),
  last_msg as (
    select distinct on (m.thread_id)
           m.thread_id, m.body, m.sender_id, m.created_at
    from public.messages m
    where m.thread_id in (select thread_id from my_threads)
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::int as cnt
    from public.messages m
    join my_threads mt on mt.thread_id = m.thread_id
    where m.sender_id <> auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
    group by m.thread_id
  )
  select t.id                                                             as thread_id,
         t.kind,
         t.group_id,
         case when t.kind = 'group' then null else op.other_id end        as other_profile_id,
         case when t.kind = 'group' then g.name else op.other_name end    as other_full_name,
         case when t.kind = 'group' then null else op.other_handle end    as other_handle,
         case when t.kind = 'group' then null else op.other_avatar_url end as other_avatar_url,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread       u   on u.thread_id  = t.id
  left join public.groups g  on g.id = t.group_id
  where t.kind = 'group'
     or op.other_id is null
     or not exists (
       select 1 from public.connections b
       where b.kind = 'block'
         and (
           (b.from_profile = auth.uid() and b.to_profile = op.other_id)
           or (b.from_profile = op.other_id and b.to_profile = auth.uid())
         )
     )
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;


-- =============================================================================
-- Migration: 0052_profile_nudge_email.sql
-- =============================================================================
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


-- =============================================================================
-- Migration: 0053_mark_thread_notifs_read.sql
-- =============================================================================
-- =============================================================================
-- 0053_mark_thread_notifs_read.sql
--
-- Adds an RPC so ChatScreen can clear the direct_message notification rows
-- for a given thread when the user reads it. Previously, markRead() only
-- updated thread_participants.last_read_at (clearing the Messages tab badge)
-- but left notifications.read_at = null, keeping the bell badge on Discover
-- lit up even after the message was viewed.
-- =============================================================================

create or replace function public.mark_thread_notifications_read(p_thread_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id   = auth.uid()
    and read_at   is null
    and entity_id = p_thread_id
    and entity_type = 'thread';
$$;

grant execute on function public.mark_thread_notifications_read(uuid) to authenticated;


-- =============================================================================
-- Migration: 0054_political_lean.sql
-- =============================================================================
-- =============================================================================
-- 0054_political_lean.sql
--
-- 1) Adds `political_lean` integer column to profiles.
--    Range: -100 (hard left) to 100 (hard right). NULL = skipped (optional).
--
-- 2) Replaces `complete_onboarding` to accept the new param.
--    Old signature is dropped first (param count changed).
--
-- Idempotent. Safe to re-run.
-- Run AFTER 0053.
-- =============================================================================

-- ─── 1) Column ───────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists political_lean integer
  check (political_lean is null or (political_lean between -100 and 100));


-- ─── 2) complete_onboarding (new signature) ──────────────────────────────────
-- Drop old signature (param count changed — Postgres won't overload-resolve).
drop function if exists public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[]
);

create or replace function public.complete_onboarding(
  p_life_stage     text,
  p_school_type    text,
  p_love_language  text,
  p_church_id      uuid,
  p_city           text,
  p_state          text,
  p_is_initiator   boolean,
  p_is_outgoing    boolean,
  p_activities     text[],
  p_goals          text[],
  p_values         text[],
  p_political_lean integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = p_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    political_lean      = p_political_lean,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x
    on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x
    on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[], integer
) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select column_name from information_schema.columns
--     where table_name = 'profiles' and column_name = 'political_lean';
--   select proname from pg_proc where proname = 'complete_onboarding';
-- =============================================================================


-- =============================================================================
-- Migration: 0055_match_score_overhaul.sql
-- =============================================================================
-- =============================================================================
-- 0055_match_score_overhaul.sql
--
-- Rewrites match_score() with better signal weighting.
--
-- OLD weights (broken):
--   30 activities + 30 goals + 25 life_stage + 15 proximity + 10 hometown = 110 → 100
--   Problem: proximity double-counts the discovery filter; family values collected
--   but worth 0 pts; life stage is exact-only (no partial credit for parents).
--
-- NEW weights:
--   30 pts  activities     (Jaccard × 30)
--   25 pts  goals          (Jaccard × 25)
--   20 pts  life stage     (20 exact | 8 "both parents, any age")
--   15 pts  family values  (Jaccard × 15) ← WAS 0, now scored
--   10 pts  hometown       (bonus)
--   10 pts  political lean (optional — only when both set, 0-diff = 10, 200-diff = 0)
--   ─────────────────
--   110 max, clamped to 100
--
-- Drops proximity from score. Rationale: proximity is already the discovery
-- filter (radius gate). Once someone is inside your radius, distance is not
-- a compatibility signal — it's a logistics detail.
--
-- Run AFTER 0054_political_lean.sql.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = candidate;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life stage (20 exact | 8 parent-tier partial) ─────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    -- Both are parents regardless of kids' ages → meaningful partial overlap.
    score := score + 8;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  -- Only counts when at least one person has values set. If neither filled it
  -- out, skip rather than penalizing both — it's optional.
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean alignment (+0–10, optional) ───────────────────────────
  -- Only fires when BOTH users answered. Max diff = 200 (-100 vs +100).
  -- Linear scale: 0-diff → +10, 200-diff → +0.
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify by running against two real profiles in Supabase SQL editor:
--   select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================


-- =============================================================================
-- Migration: 0056_denomination.sql
-- =============================================================================
-- =============================================================================
-- 0056_denomination.sql
--
-- 1) Creates `denominations` reference table (same pattern as school_types).
-- 2) Adds `denomination_id` FK to profiles.
-- 3) Seeds 13 common denominations.
-- 4) Enables RLS + public read policy.
-- 5) Rewrites `complete_onboarding` to accept `p_denomination_id`.
-- 6) Adds denomination exact-match (+10) to match_score.
--    Total possible: 120, clamped to 100.
--
-- Idempotent. Safe to re-run.
-- Run AFTER 0055_match_score_overhaul.sql.
-- =============================================================================

-- ─── 1) Reference table ──────────────────────────────────────────────────────
create table if not exists public.denominations (
  id          text primary key,
  label       text not null,
  icon        text not null default 'business-outline',
  icon_color  text not null default '#1A1A1A',
  sort_order  int  not null default 0
);

-- ─── 2) Column on profiles ───────────────────────────────────────────────────
alter table public.profiles
  add column if not exists denomination_id text
  references public.denominations(id) on delete set null;

create index if not exists idx_profiles_denomination on public.profiles (denomination_id);

-- ─── 3) Seed denominations ───────────────────────────────────────────────────
insert into public.denominations (id, label, icon, icon_color, sort_order) values
  ('non-denom',       'Non-Denominational',     'infinite-outline',        '#1A1A1A', 10),
  ('baptist',         'Baptist',                'book-outline',            '#1A1A1A', 20),
  ('methodist',       'Methodist',              'heart-outline',           '#1A1A1A', 30),
  ('presbyterian',    'Presbyterian',           'library-outline',         '#1A1A1A', 40),
  ('lutheran',        'Lutheran',               'leaf-outline',            '#1A1A1A', 50),
  ('catholic',        'Catholic',               'business-outline',        '#1A1A1A', 60),
  ('anglican',        'Anglican / Episcopal',   'navigate-outline',        '#1A1A1A', 70),
  ('pentecostal',     'Pentecostal / Charismatic','flame-outline',         '#1A1A1A', 80),
  ('assemblies',      'Assemblies of God',      'people-outline',          '#1A1A1A', 90),
  ('church-of-christ','Church of Christ',       'home-outline',            '#1A1A1A', 100),
  ('reformed',        'Reformed / Calvinist',   'shield-outline',          '#1A1A1A', 110),
  ('evangelical',     'Evangelical Free',       'star-outline',            '#1A1A1A', 120),
  ('other',           'Other',                  'ellipsis-horizontal-outline','#1A1A1A', 999)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order;

-- ─── 4) RLS ──────────────────────────────────────────────────────────────────
alter table public.denominations enable row level security;

drop policy if exists denominations_public_read on public.denominations;
create policy denominations_public_read
  on public.denominations for select
  to authenticated
  using (true);

-- ─── 5) complete_onboarding (new signature with denomination) ────────────────
drop function if exists public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[], integer
);

create or replace function public.complete_onboarding(
  p_life_stage      text,
  p_school_type     text,
  p_love_language   text,
  p_church_id       uuid,
  p_city            text,
  p_state           text,
  p_is_initiator    boolean,
  p_is_outgoing     boolean,
  p_activities      text[],
  p_goals           text[],
  p_values          text[],
  p_political_lean  integer default null,
  p_denomination_id text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = p_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    political_lean      = p_political_lean,
    denomination_id     = p_denomination_id,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x
    on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x
    on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[], integer, text
) to authenticated;

-- ─── 6) match_score — add denomination alignment ─────────────────────────────
-- Adds +10 for exact denomination match on top of 0055 weights.
-- Max possible: 120, clamped to 100. No change to other signals.

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  v_denom       text;
  c_denom       text;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean, denomination_id
    into v_lifestage, v_hometown, v_political, v_denom
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean, denomination_id
    into c_lifestage, c_hometown, c_political, c_denom
    from public.profiles where id = candidate;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life stage (20 exact | 8 parent-tier partial) ─────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 8;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  -- ── Denomination exact match (+10, optional) ──────────────────────────────
  -- Only fires when both answered. 'other' vs 'other' still counts.
  if v_denom is not null and c_denom is not null and v_denom = c_denom then
    score := score + 10;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify:
--   select id, label from public.denominations order by sort_order;   -- 13 rows
--   select column_name from information_schema.columns
--     where table_name = 'profiles' and column_name = 'denomination_id';
-- =============================================================================


-- =============================================================================
-- Migration: 0057_score_tuning.sql
-- =============================================================================
-- =============================================================================
-- 0057_score_tuning.sql
--
-- Adjustments to match_score():
--   1. Life stage: 20 → 25 (exact match), 8 → 10 (parent-tier partial)
--   2. School type: +10 flat bonus — exact match, only when BOTH users are
--      parent life stages. Irrelevant for non-parents.
--
-- No changes to activities, goals, family values, hometown, political lean,
-- or denomination weights.
--
-- Max possible raw: 120 + 10 (school type) = 130, clamped to 100.
--
-- Run AFTER 0056_denomination.sql.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage    text;
  c_lifestage    text;
  v_hometown     text;
  c_hometown     text;
  v_political    integer;
  c_political    integer;
  v_denom        text;
  c_denom        text;
  v_school       text;
  c_school       text;
  shared_acts    int;
  total_acts     int;
  shared_goals   int;
  total_goals    int;
  shared_vals    int;
  total_vals     int;
  parent_stages  text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score          int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean, denomination_id, school_type_id
    into v_lifestage, v_hometown, v_political, v_denom, v_school
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean, denomination_id, school_type_id
    into c_lifestage, c_hometown, c_political, c_denom, c_school
    from public.profiles where id = candidate;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life stage (25 exact | 10 parent-tier partial) ────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 25;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 10;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── School type (+10, parents only) ──────────────────────────────────────
  -- Only fires when both users are in a parent life stage AND both answered.
  if v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages)
     and v_school is not null and c_school is not null
     and v_school = c_school then
    score := score + 10;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  -- ── Denomination exact match (+10, optional) ──────────────────────────────
  if v_denom is not null and c_denom is not null and v_denom = c_denom then
    score := score + 10;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Updated weights summary:
--   30  activities     (Jaccard × 30)
--   25  goals          (Jaccard × 25)
--   25  life stage     (exact) / 10 (parent-tier partial)  ← bumped from 20/8
--   15  family values  (Jaccard × 15)
--   10  hometown       (exact bonus)
--   10  denomination   (exact bonus, optional)
--   10  school type    (exact bonus, parent life stages only, optional)
--    10 political lean (0–10 gradient, optional)
--   ──────────────────────────────────────────────────────
--   Max raw: 135, clamped to 100
--
-- Verify:
--   select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================


-- =============================================================================
-- Migration: 0058_score_sam.sql
-- =============================================================================
-- =============================================================================
-- 0058_score_sam.sql
--
-- Sam's scoring rebalance (2026-05-29):
--   Life stage is the dominant signal — bumped to 50 exact / 20 partial.
--   Activities scaled back to 20. Goals → 15. Everything else tightened.
--
-- New weights:
--   50  life stage     (exact) / 20 (parent-tier partial)   ← was 25/10
--   20  activities     (Jaccard × 20)                        ← was 30
--   15  goals          (Jaccard × 15)                        ← was 25
--   10  family values  (Jaccard × 10)                        ← was 15
--    8  denomination   (exact bonus, optional)               ← was 10
--    8  hometown       (exact bonus)                         ← was 10
--    7  school type    (exact bonus, parents only, optional) ← was 10
--   10  political lean (0–10 gradient, optional)             ← unchanged
--   ──────────────────────────────────────────────────────
--   Max raw: 128, clamped to 100
--
-- Run AFTER 0057_score_tuning.sql.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage    text;
  c_lifestage    text;
  v_hometown     text;
  c_hometown     text;
  v_political    integer;
  c_political    integer;
  v_denom        text;
  c_denom        text;
  v_school       text;
  c_school       text;
  shared_acts    int;
  total_acts     int;
  shared_goals   int;
  total_goals    int;
  shared_vals    int;
  total_vals     int;
  parent_stages  text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score          int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean, denomination_id, school_type_id
    into v_lifestage, v_hometown, v_political, v_denom, v_school
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean, denomination_id, school_type_id
    into c_lifestage, c_hometown, c_political, c_denom, c_school
    from public.profiles where id = candidate;

  -- ── Life stage (50 exact | 20 parent-tier partial) ───────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 50;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 20;
  end if;

  -- ── Activities (Jaccard × 20) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 20)::int;
  end if;

  -- ── Goals (Jaccard × 15) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 15)::int;
  end if;

  -- ── Family values (Jaccard × 10) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 10)::int;
  end if;

  -- ── Denomination exact match (+8, optional) ───────────────────────────────
  if v_denom is not null and c_denom is not null and v_denom = c_denom then
    score := score + 8;
  end if;

  -- ── Hometown (+8) ─────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 8;
  end if;

  -- ── School type (+7, parents only) ───────────────────────────────────────
  if v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages)
     and v_school is not null and c_school is not null
     and v_school = c_school then
    score := score + 7;
  end if;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify:
--   select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================


-- =============================================================================
-- Migration: 0059_remove_activity_scoring.sql
-- =============================================================================
-- =============================================================================
-- 0056_remove_activity_scoring.sql
--
-- Removes activities from match_score() per product decision (2026-05-30).
--
-- RATIONALE (Sam's words): Activities aren't what brings people into community —
-- they're just an excuse to get together. Show shared activities on the connect
-- card as "things we have in common", but don't count them toward the score.
--
-- Activities are now display-only. The UI shows which activities you share,
-- highlighted, but they carry 0 weight in ranking.
--
-- REBALANCED weights (old → new):
--   activities     30 → 0   (removed)
--   goals          25 → 35  (+10)
--   life stage     20 → 25  (+5, parent-tier: 8 → 10)
--   family values  15 → 20  (+5)
--   hometown       10 → 10  (unchanged)
--   political      10 → 10  (unchanged, optional)
--   ─────────────────────────
--   Max: 100 (35+25+20+10+10)
--
-- Run after 0055_match_score_overhaul.sql.
-- =============================================================================

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = candidate;

  -- ── Goals (Jaccard × 35) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 35)::int;
  end if;

  -- ── Life stage (25 exact | 10 parent-tier partial) ────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 25;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 10;
  end if;

  -- ── Family values (Jaccard × 20) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 20)::int;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean alignment (+0–10, optional) ───────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify: select public.match_score('<uuid_a>', '<uuid_b>');
-- =============================================================================


-- =============================================================================
-- Migration: 0060_profile_visibility.sql
-- =============================================================================
-- =============================================================================
-- 0060_profile_visibility.sql
--
-- Adds a "profile visibility" toggle so users can temporarily hide themselves
-- from Discover without deleting their account or any data.
--
-- Changes:
--   1. profiles.is_visible boolean NOT NULL DEFAULT true
--   2. set_profile_visibility(p_visible) RPC — authenticated users toggle own row
--   3. top_matches — re-created with AND p.is_visible = true guard
--      (top_matches_detailed is unchanged; it inherits the filter via top_matches)
--
-- Behaviour:
--   - Hidden users disappear from Discover for all other users.
--   - Existing connections, messages, and group memberships are unaffected.
--   - Inbound connection requests already sent remain visible to the recipient.
--   - Toggling back to visible re-appears in Discover instantly.
-- =============================================================================

-- 1. Add the column (idempotent)
alter table public.profiles
  add column if not exists is_visible boolean not null default true;

-- 2. RPC: authenticated user flips their own visibility
create or replace function public.set_profile_visibility(p_visible boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set    is_visible = p_visible
  where  id = auth.uid();
$$;

grant execute on function public.set_profile_visibility(boolean) to authenticated;

-- 3. top_matches — re-created from 0049 body with is_visible guard added.
-- Only change: AND p.is_visible = true in the WHERE clause.
drop function if exists public.top_matches(int, double precision, double precision, int, boolean);

create or replace function public.top_matches(
  p_limit     int               default 20,
  p_lat       double precision  default null,
  p_lng       double precision  default null,
  p_radius_mi int               default null,
  p_anywhere  boolean           default false
)
returns table (
  profile_id  uuid,
  score       int,
  distance_mi numeric,
  in_radius   boolean
)
language sql stable
set search_path = public
as $$
  with
  me as (
    select id, location, discovery_radius_miles
    from public.profiles
    where id = auth.uid()
  ),
  filter_pt as (
    select case
      when p_lat is not null and p_lng is not null
        then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      else null
    end as pt
  ),
  filter_radius_m as (
    select coalesce(p_radius_mi, 25)::float * 1609.34 as meters
  )
  select
    p.id,
    public.match_score((select id from me), p.id) as score,
    case
      when (select pt from filter_pt) is not null and p.location is not null
        then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::numeric(10,2)
      when (select location from me) is not null and p.location is not null
        then (ST_Distance((select location from me), p.location) / 1609.34)::numeric(10,2)
      else null
    end as distance_mi,
    ((select pt from filter_pt) is not null) as in_radius
  from public.profiles p, me
  where p.id <> me.id
    and p.is_visible = true
    and coalesce(p.full_name, '') <> ''
    and coalesce((p.privacy_prefs ->> 'discoverable')::boolean, true) = true
    and (
      case
        -- (A) Explicit Anywhere flag: show every real account, no geo gate.
        when p_anywhere = true then true
        -- (B) Override active (Near Me / Search city): HARD radius; unmapped excluded.
        when (select pt from filter_pt) is not null then
          p.location is not null
          and ST_DWithin(
                (select pt from filter_pt),
                p.location,
                (select meters from filter_radius_m)
              )
        -- (C) No override + saved Anywhere (radius = 0): show everyone.
        when coalesce(me.discovery_radius_miles, 0) = 0 then true
        -- (D) No override + viewer has no location: show everyone.
        when me.location is null then true
        -- (E) No override + saved radius > 0: HARD filter; unmapped excluded.
        else
          p.location is not null
          and ST_DWithin(
                me.location,
                p.location,
                me.discovery_radius_miles::float * 1609.34
              )
      end
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = me.id and c.to_profile = p.id and c.kind in ('skip','block')
    )
    and not exists (
      select 1 from public.connections c
      where c.from_profile = p.id and c.to_profile = me.id and c.kind = 'block'
    )
  order by
    (case when p_anywhere then 0::float
          else coalesce(
            case
              when (select pt from filter_pt) is not null and p.location is not null
                then (ST_Distance((select pt from filter_pt), p.location) / 1609.34)::float
              when (select location from me) is not null and p.location is not null
                then (ST_Distance((select location from me), p.location) / 1609.34)::float
              else 9999999::float
            end, 9999999::float)
     end) asc,
    public.match_score((select id from me), p.id) desc,
    p.created_at desc
  limit p_limit
$$;

grant execute on function public.top_matches(int, double precision, double precision, int, boolean) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select is_visible from profiles where id = '<your-uuid>';
--   select set_profile_visibility(false);
--   -- should return 0 rows from your account:
--   select count(*) from top_matches(100, null, null, null, true);
-- =============================================================================


-- =============================================================================
-- Migration: 0061_political_lean_and_connections_score.sql
-- =============================================================================
-- =============================================================================
-- 0061_political_lean_and_connections_score.sql
--
-- 1) get_profile_detail — adds political_lean to the returned row so
--    MatchDetailScreen can display the political alignment badge.
--
-- 2) my_connections — adds match_score and activity list so the FOUND tab
--    connections view can show scores and sort/filter by them.
--
-- Run AFTER 0060.
-- =============================================================================

-- ─── 1) get_profile_detail — add political_lean ───────────────────────────────
create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  city              text,
  state             text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  score             int,
  activities        jsonb,
  connection_count  int,
  group_count       int,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean,
  political_lean    integer
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    p.id                  as profile_id,
    p.full_name,
    p.handle::text        as handle,
    p.bio,
    p.avatar_url,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                              as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.life_stage_id,
    ls.label              as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end                         as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end                             as church_name,
    public.match_score((select id from me), p.id)               as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    (
      select count(*)::int
      from public.connections c1
      join public.connections c2
        on c2.from_profile = c1.to_profile
       and c2.to_profile   = c1.from_profile
       and c2.kind         = 'like'
      where c1.from_profile = p.id
        and c1.kind         = 'like'
    )                                                           as connection_count,
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile   = p.id and m.kind = 'like'
      ) and exists (
        select 1 from public.connections t
        where t.from_profile = p.id
          and t.to_profile   = (select id from me) and t.kind = 'like'
      )
    )                                                           as is_match,
    p.political_lean
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- ─── 2) my_connections — add score + activities ───────────────────────────────
drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz,
  score             int,
  activities        jsonb
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at,
    public.match_score((select id from me), p.id) as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                 as activities
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select political_lean from get_profile_detail('<some_uuid>');
--   select score, activities from my_connections() limit 5;
-- =============================================================================


-- =============================================================================
-- Migration: 0062_score_breakdown.sql
-- =============================================================================
-- =============================================================================
-- 0062_score_breakdown.sql
--
-- get_score_breakdown(p_viewer uuid, p_candidate uuid)
--   Returns a jsonb object with the individual point contributions that make
--   up the match_score(), so the client can show users exactly why they
--   scored X% with someone.
--
--   Return shape:
--   {
--     "interests":  { "pts": 18, "max": 30, "shared": 3, "total": 5 },
--     "goals":      { "pts": 20, "max": 25, "shared": 4, "total": 5 },
--     "life_stage": { "pts": 20, "max": 20 },
--     "values":     { "pts":  8, "max": 15, "shared": 2, "total": 4 },
--     "hometown":   { "pts": 10, "max": 10 },
--     "political":  { "pts":  7, "max": 10 }
--   }
--
--   Weights match match_score() in 0055_match_score_overhaul.sql:
--     30 interests + 25 goals + 20 life_stage + 15 values + 10 hometown + 10 political
--     Capped at 100 total.
--
-- Run AFTER 0061.
-- =============================================================================

create or replace function public.get_score_breakdown(p_viewer uuid, p_candidate uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;

  shared_acts   int := 0;
  total_acts    int := 0;
  shared_goals  int := 0;
  total_goals   int := 0;
  shared_vals   int := 0;
  total_vals    int := 0;

  interests_pts  int := 0;
  goals_pts      int := 0;
  stage_pts      int := 0;
  values_pts     int := 0;
  hometown_pts   int := 0;
  political_pts  int := 0;
  political_diff numeric := 0;

  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
begin
  -- ── Fetch base profile fields ──────────────────────────────────────────────
  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = p_viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = p_candidate;

  -- ── Interests (Jaccard × 30) ───────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = p_viewer and pa2.profile_id = p_candidate;

  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (p_viewer, p_candidate);

  if total_acts > 0 then
    interests_pts := (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = p_viewer and pg2.profile_id = p_candidate;

  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (p_viewer, p_candidate);

  if total_goals > 0 then
    goals_pts := (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life Stage (20 exact | 8 both-parents) ────────────────────────────────
  if v_lifestage is not null and c_lifestage is not null then
    if v_lifestage = c_lifestage then
      stage_pts := 20;
    elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
      stage_pts := 8;
    end if;
  end if;

  -- ── Family Values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = p_viewer and pv2.profile_id = p_candidate;

  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (p_viewer, p_candidate);

  if total_vals > 0 then
    values_pts := (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown bonus (10 pts) ───────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and lower(trim(v_hometown)) = lower(trim(c_hometown)) then
    hometown_pts := 10;
  end if;

  -- ── Political lean (0-10 pts, only when both set) ─────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    political_pts  := greatest(0, (10 * (1 - political_diff / 200.0))::int);
  end if;

  return jsonb_build_object(
    'interests',  jsonb_build_object(
                    'pts', interests_pts, 'max', 30,
                    'shared', shared_acts, 'total', total_acts),
    'goals',      jsonb_build_object(
                    'pts', goals_pts, 'max', 25,
                    'shared', shared_goals, 'total', total_goals),
    'life_stage', jsonb_build_object('pts', stage_pts, 'max', 20),
    'values',     jsonb_build_object(
                    'pts', values_pts, 'max', 15,
                    'shared', shared_vals, 'total', total_vals),
    'hometown',   jsonb_build_object('pts', hometown_pts, 'max', 10),
    'political',  jsonb_build_object('pts', political_pts, 'max', 10)
  );
end;
$$;

grant execute on function public.get_score_breakdown(uuid, uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select get_score_breakdown('<viewer_uuid>', '<candidate_uuid>');
-- =============================================================================


-- =============================================================================
-- Migration: 0063_new_taxonomy_and_pin.sql
-- =============================================================================
-- =============================================================================
-- 0063_new_taxonomy_and_pin.sql
--
-- 1. Adds "Single Parent" life stage and "I'm not sure" love language to DB
-- 2. Adds pinned_at to connections table
-- 3. Updates my_connections() to return pinned_at (preserves all 0061 logic)
-- 4. Adds pin_connection / unpin_connection RPCs
-- =============================================================================


-- ── 1. New taxonomy rows ─────────────────────────────────────────────────────

insert into public.life_stages (id, label, icon, icon_color, sort_order, has_kids)
values ('single-parent', 'Single Parent', 'person-circle-outline', '#7A5AA8', 10, false)
on conflict (id) do update
  set label      = excluded.label,
      icon       = excluded.icon,
      icon_color = excluded.icon_color,
      sort_order = excluded.sort_order;

insert into public.love_languages (id, label, icon, icon_color, sort_order)
values ('not-sure', 'I''m not sure', 'help-circle-outline', '#999999', 6)
on conflict (id) do update
  set label      = excluded.label,
      icon       = excluded.icon,
      icon_color = excluded.icon_color,
      sort_order = excluded.sort_order;


-- ── 2. Pin column on connections ─────────────────────────────────────────────

alter table public.connections
  add column if not exists pinned_at timestamptz default null;


-- ── 3. my_connections() — add pinned_at, preserve all 0061 logic ─────────────

drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz,
  pinned_at         timestamptz,
  score             int,
  activities        jsonb
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at,
      c1.pinned_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at,
    m.pinned_at,
    public.match_score((select id from me), p.id) as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                 as activities
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by
    m.pinned_at desc nulls last,
    m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;


-- ── 4. pin_connection / unpin_connection ─────────────────────────────────────

create or replace function public.pin_connection(p_profile uuid)
returns void
language sql
set search_path = public
as $$
  update public.connections
  set pinned_at = now()
  where from_profile = auth.uid()
    and to_profile   = p_profile
    and kind         = 'like';
$$;

grant execute on function public.pin_connection(uuid) to authenticated;

create or replace function public.unpin_connection(p_profile uuid)
returns void
language sql
set search_path = public
as $$
  update public.connections
  set pinned_at = null
  where from_profile = auth.uid()
    and to_profile   = p_profile
    and kind         = 'like';
$$;

grant execute on function public.unpin_connection(uuid) to authenticated;


-- =============================================================================
-- Migration: 0064_hometown_cities.sql
-- =============================================================================
-- =============================================================================
-- 0064_hometown_cities.sql
--
-- Adds hometown_cities TEXT[] to profiles so users can list individual places
-- they've lived for matching (separate from the freeform hometown journey string).
--
-- Updates:
--   - update_profile() to accept p_hometown_cities
--   - get_profile_detail() to return hometown_cities (exact logic from 0043 preserved)
-- =============================================================================

-- ── 1. Column ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists hometown_cities text[] default null;


-- ── 2. update_profile — add p_hometown_cities ─────────────────────────────────
-- Drop and recreate. We need to drop all overloads since Postgres matches on args.

drop function if exists public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[]);

create or replace function public.update_profile(
  p_full_name       text     default null,
  p_bio             text     default null,
  p_hometown        text     default null,
  p_city            text     default null,
  p_state           text     default null,
  p_life_stage      text     default null,
  p_church_id       uuid     default null,
  p_love_language   text     default null,
  p_activities      text[]   default null,
  p_goals           text[]   default null,
  p_hometown_cities text[]   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  update public.profiles set
    full_name        = coalesce(p_full_name,     full_name),
    bio              = coalesce(p_bio,            bio),
    hometown         = coalesce(p_hometown,       hometown),
    city             = coalesce(p_city,           city),
    state            = coalesce(p_state,          state),
    life_stage_id    = coalesce(p_life_stage,     life_stage_id),
    church_id        = coalesce(p_church_id,      church_id),
    love_language_id = coalesce(p_love_language,  love_language_id),
    hometown_cities  = case
                         when p_hometown_cities is not null then p_hometown_cities
                         else hometown_cities
                       end,
    last_active_at   = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, unnest(p_activities)
    on conflict do nothing;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, unnest(p_goals)
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[]) to authenticated;


-- ── 3. get_profile_detail — add hometown_cities ───────────────────────────────
-- Exact 0043 logic preserved; only adds hometown_cities to SELECT and RETURNS.

drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  hometown          text,
  hometown_cities   text[],
  political_lean    int,
  same_hometown     boolean,
  score             int,
  connection_count  int,
  group_count       int,
  activities        jsonb,
  my_kind           public.connection_kind,
  their_kind        public.connection_kind,
  is_match          boolean
)
language sql stable
set search_path = public
as $$
  with me  as (select auth.uid() as id),
       me_p as (select id, hometown from public.profiles where id = (select id from me))
  select
    p.id                                                        as profile_id,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city  else null end                             as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end                             as state,
    p.avatar_url,
    p.life_stage_id,
    ls.label                                                    as life_stage_label,
    p.church_id,
    ch.name                                                     as church_name,
    p.hometown,
    p.hometown_cities,
    p.political_lean,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    )                                                           as same_hometown,
    public.match_score((select id from me), p.id)               as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label, 'icon', a.icon)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                                             as activities,
    (
      select count(*)::int
      from public.connections c1
      join public.connections c2
        on c2.from_profile = c1.to_profile
       and c2.to_profile   = c1.from_profile
       and c2.kind         = 'like'
      where c1.from_profile = p.id
        and c1.kind         = 'like'
    )                                                           as connection_count,
    (
      select count(*)::int
      from public.group_members gm
      where gm.profile_id = p.id
    )                                                           as group_count,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile   = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as my_kind,
    (
      select kind from public.connections t
      where t.from_profile = p.id
        and t.to_profile   = (select id from me)
      order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                                           as their_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile   = p.id and m.kind = 'like'
      ) and exists (
        select 1 from public.connections t
        where t.from_profile = p.id
          and t.to_profile   = (select id from me) and t.kind = 'like'
      )
    )                                                           as is_match
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- =============================================================================
-- Migration: 0065_session_fixes.sql
-- =============================================================================
-- =============================================================================
-- 0065_session_fixes.sql
--
-- Batch of fixes from 6-2-26 review session with Sam:
--
--  1. profiles.looking_for_church  (bool, nullable)
--  2. update_profile()             — canonical drop-all + recreate w/ looking_for_church
--  3. complete_onboarding()        — add p_looking_for_church
--  4. get_profile_detail()         — return looking_for_church
--  5. match_score()                — political: same side only (both>0 or both<0 = +10)
--  6. my_groups_feed()             — add has_pending_invite field
--  7. my_threads_detailed()        — add last_message_is_mine bool
--
-- Run AFTER 0064.
-- =============================================================================

-- ── 1. looking_for_church column ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists looking_for_church boolean default null;


-- ── 2. update_profile — canonical, drop ALL overloads ────────────────────────
-- Drop every known overload before recreating so Postgres doesn't error on
-- ambiguous resolution.
drop function if exists public.update_profile(text,text,text,text,text,uuid,text,text,boolean,boolean,text,text[],text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,uuid,text,text[],text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[]);
drop function if exists public.update_profile(text,text,text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[]);

create or replace function public.update_profile(
  p_full_name            text     default null,
  p_bio                  text     default null,
  p_hometown             text     default null,
  p_city                 text     default null,
  p_state                text     default null,
  p_life_stage           text     default null,
  p_church_id            uuid     default null,
  p_love_language        text     default null,
  p_activities           text[]   default null,
  p_goals                text[]   default null,
  p_hometown_cities      text[]   default null,
  p_hometown_cities_norm text[]   default null,
  p_looking_for_church   boolean  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    full_name              = coalesce(p_full_name,           full_name),
    bio                    = coalesce(p_bio,                 bio),
    hometown               = coalesce(p_hometown,            hometown),
    city                   = coalesce(p_city,                city),
    state                  = coalesce(p_state,               state),
    life_stage_id          = coalesce(p_life_stage,          life_stage_id),
    church_id              = coalesce(p_church_id,           church_id),
    love_language_id       = coalesce(p_love_language,       love_language_id),
    hometown_cities        = case when p_hometown_cities     is not null then p_hometown_cities     else hometown_cities     end,
    looking_for_church     = case when p_looking_for_church  is not null then p_looking_for_church  else looking_for_church  end,
    last_active_at         = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, unnest(p_activities)
      on conflict do nothing;
    end if;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, unnest(p_goals)
      on conflict do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.update_profile(
  text,text,text,text,text,text,uuid,text,text[],text[],text[],text[],boolean
) to authenticated;
-- Also allow calling without the last two optional params (older clients)



-- ── 3. complete_onboarding — add p_looking_for_church ────────────────────────
-- Drop all known overloads before recreating.
drop function if exists public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer
);
drop function if exists public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer,text
);
drop function if exists public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer,text,boolean
);

create or replace function public.complete_onboarding(
  p_life_stage          text,
  p_school_type         text,
  p_love_language       text,
  p_church_id           uuid,
  p_city                text,
  p_state               text,
  p_is_initiator        boolean,
  p_is_outgoing         boolean,
  p_activities          text[],
  p_goals               text[],
  p_values              text[],
  p_political_lean      integer  default null,
  p_denomination_id     text     default null,
  p_looking_for_church  boolean  default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  update public.profiles set
    life_stage_id        = p_life_stage,
    school_type_id       = p_school_type,
    love_language_id     = p_love_language,
    church_id            = p_church_id,
    city                 = p_city,
    state                = p_state,
    is_initiator         = p_is_initiator,
    is_outgoing          = p_is_outgoing,
    political_lean       = p_political_lean,
    denomination_id      = coalesce(p_denomination_id, denomination_id),
    looking_for_church   = p_looking_for_church,
    onboarding_complete  = true,
    last_active_at       = now()
  where id = v_uid;

  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities,1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals,1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values,1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],integer,text,boolean
) to authenticated;


-- ── 4. get_profile_detail — add looking_for_church ───────────────────────────
drop function if exists public.get_profile_detail(uuid);

create or replace function public.get_profile_detail(p_profile uuid)
returns table (
  profile_id            uuid,
  full_name             text,
  handle                text,
  bio                   text,
  city                  text,
  state                 text,
  avatar_url            text,
  life_stage_id         text,
  life_stage_label      text,
  church_id             uuid,
  church_name           text,
  hometown              text,
  hometown_cities       text[],
  political_lean        int,
  same_hometown         boolean,
  looking_for_church    boolean,
  score                 int,
  connection_count      int,
  group_count           int,
  activities            jsonb,
  my_kind               public.connection_kind,
  their_kind            public.connection_kind,
  is_match              boolean
)
language sql stable
set search_path = public
as $$
  with me   as (select auth.uid() as id),
       me_p as (select id, hometown from public.profiles where id = (select id from me))
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.bio,
    case when coalesce((p.privacy_prefs->>'show_location')::boolean, true) then p.city  else null end,
    case when coalesce((p.privacy_prefs->>'show_location')::boolean, true) then p.state else null end,
    p.avatar_url,
    p.life_stage_id,
    ls.label,
    p.church_id,
    ch.name,
    p.hometown,
    p.hometown_cities,
    p.political_lean,
    (
      (select hometown from me_p) is not null
      and p.hometown is not null
      and length(btrim((select hometown from me_p))) > 0
      and lower(btrim((select hometown from me_p))) = lower(btrim(p.hometown))
    ),
    p.looking_for_church,
    public.match_score((select id from me), p.id),
    (
      select count(*)::int from public.connections c1
      join public.connections c2 on c2.from_profile=c1.to_profile and c2.to_profile=c1.from_profile and c2.kind='like'
      where c1.from_profile=p.id and c1.kind='like'
    ),
    (select count(*)::int from public.group_members gm where gm.profile_id=p.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'icon',a.icon) order by a.label)
      from public.profile_activities pa join public.activities a on a.id=pa.activity_id
      where pa.profile_id=p.id
    ), '[]'::jsonb),
    (select kind from public.connections m where m.from_profile=(select id from me) and m.to_profile=p.id
     order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end limit 1),
    (select kind from public.connections t where t.from_profile=p.id and t.to_profile=(select id from me)
     order by case t.kind when 'like' then 0 when 'wave' then 1 else 2 end limit 1),
    (
      exists(select 1 from public.connections m where m.from_profile=(select id from me) and m.to_profile=p.id and m.kind='like')
      and exists(select 1 from public.connections t where t.from_profile=p.id and t.to_profile=(select id from me) and t.kind='like')
    )
  from public.profiles p
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    ch on ch.id = p.church_id
  where p.id = p_profile;
$$;

grant execute on function public.get_profile_detail(uuid) to authenticated;


-- ── 5. match_score — political: same side only ───────────────────────────────
-- OLD: linear scale on abs difference (0-diff=10, 200-diff=0) → moderate matched everyone
-- NEW: +10 only when both positive (conservative) OR both negative (liberal).
--      Moderate (0) matches no one. Opposite sides = 0.
create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies','married-young','married-teens','married-mixed'
  ];
  score int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean
    into v_lifestage, v_hometown, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean
    into c_lifestage, c_hometown, c_political
    from public.profiles where id = candidate;

  -- Activities (Jaccard × 30)
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id=pa2.activity_id
    where pa1.profile_id=viewer and pa2.profile_id=candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities where profile_id in (viewer,candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- Goals (Jaccard × 25)
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id=pg2.goal_id
    where pg1.profile_id=viewer and pg2.profile_id=candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals where profile_id in (viewer,candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- Life stage (20 exact | 8 parent partial)
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 8;
  end if;

  -- Family values (Jaccard × 15)
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id=pv2.value_id
    where pv1.profile_id=viewer and pv2.profile_id=candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values where profile_id in (viewer,candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- Hometown (+10)
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- Political lean (+10) — same side ONLY. Moderate (0) matches nobody.
  if v_political is not null and c_political is not null then
    if (v_political > 0 and c_political > 0)
    or (v_political < 0 and c_political < 0) then
      score := score + 10;
    end if;
  end if;

  return greatest(0, least(100, score));
end $$;


-- ── 6. my_groups_feed — add has_pending_invite ───────────────────────────────
drop function if exists public.my_groups_feed();

create or replace function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean,
  has_pending_invite  boolean
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1)    as cover_path,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=(select id from me))    as is_member,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=(select id from me))      as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=(select id from me)
             and gi.status='pending')                                        as has_pending_invite
  from public.groups g
  -- Include all public groups + any group the user is a member of + any group they've been invited to
  where g.is_public
     or exists(select 1 from public.group_members gm
               where gm.group_id=g.id and gm.profile_id=(select id from me))
     or exists(select 1 from public.group_invites gi
               where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
  order by
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=(select id from me))
         then 0
         when exists(select 1 from public.group_invites gi
                     where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
         then 1
         else 2 end,
    g.member_count desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- ── 7. my_threads_detailed — add last_message_is_mine ───────────────────────
-- Drops the latest overload (from 0051) and recreates with the extra field.
drop function if exists public.my_threads_detailed();

create or replace function public.my_threads_detailed()
returns table (
  thread_id            uuid,
  kind                 text,
  group_id             uuid,
  other_profile_id     uuid,
  other_full_name      text,
  other_handle         text,
  other_avatar_url     text,
  last_message_at      timestamptz,
  last_message_body    text,
  last_message_sender  uuid,
  last_message_is_mine boolean,
  last_read_at         timestamptz,
  unread_count         bigint
)
language sql stable
set search_path = public
as $$
  with
    me as (select auth.uid() as id),
    my_threads as (
      select tp.thread_id, tp.last_read_at
      from public.thread_participants tp where tp.profile_id = (select id from me)
    ),
    other_party as (
      select tp.thread_id,
             p.id           as other_id,
             p.full_name    as other_name,
             p.handle       as other_handle,
             p.avatar_url   as other_avatar_url
      from public.thread_participants tp
      join public.profiles p on p.id = tp.profile_id
      where tp.profile_id <> (select id from me)
    ),
    last_msg as (
      select distinct on (m.thread_id)
             m.thread_id,
             m.body,
             m.sender_id,
             (m.sender_id = (select id from me)) as is_mine
      from public.messages m
      order by m.thread_id, m.created_at desc
    ),
    unread as (
      select m.thread_id, count(*) as cnt
      from public.messages m
      join my_threads mt on mt.thread_id = m.thread_id
      where m.sender_id <> (select id from me)
        and (mt.last_read_at is null or m.created_at > mt.last_read_at)
      group by m.thread_id
    )
  select t.id,
         t.kind::text,
         t.group_id,
         case when t.kind='group' then null else op.other_id          end,
         case when t.kind='group' then g.name else op.other_name      end,
         case when t.kind='group' then null else op.other_handle      end,
         case when t.kind='group' then null else op.other_avatar_url  end,
         t.last_message_at,
         lm.body,
         lm.sender_id,
         coalesce(lm.is_mine, false),
         mt.last_read_at,
         coalesce(u.cnt, 0)
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread        u   on u.thread_id  = t.id
  left join public.groups g   on g.id = t.group_id
  where t.kind = 'group'
     or op.other_id is null
     or not exists (
       select 1 from public.connections b
       where b.kind = 'block'
         and (
           (b.from_profile = (select id from me) and b.to_profile = op.other_id)
           or (b.from_profile = op.other_id and b.to_profile = (select id from me))
         )
     )
  order by t.last_message_at desc nulls last, t.created_at desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;

-- ── 8. group_detail — add has_pending_invite ─────────────────────────────
-- Allows GroupDetailScreen to show "Accept Invite" button for invited users.
drop function if exists public.group_detail(uuid);

create or replace function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean,
  has_pending_invite  boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=auth.uid())
         then g.address else null end as address,
    g.schedule_text, g.member_count, g.church_id, g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
     where gm.group_id=g.id and gm.profile_id=auth.uid()) as my_role,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=auth.uid()) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=auth.uid()
             and gi.status='pending') as has_pending_invite
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select looking_for_church from profiles limit 3;
--   select has_pending_invite from my_groups_feed() limit 3;
--   select last_message_is_mine from my_threads_detailed() limit 3;
-- =============================================================================


-- =============================================================================
-- Migration: 0066_fix_update_profile_overloads.sql
-- =============================================================================
-- =============================================================================
-- 0066_fix_update_profile_overloads.sql
--
-- The update_profile function has accumulated overloads across migrations
-- 0009, 0041, 0064, 0065. When multiple overloads exist with overlapping
-- parameter names, Postgres throws "could not choose best candidate function".
--
-- Fix: dynamically drop ALL overloads, then recreate the single canonical
-- version that EditProfileScreen actually calls.
--
-- Run AFTER 0065.
-- =============================================================================

-- ── 1. Drop every overload of update_profile ─────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_profile'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;


-- ── 2. Canonical update_profile ───────────────────────────────────────────────
-- Single definitive version. All named params match exactly what
-- EditProfileScreen passes via supabase.rpc('update_profile', { ... }).
create or replace function public.update_profile(
  p_full_name            text     default null,
  p_bio                  text     default null,
  p_hometown             text     default null,
  p_city                 text     default null,
  p_state                text     default null,
  p_life_stage           text     default null,
  p_church_id            uuid     default null,
  p_love_language        text     default null,
  p_activities           text[]   default null,
  p_goals                text[]   default null,
  p_hometown_cities      text[]   default null,
  p_looking_for_church   boolean  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    full_name          = coalesce(p_full_name,    full_name),
    bio                = coalesce(p_bio,           bio),
    hometown           = coalesce(p_hometown,      hometown),
    city               = coalesce(p_city,          city),
    state              = coalesce(p_state,         state),
    life_stage_id      = coalesce(p_life_stage,    life_stage_id),
    church_id          = coalesce(p_church_id,     church_id),
    love_language_id   = coalesce(p_love_language, love_language_id),
    hometown_cities    = case
                           when p_hometown_cities is not null then p_hometown_cities
                           else hometown_cities
                         end,
    looking_for_church = case
                           when p_looking_for_church is not null then p_looking_for_church
                           else looking_for_church
                         end,
    last_active_at     = now()
  where id = v_uid;

  if p_activities is not null then
    delete from public.profile_activities where profile_id = v_uid;
    if array_length(p_activities, 1) is not null then
      insert into public.profile_activities (profile_id, activity_id)
      select v_uid, unnest(p_activities)
      on conflict do nothing;
    end if;
  end if;

  if p_goals is not null then
    delete from public.profile_goals where profile_id = v_uid;
    if array_length(p_goals, 1) is not null then
      insert into public.profile_goals (profile_id, goal_id)
      select v_uid, unnest(p_goals)
      on conflict do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.update_profile(
  text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean
) to authenticated;

-- =============================================================================
-- DONE.
-- Verify no overload ambiguity:
--   select count(*) from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'update_profile';
--   -- should return 1
-- =============================================================================


-- =============================================================================
-- Migration: 0067_fix_update_profile_clearable_fields.sql
-- =============================================================================
-- =============================================================================
-- 0067_fix_update_profile_clearable_fields.sql
--
-- Problems fixed:
--   1. bio/hometown/city/state used COALESCE → clearing them in Edit Profile
--      had no effect (passed null → COALESCE kept old value silently)
--   2. political_lean was saved in a separate profiles.update call with no
--      error handling — collapsed into the main RPC
--
-- Changes:
--   - bio, hometown, city, state: direct assign (null clears the field)
--   - full_name: COALESCE(NULLIF(TRIM(...), ''), existing) — can't be blanked
--   - life_stage_id, church_id, love_language_id: COALESCE (can't be blanked)
--   - political_lean: new param, sentinel -999 = not passed
--   - hometown_cities, looking_for_church: CASE IS NOT NULL (unchanged)
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean);
DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],text[],boolean);
DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean,integer);

CREATE OR REPLACE FUNCTION public.update_profile(
  p_full_name            text     DEFAULT NULL,
  p_bio                  text     DEFAULT NULL,
  p_hometown             text     DEFAULT NULL,
  p_city                 text     DEFAULT NULL,
  p_state                text     DEFAULT NULL,
  p_life_stage           text     DEFAULT NULL,
  p_church_id            uuid     DEFAULT NULL,
  p_love_language        text     DEFAULT NULL,
  p_activities           text[]   DEFAULT NULL,
  p_goals                text[]   DEFAULT NULL,
  p_hometown_cities      text[]   DEFAULT NULL,
  p_looking_for_church   boolean  DEFAULT NULL,
  p_political_lean       integer  DEFAULT -999
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles SET
    -- Non-clearable: keep existing value if null/empty passed
    full_name          = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
    life_stage_id      = COALESCE(p_life_stage,    life_stage_id),
    church_id          = COALESCE(p_church_id,     church_id),
    love_language_id   = COALESCE(p_love_language, love_language_id),

    -- Clearable text: direct assign — passing null explicitly clears the field
    bio                = p_bio,
    hometown           = p_hometown,
    city               = p_city,
    state              = p_state,

    -- Arrays: null = don't touch, [] = clear all
    hometown_cities    = CASE WHEN p_hometown_cities IS NOT NULL THEN p_hometown_cities ELSE hometown_cities END,

    -- Boolean: null = don't touch
    looking_for_church = CASE WHEN p_looking_for_church IS NOT NULL THEN p_looking_for_church ELSE looking_for_church END,

    -- political_lean: sentinel -999 = not passed (keep existing), anything else sets it
    political_lean     = CASE WHEN p_political_lean = -999 THEN political_lean ELSE p_political_lean END,

    last_active_at     = now()
  WHERE id = v_uid;

  IF p_activities IS NOT NULL THEN
    DELETE FROM public.profile_activities WHERE profile_id = v_uid;
    IF array_length(p_activities, 1) IS NOT NULL THEN
      INSERT INTO public.profile_activities (profile_id, activity_id)
      SELECT v_uid, unnest(p_activities)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF p_goals IS NOT NULL THEN
    DELETE FROM public.profile_goals WHERE profile_id = v_uid;
    IF array_length(p_goals, 1) IS NOT NULL THEN
      INSERT INTO public.profile_goals (profile_id, goal_id)
      SELECT v_uid, unnest(p_goals)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile(
  text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean,integer
) TO authenticated;


-- =============================================================================
-- Migration: 0068_list_group_pending_invites.sql
-- =============================================================================
-- =============================================================================
-- 0068_list_group_pending_invites.sql
-- Lets group owners/admins see who has been invited but not yet responded.
-- Used by GroupDetailScreen to render the "Invited" row in the members list.
-- =============================================================================

begin;

create or replace function public.list_group_pending_invites(p_group uuid)
returns table (
  invite_id   uuid,
  profile_id  uuid,
  full_name   text,
  handle      text,
  avatar_url  text,
  invited_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  -- Only owners and admins can see the full pending-invite list.
  select
    gi.id           as invite_id,
    p.id            as profile_id,
    p.full_name,
    p.handle,
    p.avatar_url,
    gi.created_at   as invited_at
  from public.group_invites gi
  join public.profiles p on p.id = gi.invitee_id
  where gi.group_id = p_group
    and gi.status   = 'pending'
    and exists (
      select 1
      from public.group_members gm
      where gm.group_id   = p_group
        and gm.profile_id = auth.uid()
        and gm.role in ('owner', 'admin')
    )
  order by gi.created_at;
$$;

grant execute on function public.list_group_pending_invites(uuid) to authenticated;

-- Verify
-- select * from list_group_pending_invites('<group_uuid>');

commit;


-- =============================================================================
-- Migration: 0069_breakdown_detail.sql
-- =============================================================================
-- =============================================================================
-- 0069_breakdown_detail.sql
--
-- get_score_breakdown_detail(p_viewer uuid, p_candidate uuid)
--
--   Returns the actual item labels for each scoreable category so the client
--   can show users WHAT they share, not just how many.
--
--   Return shape:
--   {
--     "interests": {
--       "shared":          [{"id": "beach", "label": "Beach / Lake / River"}],
--       "viewer_only":     [{"id": "hiking", "label": "Hiking"}],
--       "candidate_only":  [{"id": "fitness", "label": "Working Out"}]
--     },
--     "goals": {
--       "shared":          [...],
--       "viewer_only":     [...],
--       "candidate_only":  [...]
--     },
--     "values": {
--       "shared":          [...],
--       "viewer_only":     [...],
--       "candidate_only":  [...]
--     }
--   }
--
--   Only interests, goals, and values return item lists (the list-based categories).
--   Life stage, hometown, and political are handled by get_score_breakdown already.
--
-- Run AFTER 0068.
-- =============================================================================

create or replace function public.get_score_breakdown_detail(p_viewer uuid, p_candidate uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  interests_result jsonb;
  goals_result     jsonb;
  values_result    jsonb;
begin
  -- ── Interests ────────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label) order by a.sort_order)
      from public.activities a
      join public.profile_activities pav on pav.activity_id = a.id and pav.profile_id = p_viewer
      join public.profile_activities pac on pac.activity_id = a.id and pac.profile_id = p_candidate
    ), '[]'::jsonb),
    'viewer_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label) order by a.sort_order)
      from public.activities a
      join public.profile_activities pav on pav.activity_id = a.id and pav.profile_id = p_viewer
      where not exists (
        select 1 from public.profile_activities pac
        where pac.activity_id = a.id and pac.profile_id = p_candidate
      )
    ), '[]'::jsonb),
    'candidate_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label) order by a.sort_order)
      from public.activities a
      join public.profile_activities pac on pac.activity_id = a.id and pac.profile_id = p_candidate
      where not exists (
        select 1 from public.profile_activities pav
        where pav.activity_id = a.id and pav.profile_id = p_viewer
      )
    ), '[]'::jsonb)
  ) into interests_result;

  -- ── Goals ────────────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label) order by g.sort_order)
      from public.community_goals g
      join public.profile_goals pgv on pgv.goal_id = g.id and pgv.profile_id = p_viewer
      join public.profile_goals pgc on pgc.goal_id = g.id and pgc.profile_id = p_candidate
    ), '[]'::jsonb),
    'viewer_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label) order by g.sort_order)
      from public.community_goals g
      join public.profile_goals pgv on pgv.goal_id = g.id and pgv.profile_id = p_viewer
      where not exists (
        select 1 from public.profile_goals pgc
        where pgc.goal_id = g.id and pgc.profile_id = p_candidate
      )
    ), '[]'::jsonb),
    'candidate_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label) order by g.sort_order)
      from public.community_goals g
      join public.profile_goals pgc on pgc.goal_id = g.id and pgc.profile_id = p_candidate
      where not exists (
        select 1 from public.profile_goals pgv
        where pgv.goal_id = g.id and pgv.profile_id = p_viewer
      )
    ), '[]'::jsonb)
  ) into goals_result;

  -- ── Values ───────────────────────────────────────────────────────────────────
  select jsonb_build_object(
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object('id', fv.id, 'label', fv.label) order by fv.sort_order)
      from public.family_values fv
      join public.profile_values pvv on pvv.value_id = fv.id and pvv.profile_id = p_viewer
      join public.profile_values pvc on pvc.value_id = fv.id and pvc.profile_id = p_candidate
    ), '[]'::jsonb),
    'viewer_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', fv.id, 'label', fv.label) order by fv.sort_order)
      from public.family_values fv
      join public.profile_values pvv on pvv.value_id = fv.id and pvv.profile_id = p_viewer
      where not exists (
        select 1 from public.profile_values pvc
        where pvc.value_id = fv.id and pvc.profile_id = p_candidate
      )
    ), '[]'::jsonb),
    'candidate_only', coalesce((
      select jsonb_agg(jsonb_build_object('id', fv.id, 'label', fv.label) order by fv.sort_order)
      from public.family_values fv
      join public.profile_values pvc on pvc.value_id = fv.id and pvc.profile_id = p_candidate
      where not exists (
        select 1 from public.profile_values pvv
        where pvv.value_id = fv.id and pvv.profile_id = p_viewer
      )
    ), '[]'::jsonb)
  ) into values_result;

  return jsonb_build_object(
    'interests', interests_result,
    'goals',     goals_result,
    'values',    values_result
  );
end;
$$;

grant execute on function public.get_score_breakdown_detail(uuid, uuid) to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select get_score_breakdown_detail('<viewer_uuid>', '<candidate_uuid>');
-- =============================================================================


-- =============================================================================
-- Migration: 0070_group_events.sql
-- =============================================================================
-- =============================================================================
-- 0070_group_events.sql
-- Adds group-scoped events.
--
--   1. events.group_id         — nullable FK to groups; links an event to a group
--   2. create_event(...)       — drop+recreate with optional p_group_id param;
--                                when provided, auto-invites all active group members
--   3. group_events_list(...)  — returns upcoming events for a group
-- =============================================================================

-- ── 1. Add group_id column to events ─────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS events_group_id_idx ON public.events(group_id);

-- ── 2. Recreate create_event with p_group_id ─────────────────────────────────
-- Drop old signature first
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[]);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title         text,
  p_event_time    timestamptz,
  p_location_name text    DEFAULT NULL,
  p_location_lat  double precision DEFAULT NULL,
  p_location_lng  double precision DEFAULT NULL,
  p_description   text    DEFAULT NULL,
  p_invitee_ids   uuid[]  DEFAULT NULL,
  p_group_id      uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id  uuid;
  v_member_id uuid;
BEGIN
  -- Create the event
  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id
  )
  RETURNING id INTO v_event_id;

  -- If group_id provided: invite all active group members (except creator)
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
      AND gm.status = 'active'
    ON CONFLICT DO NOTHING;

  -- Otherwise: invite the explicit list
  ELSIF p_invitee_ids IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, UNNEST(p_invitee_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid) TO authenticated;

-- ── 3. group_events_list — upcoming events for a group ───────────────────────
DROP FUNCTION IF EXISTS public.group_events_list(uuid);

CREATE OR REPLACE FUNCTION public.group_events_list(p_group uuid)
RETURNS TABLE (
  id             uuid,
  title          text,
  event_time     timestamptz,
  location_name  text,
  description    text,
  creator_id     uuid,
  going_count    bigint,
  pending_count  bigint,
  my_status      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.event_time,
    e.location_name,
    e.description,
    e.creator_id,
    COUNT(CASE WHEN ei.status = 'accepted' THEN 1 END)  AS going_count,
    COUNT(CASE WHEN ei.status = 'pending'  THEN 1 END)  AS pending_count,
    (SELECT ei2.status FROM public.event_invites ei2
     WHERE ei2.event_id = e.id AND ei2.invitee_id = auth.uid()
     LIMIT 1)                                            AS my_status
  FROM public.events e
  LEFT JOIN public.event_invites ei ON ei.event_id = e.id
  WHERE e.group_id = p_group
    AND e.event_time >= NOW()
  GROUP BY e.id
  ORDER BY e.event_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.group_events_list(uuid) TO authenticated;


-- =============================================================================
-- Migration: 0071_event_recurrence.sql
-- =============================================================================
-- =============================================================================
-- 0071_event_recurrence.sql
-- Adds recurrence support to events.
--
--   1. events.recurrence       — nullable text: 'weekly' | 'biweekly' | 'monthly'
--   2. create_event(...)       — drop+recreate with optional p_recurrence param
--   3. group_events_list(...)  — drop+recreate to include recurrence in output
-- =============================================================================

-- ── 1. Add recurrence column ──────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS recurrence text
  CHECK (recurrence IN ('weekly', 'biweekly', 'monthly'));

-- ── 2. Recreate create_event with p_recurrence ───────────────────────────────
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title         text,
  p_event_time    timestamptz,
  p_location_name text             DEFAULT NULL,
  p_location_lat  double precision DEFAULT NULL,
  p_location_lng  double precision DEFAULT NULL,
  p_description   text             DEFAULT NULL,
  p_invitee_ids   uuid[]           DEFAULT NULL,
  p_group_id      uuid             DEFAULT NULL,
  p_recurrence    text             DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id,
    CASE WHEN p_recurrence IN ('weekly','biweekly','monthly') THEN p_recurrence ELSE NULL END
  )
  RETURNING id INTO v_event_id;

  -- Auto-invite group members when group_id provided
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
      AND gm.status = 'active'
    ON CONFLICT DO NOTHING;

  ELSIF p_invitee_ids IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, UNNEST(p_invitee_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text) TO authenticated;

-- ── 3. Recreate group_events_list to include recurrence ──────────────────────
DROP FUNCTION IF EXISTS public.group_events_list(uuid);

CREATE OR REPLACE FUNCTION public.group_events_list(p_group uuid)
RETURNS TABLE (
  id             uuid,
  title          text,
  event_time     timestamptz,
  location_name  text,
  description    text,
  creator_id     uuid,
  recurrence     text,
  going_count    bigint,
  pending_count  bigint,
  my_status      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.id,
    e.title,
    e.event_time,
    e.location_name,
    e.description,
    e.creator_id,
    e.recurrence,
    COUNT(CASE WHEN ei.status = 'accepted' THEN 1 END) AS going_count,
    COUNT(CASE WHEN ei.status = 'pending'  THEN 1 END) AS pending_count,
    (SELECT ei2.status FROM public.event_invites ei2
     WHERE ei2.event_id = e.id AND ei2.invitee_id = auth.uid()
     LIMIT 1)                                          AS my_status
  FROM public.events e
  LEFT JOIN public.event_invites ei ON ei.event_id = e.id
  WHERE e.group_id = p_group
    AND e.event_time >= NOW()
  GROUP BY e.id
  ORDER BY e.event_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.group_events_list(uuid) TO authenticated;


-- =============================================================================
-- Migration: 0072_group_website_url.sql
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────
-- 0072 · Add website_url to groups
-- Adds an optional URL field (e.g. church site, Eventbrite, etc.)
-- Updates group_detail() and update_group() to expose it.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.groups
  add column if not exists website_url text;

-- ── group_detail: expose website_url ─────────────────────────────────────
-- Must drop first — Postgres won't replace a function with a different return type.

drop function if exists public.group_detail(uuid);

create or replace function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean,
  has_pending_invite  boolean,
  website_url         text
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=auth.uid())
         then g.address else null end as address,
    g.schedule_text, g.member_count, g.church_id, g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
     where gm.group_id=g.id and gm.profile_id=auth.uid()) as my_role,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=auth.uid()) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=auth.uid()
             and gi.status='pending') as has_pending_invite,
    g.website_url
  from public.groups g
  where g.id = p_group;
$$;

-- ── update_group: accept website_url ─────────────────────────────────────

create or replace function public.update_group(
  p_group         uuid,
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_website_url   text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can edit this group';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  update public.groups set
    name          = btrim(p_name),
    description   = nullif(btrim(coalesce(p_description,'')),''),
    city          = nullif(btrim(coalesce(p_city,'')),''),
    state         = nullif(btrim(coalesce(p_state,'')),''),
    schedule_text = nullif(btrim(coalesce(p_schedule_text,'')),''),
    website_url   = nullif(btrim(coalesce(p_website_url,'')),''),
    location      = case when p_lat is not null and p_lng is not null
                         then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
                         else location end
  where id = p_group;
end;
$$;


-- =============================================================================
-- Migration: 0073_groups_feed_with_coords.sql
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────
-- 0073 · my_groups_feed: expose lat/lng for client-side radius filtering
--        my_location: helper that returns the calling user's coordinates
-- ─────────────────────────────────────────────────────────────────────────

-- ── my_groups_feed: add lat + lng ────────────────────────────────────────
drop function if exists public.my_groups_feed();

create or replace function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean,
  has_pending_invite  boolean,
  lat                 double precision,
  lng                 double precision
)
language sql stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=(select id from me)) as is_member,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=(select id from me)) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=(select id from me)
             and gi.status='pending') as has_pending_invite,
    ST_Y(g.location::geometry) as lat,
    ST_X(g.location::geometry) as lng
  from public.groups g
  where g.is_public
     or exists(select 1 from public.group_members gm
               where gm.group_id=g.id and gm.profile_id=(select id from me))
     or exists(select 1 from public.group_invites gi
               where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
  order by
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=(select id from me))
         then 0
         when exists(select 1 from public.group_invites gi
                     where gi.group_id=g.id and gi.invitee_id=(select id from me) and gi.status='pending')
         then 1
         else 2 end,
    g.member_count desc,
    g.created_at desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;

-- ── my_location: returns the caller's lat/lng from their profile ──────────

create or replace function public.my_location()
returns table (lat double precision, lng double precision)
language sql stable
security definer
set search_path = public
as $$
  select
    ST_Y(location::geometry) as lat,
    ST_X(location::geometry) as lng
  from public.profiles
  where id = auth.uid()
    and location is not null
  limit 1;
$$;

grant execute on function public.my_location() to authenticated;


-- =============================================================================
-- Migration: 0074_hometown_cities_scoring.sql
-- =============================================================================
-- =============================================================================
-- 0074_hometown_cities_scoring.sql
--
-- Fixes hometown scoring to use the hometown_cities TEXT[] array instead of
-- (only) the single hometown text field.
--
-- Problem: match_score() and get_score_breakdown() compare the hometown TEXT
-- field with exact string equality. This misses:
--   1. "Charleston, SC" vs "Charleston" → no match (same city, different format)
--   2. Cities 2 and 3 from the "From" section are never scored at all.
--
-- Fix: award the 10 hometown pts when ANY city in viewer's hometown_cities
-- overlaps with ANY city in candidate's hometown_cities, after normalizing
-- (lowercase, strip trailing ", ST" state abbreviation). Also keep the old
-- hometown TEXT fallback for users who have that field but not the array.
-- =============================================================================


-- ── Helper: normalize a city string for comparison ───────────────────────
-- Strips ", XX" state suffix, lowercases, trims whitespace.
-- e.g. "Charleston, SC" → "charleston",  "charleston" → "charleston"

create or replace function public.normalize_city(raw text)
returns text language sql immutable as $$
  select lower(trim(regexp_replace(coalesce(raw,''), ',\s*[A-Za-z]{2}$', '')));
$$;


-- ── match_score: use hometown_cities array overlap ────────────────────────

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage         text;
  c_lifestage         text;
  v_hometown          text;
  c_hometown          text;
  v_hometown_cities   text[];
  c_hometown_cities   text[];
  v_political         integer;
  c_political         integer;
  shared_acts         int;
  total_acts          int;
  shared_goals        int;
  total_goals         int;
  shared_vals         int;
  total_vals          int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score          int := 0;
  hometown_match boolean := false;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, hometown_cities, political_lean
    into v_lifestage, v_hometown, v_hometown_cities, v_political
    from public.profiles where id = viewer;

  select life_stage_id, hometown, hometown_cities, political_lean
    into c_lifestage, c_hometown, c_hometown_cities, c_political
    from public.profiles where id = candidate;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life stage (20 exact | 8 parent-tier partial) ─────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 8;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  -- Primary check: hometown_cities array overlap (normalized, any of the 3 cities)
  if v_hometown_cities is not null and c_hometown_cities is not null then
    select true into hometown_match
    from unnest(v_hometown_cities) vc
    where public.normalize_city(vc) != ''
      and exists (
        select 1 from unnest(c_hometown_cities) cc
        where public.normalize_city(cc) != ''
          and public.normalize_city(vc) = public.normalize_city(cc)
      )
    limit 1;
  end if;
  -- Fallback: legacy hometown text field (covers older profiles)
  if not coalesce(hometown_match, false)
     and v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and public.normalize_city(v_hometown) = public.normalize_city(c_hometown) then
    hometown_match := true;
  end if;
  if coalesce(hometown_match, false) then
    score := score + 10;
  end if;

  -- ── Political lean alignment (+0–10, optional) ───────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  return greatest(0, least(100, score));
end $$;


-- ── get_score_breakdown: same fix ────────────────────────────────────────

create or replace function public.get_score_breakdown(p_viewer uuid, p_candidate uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_lifestage         text;
  c_lifestage         text;
  v_hometown          text;
  c_hometown          text;
  v_hometown_cities   text[];
  c_hometown_cities   text[];
  v_political         integer;
  c_political         integer;

  shared_acts   int := 0;
  total_acts    int := 0;
  shared_goals  int := 0;
  total_goals   int := 0;
  shared_vals   int := 0;
  total_vals    int := 0;

  interests_pts  int := 0;
  goals_pts      int := 0;
  stage_pts      int := 0;
  values_pts     int := 0;
  hometown_pts   int := 0;
  political_pts  int := 0;
  political_diff numeric := 0;
  hometown_match boolean := false;

  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
begin
  select life_stage_id, hometown, hometown_cities, political_lean
    into v_lifestage, v_hometown, v_hometown_cities, v_political
    from public.profiles where id = p_viewer;

  select life_stage_id, hometown, hometown_cities, political_lean
    into c_lifestage, c_hometown, c_hometown_cities, c_political
    from public.profiles where id = p_candidate;

  -- ── Interests (Jaccard × 30) ───────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = p_viewer and pa2.profile_id = p_candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (p_viewer, p_candidate);
  if total_acts > 0 then
    interests_pts := (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = p_viewer and pg2.profile_id = p_candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (p_viewer, p_candidate);
  if total_goals > 0 then
    goals_pts := (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life Stage (20 exact | 8 both-parents) ────────────────────────────────
  if v_lifestage is not null and c_lifestage is not null then
    if v_lifestage = c_lifestage then
      stage_pts := 20;
    elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
      stage_pts := 8;
    end if;
  end if;

  -- ── Family Values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = p_viewer and pv2.profile_id = p_candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (p_viewer, p_candidate);
  if total_vals > 0 then
    values_pts := (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown bonus (10 pts) ───────────────────────────────────────────────
  if v_hometown_cities is not null and c_hometown_cities is not null then
    select true into hometown_match
    from unnest(v_hometown_cities) vc
    where public.normalize_city(vc) != ''
      and exists (
        select 1 from unnest(c_hometown_cities) cc
        where public.normalize_city(cc) != ''
          and public.normalize_city(vc) = public.normalize_city(cc)
      )
    limit 1;
  end if;
  if not coalesce(hometown_match, false)
     and v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and public.normalize_city(v_hometown) = public.normalize_city(c_hometown) then
    hometown_match := true;
  end if;
  if coalesce(hometown_match, false) then
    hometown_pts := 10;
  end if;

  -- ── Political lean (0-10 pts, only when both set) ─────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    political_pts  := greatest(0, (10 * (1 - political_diff / 200.0))::int);
  end if;

  return jsonb_build_object(
    'interests',  jsonb_build_object(
                    'pts', interests_pts, 'max', 30,
                    'shared', shared_acts, 'total', total_acts),
    'goals',      jsonb_build_object(
                    'pts', goals_pts, 'max', 25,
                    'shared', shared_goals, 'total', total_goals),
    'life_stage', jsonb_build_object('pts', stage_pts, 'max', 20),
    'values',     jsonb_build_object(
                    'pts', values_pts, 'max', 15,
                    'shared', shared_vals, 'total', total_vals),
    'hometown',   jsonb_build_object('pts', hometown_pts, 'max', 10),
    'political',  jsonb_build_object('pts', political_pts, 'max', 10)
  );
end;
$$;

grant execute on function public.get_score_breakdown(uuid, uuid) to authenticated;

-- =============================================================================
-- VERIFY (run in Supabase SQL editor after applying):
--   select public.normalize_city('Charleston, SC');   -- → 'charleston'
--   select public.normalize_city('Charleston');       -- → 'charleston'
--   select public.match_score('<viewer_uuid>', '<candidate_uuid>');
-- =============================================================================


-- =============================================================================
-- Migration: 0075_normalize_city_international.sql
-- =============================================================================
-- =============================================================================
-- 0075_normalize_city_international.sql
--
-- Updates normalize_city() to strip everything after the last comma, not just
-- 2-letter state codes. This means "Lima, Peru", "Lima, IN", "Lima" all
-- normalize to "lima" and correctly match each other.
--
-- Old:  regexp_replace(raw, ',\s*[A-Za-z]{2}$', '')   ← only strips ", XX"
-- New:  regexp_replace(raw, ',.*$', '')                ← strips ", anything"
-- =============================================================================

create or replace function public.normalize_city(raw text)
returns text language sql immutable as $$
  select lower(trim(regexp_replace(coalesce(raw, ''), ',.*$', '')));
$$;

-- =============================================================================
-- VERIFY:
--   select public.normalize_city('Lima, Peru');    -- → 'lima'
--   select public.normalize_city('Lima, IN');      -- → 'lima'
--   select public.normalize_city('Lima');          -- → 'lima'
--   select public.normalize_city('Charleston, SC'); -- → 'charleston'
-- =============================================================================


-- =============================================================================
-- Migration: 0076_fix_gm_status.sql
-- =============================================================================
-- =============================================================================
-- 0076_fix_gm_status.sql
--
-- Fix: "column gm.status does not exist"
--
-- group_members has no status column — every row IS an active member.
-- Migrations 0070 and 0071 both referenced gm.status = 'active' which
-- crashes create_event() for group-linked events.
--
-- Fix: drop that filter. Remove the status check entirely.
-- =============================================================================

-- Drop current signature (added in 0071 with p_recurrence)
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title         text,
  p_event_time    timestamptz,
  p_location_name text             DEFAULT NULL,
  p_location_lat  double precision DEFAULT NULL,
  p_location_lng  double precision DEFAULT NULL,
  p_description   text             DEFAULT NULL,
  p_invitee_ids   uuid[]           DEFAULT NULL,
  p_group_id      uuid             DEFAULT NULL,
  p_recurrence    text             DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id,
    CASE WHEN p_recurrence IN ('weekly','biweekly','monthly') THEN p_recurrence ELSE NULL END
  )
  RETURNING id INTO v_event_id;

  -- Auto-invite all group members (except creator) when group_id is provided.
  -- NOTE: group_members has no status column — all rows are active members.
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
    ON CONFLICT DO NOTHING;

  ELSIF p_invitee_ids IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, UNNEST(p_invitee_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text) TO authenticated;

-- =============================================================================
-- DONE.
-- Verify by creating a group event — error should be gone.
-- =============================================================================


-- =============================================================================
-- Migration: 0077_score_weights_v2.sql
-- =============================================================================
-- =============================================================================
-- 0077_score_weights_v2.sql
--
-- Sam's weight update (2026-06-06):
--   Life Stage → 25 (exact) / 10 (parent-tier partial)   ← was 50/20
--   Values     → 20 (Jaccard × 20)                        ← was 10
--   Goals      → 15 (Jaccard × 15)                        ← unchanged
--   Activities → 30 (Jaccard × 30)                        ← was 20
--   Denomination → 8 exact bonus                          ← unchanged
--   Hometown     → 8 exact bonus                          ← unchanged
--   School type  → 7 (parents only)                       ← unchanged
--   Political    → 0–10 gradient                          ← unchanged
--   ──────────────────────────────────────────────────────
--   Max raw: 25+30+15+20+8+8+7+10 = 123, clamped to 100
--
-- Also updates get_score_breakdown() to match so UI display stays in sync.
--
-- Run AFTER 0076.
-- =============================================================================

-- ── 1. match_score() ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_score(viewer uuid, candidate uuid)
RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lifestage    text;
  c_lifestage    text;
  v_hometown     text;
  c_hometown     text;
  v_political    integer;
  c_political    integer;
  v_denom        text;
  c_denom        text;
  v_school       text;
  c_school       text;
  shared_acts    int;
  total_acts     int;
  shared_goals   int;
  total_goals    int;
  shared_vals    int;
  total_vals     int;
  parent_stages  text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score          int := 0;
BEGIN
  IF viewer = candidate THEN RETURN 100; END IF;

  SELECT life_stage_id, hometown, political_lean, denomination_id, school_type_id
    INTO v_lifestage, v_hometown, v_political, v_denom, v_school
    FROM public.profiles WHERE id = viewer;

  SELECT life_stage_id, hometown, political_lean, denomination_id, school_type_id
    INTO c_lifestage, c_hometown, c_political, c_denom, c_school
    FROM public.profiles WHERE id = candidate;

  -- ── Life stage (25 exact | 10 parent-tier partial) ────────────────────────
  IF v_lifestage IS NOT NULL AND v_lifestage = c_lifestage THEN
    score := score + 25;
  ELSIF v_lifestage = ANY(parent_stages) AND c_lifestage = ANY(parent_stages) THEN
    score := score + 10;
  END IF;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  SELECT count(*) INTO shared_acts
    FROM public.profile_activities pa1
    JOIN public.profile_activities pa2 ON pa1.activity_id = pa2.activity_id
    WHERE pa1.profile_id = viewer AND pa2.profile_id = candidate;
  SELECT count(DISTINCT activity_id) INTO total_acts
    FROM public.profile_activities
    WHERE profile_id IN (viewer, candidate);
  IF total_acts > 0 THEN
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  END IF;

  -- ── Goals (Jaccard × 15) ──────────────────────────────────────────────────
  SELECT count(*) INTO shared_goals
    FROM public.profile_goals pg1
    JOIN public.profile_goals pg2 ON pg1.goal_id = pg2.goal_id
    WHERE pg1.profile_id = viewer AND pg2.profile_id = candidate;
  SELECT count(DISTINCT goal_id) INTO total_goals
    FROM public.profile_goals
    WHERE profile_id IN (viewer, candidate);
  IF total_goals > 0 THEN
    score := score + (shared_goals::numeric / total_goals * 15)::int;
  END IF;

  -- ── Family values (Jaccard × 20) ──────────────────────────────────────────
  SELECT count(*) INTO shared_vals
    FROM public.profile_values pv1
    JOIN public.profile_values pv2 ON pv1.value_id = pv2.value_id
    WHERE pv1.profile_id = viewer AND pv2.profile_id = candidate;
  SELECT count(DISTINCT value_id) INTO total_vals
    FROM public.profile_values
    WHERE profile_id IN (viewer, candidate);
  IF total_vals > 0 THEN
    score := score + (shared_vals::numeric / total_vals * 20)::int;
  END IF;

  -- ── Denomination exact match (+8, optional) ───────────────────────────────
  IF v_denom IS NOT NULL AND c_denom IS NOT NULL AND v_denom = c_denom THEN
    score := score + 8;
  END IF;

  -- ── Hometown (+8) ─────────────────────────────────────────────────────────
  IF v_hometown IS NOT NULL AND c_hometown IS NOT NULL
     AND length(btrim(v_hometown)) > 0
     AND lower(btrim(v_hometown)) = lower(btrim(c_hometown)) THEN
    score := score + 8;
  END IF;

  -- ── School type (+7, parents only) ───────────────────────────────────────
  IF v_lifestage = ANY(parent_stages) AND c_lifestage = ANY(parent_stages)
     AND v_school IS NOT NULL AND c_school IS NOT NULL
     AND v_school = c_school THEN
    score := score + 7;
  END IF;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  IF v_political IS NOT NULL AND c_political IS NOT NULL THEN
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  END IF;

  RETURN greatest(0, least(100, score));
END $$;

-- ── 2. get_score_breakdown() — UI display, must match match_score() ───────────
CREATE OR REPLACE FUNCTION public.get_score_breakdown(p_viewer uuid, p_candidate uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;

  shared_acts   int := 0;
  total_acts    int := 0;
  shared_goals  int := 0;
  total_goals   int := 0;
  shared_vals   int := 0;
  total_vals    int := 0;

  interests_pts  int := 0;
  goals_pts      int := 0;
  stage_pts      int := 0;
  values_pts     int := 0;
  hometown_pts   int := 0;
  political_pts  int := 0;
  political_diff numeric := 0;

  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
BEGIN
  SELECT life_stage_id, hometown, political_lean
    INTO v_lifestage, v_hometown, v_political
    FROM public.profiles WHERE id = p_viewer;

  SELECT life_stage_id, hometown, political_lean
    INTO c_lifestage, c_hometown, c_political
    FROM public.profiles WHERE id = p_candidate;

  -- ── Interests (Jaccard × 30) ───────────────────────────────────────────────
  SELECT count(*) INTO shared_acts
    FROM public.profile_activities pa1
    JOIN public.profile_activities pa2 ON pa1.activity_id = pa2.activity_id
    WHERE pa1.profile_id = p_viewer AND pa2.profile_id = p_candidate;
  SELECT count(DISTINCT activity_id) INTO total_acts
    FROM public.profile_activities
    WHERE profile_id IN (p_viewer, p_candidate);
  IF total_acts > 0 THEN
    interests_pts := (shared_acts::numeric / total_acts * 30)::int;
  END IF;

  -- ── Goals (Jaccard × 15) ──────────────────────────────────────────────────
  SELECT count(*) INTO shared_goals
    FROM public.profile_goals pg1
    JOIN public.profile_goals pg2 ON pg1.goal_id = pg2.goal_id
    WHERE pg1.profile_id = p_viewer AND pg2.profile_id = p_candidate;
  SELECT count(DISTINCT goal_id) INTO total_goals
    FROM public.profile_goals
    WHERE profile_id IN (p_viewer, p_candidate);
  IF total_goals > 0 THEN
    goals_pts := (shared_goals::numeric / total_goals * 15)::int;
  END IF;

  -- ── Life Stage (25 exact | 10 both-parents) ───────────────────────────────
  IF v_lifestage IS NOT NULL AND c_lifestage IS NOT NULL THEN
    IF v_lifestage = c_lifestage THEN
      stage_pts := 25;
    ELSIF v_lifestage = ANY(parent_stages) AND c_lifestage = ANY(parent_stages) THEN
      stage_pts := 10;
    END IF;
  END IF;

  -- ── Family Values (Jaccard × 20) ──────────────────────────────────────────
  SELECT count(*) INTO shared_vals
    FROM public.profile_values pv1
    JOIN public.profile_values pv2 ON pv1.value_id = pv2.value_id
    WHERE pv1.profile_id = p_viewer AND pv2.profile_id = p_candidate;
  SELECT count(DISTINCT value_id) INTO total_vals
    FROM public.profile_values
    WHERE profile_id IN (p_viewer, p_candidate);
  IF total_vals > 0 THEN
    values_pts := (shared_vals::numeric / total_vals * 20)::int;
  END IF;

  -- ── Hometown bonus (8 pts) ────────────────────────────────────────────────
  IF v_hometown IS NOT NULL AND c_hometown IS NOT NULL
     AND lower(trim(v_hometown)) = lower(trim(c_hometown)) THEN
    hometown_pts := 8;
  END IF;

  -- ── Political lean (0–10 pts) ─────────────────────────────────────────────
  IF v_political IS NOT NULL AND c_political IS NOT NULL THEN
    political_diff := abs(v_political - c_political);
    political_pts  := greatest(0, (10 * (1 - political_diff / 200.0))::int);
  END IF;

  RETURN jsonb_build_object(
    'interests',  jsonb_build_object(
                    'pts', interests_pts, 'max', 30,
                    'shared', shared_acts, 'total', total_acts),
    'goals',      jsonb_build_object(
                    'pts', goals_pts, 'max', 15,
                    'shared', shared_goals, 'total', total_goals),
    'life_stage', jsonb_build_object('pts', stage_pts, 'max', 25),
    'values',     jsonb_build_object(
                    'pts', values_pts, 'max', 20,
                    'shared', shared_vals, 'total', total_vals),
    'hometown',   jsonb_build_object('pts', hometown_pts, 'max', 8),
    'political',  jsonb_build_object('pts', political_pts, 'max', 10)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_score_breakdown(uuid, uuid) TO authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select public.match_score('<uuid_a>', '<uuid_b>');
--   select get_score_breakdown('<viewer>', '<candidate>');
-- =============================================================================


-- =============================================================================
-- Migration: 0078_filming_editing_and_church_connections.sql
-- =============================================================================
-- =============================================================================
-- 0078_filming_editing_and_church_connections.sql
--
-- 1) Add "Filming & Editing" to the activities taxonomy.
-- 2) Update my_connections() to return church_id + church_name so the
--    FOUND tab can filter connections by "My Church".
--
-- Run after 0077.
-- =============================================================================

-- ── 1. New activity ──────────────────────────────────────────────────────────

insert into public.activities (id, label, icon, icon_color, sort_order)
values ('filming-editing', 'Filming & Editing', 'videocam-outline', '#1A1A1A', 125)
on conflict (id) do update
  set label      = excluded.label,
      icon       = excluded.icon,
      icon_color = excluded.icon_color,
      sort_order = excluded.sort_order;


-- ── 2. my_connections() — add church_id + church_name ────────────────────────

drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz,
  pinned_at         timestamptz,
  score             int,
  activities        jsonb,
  church_id         uuid,
  church_name       text
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at,
      c1.pinned_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at,
    m.pinned_at,
    public.match_score((select id from me), p.id) as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                 as activities,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end     as church_name
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  order by m.pinned_at desc nulls last, m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select id, label from activities where id = 'filming-editing';
--   select church_id, church_name from my_connections() limit 5;
-- =============================================================================


-- =============================================================================
-- Migration: 0079_monthly_nth_recurrence.sql
-- =============================================================================
-- =============================================================================
-- 0079_monthly_nth_recurrence.sql
--
-- Adds "nth weekday of month" recurrence pattern.
--
-- Examples: "1st & 3rd Wednesday", "2nd & 4th Sunday"
--
-- Changes:
--   1. Add recurrence_rule jsonb column to events
--   2. Expand recurrence CHECK constraint to include 'monthly_nth'
--   3. Recreate create_event() to accept + store p_recurrence_rule
-- =============================================================================

-- ── 1. Add recurrence_rule column ────────────────────────────────────────────
-- Format: {"weekday": 3, "weeks": [1, 3]}
--   weekday: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
--   weeks:   array of week ordinals [1–4], e.g. [1,3] = 1st & 3rd

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;

-- ── 2. Expand CHECK constraint to allow 'monthly_nth' ────────────────────────
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_recurrence_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_recurrence_check
  CHECK (recurrence IN ('weekly', 'biweekly', 'monthly', 'monthly_nth'));

-- ── 3. Recreate create_event with p_recurrence_rule ──────────────────────────
-- Drop the previous signature (0076 version)
DROP FUNCTION IF EXISTS public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text);

CREATE OR REPLACE FUNCTION public.create_event(
  p_title           text,
  p_event_time      timestamptz,
  p_location_name   text             DEFAULT NULL,
  p_location_lat    double precision DEFAULT NULL,
  p_location_lng    double precision DEFAULT NULL,
  p_description     text             DEFAULT NULL,
  p_invitee_ids     uuid[]           DEFAULT NULL,
  p_group_id        uuid             DEFAULT NULL,
  p_recurrence      text             DEFAULT NULL,
  p_recurrence_rule jsonb            DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id    uuid;
  v_recurrence  text;
BEGIN
  -- Validate recurrence value; 'monthly_nth' requires a rule
  v_recurrence := CASE
    WHEN p_recurrence IN ('weekly','biweekly','monthly') THEN p_recurrence
    WHEN p_recurrence = 'monthly_nth' AND p_recurrence_rule IS NOT NULL THEN 'monthly_nth'
    ELSE NULL
  END;

  INSERT INTO public.events (
    creator_id, title, event_time,
    location_name, location_lat, location_lng,
    description, group_id, recurrence, recurrence_rule
  )
  VALUES (
    auth.uid(), p_title, p_event_time,
    p_location_name, p_location_lat, p_location_lng,
    p_description, p_group_id, v_recurrence,
    CASE WHEN v_recurrence = 'monthly_nth' THEN p_recurrence_rule ELSE NULL END
  )
  RETURNING id INTO v_event_id;

  -- Auto-invite all group members (except creator) when group_id is provided.
  IF p_group_id IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, gm.profile_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.profile_id <> auth.uid()
    ON CONFLICT DO NOTHING;

  ELSIF p_invitee_ids IS NOT NULL THEN
    INSERT INTO public.event_invites (event_id, invitee_id)
    SELECT v_event_id, UNNEST(p_invitee_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_event(text, timestamptz, text, double precision, double precision, text, uuid[], uuid, text, jsonb) TO authenticated;

-- =============================================================================
-- DONE.
-- Verify: create an event with recurrence='monthly_nth' and
-- recurrence_rule='{"weekday":3,"weeks":[1,3]}' — should save cleanly.
-- =============================================================================


-- =============================================================================
-- Migration: 0080_connection_bump_email.sql
-- =============================================================================
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
  select replace(
    replace(
      $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
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
        Hey RECIPIENT_TOKEN, someone wants to connect.
      </h1>
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#4b4b4b;margin:0 0 20px">
        <strong style="color:#111">SENDER_TOKEN</strong> sent you a connection request on FOUND.
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
        You are receiving this because someone on FOUND sent you a connection request.
      </p>
      <p style="font:400 12px/1.6 Arial;color:#a3a3a3;margin:8px 0 0">
        FOUND &middot; found.community &middot;
        <a href="mailto:hello@found.community" style="color:#a3a3a3;text-decoration:none">hello@found.community</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>$html$,
      'SENDER_TOKEN', coalesce(nullif(trim(p_sender_name), ''), 'Someone')
    ),
    'RECIPIENT_TOKEN', coalesce(nullif(trim(p_recipient_name), ''), 'there')
  );
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


-- =============================================================================
-- Migration: 0081_fix_update_profile_missing_params.sql
-- =============================================================================
-- =============================================================================
-- 0081_fix_update_profile_missing_params.sql
--
-- Problem: migration 0067 rewrote update_profile but dropped 4 params that
-- EditProfileScreen.js still sends:
--   - p_is_initiator  (boolean)
--   - p_is_outgoing   (boolean)
--   - p_school_type   (text)
--   - p_values        (text[])
--
-- Postgres resolves RPCs by named-param signature, so the call failed with
-- "could not find the function public.update_profile(...)" for all saves.
--
-- Fix: drop the 13-param overload, replace with complete 17-param version.
-- =============================================================================

DROP FUNCTION IF EXISTS public.update_profile(text,text,text,text,text,text,uuid,text,text[],text[],text[],boolean,integer);

CREATE OR REPLACE FUNCTION public.update_profile(
  p_full_name            text     DEFAULT NULL,
  p_bio                  text     DEFAULT NULL,
  p_hometown             text     DEFAULT NULL,
  p_city                 text     DEFAULT NULL,
  p_state                text     DEFAULT NULL,
  p_life_stage           text     DEFAULT NULL,
  p_church_id            uuid     DEFAULT NULL,
  p_love_language        text     DEFAULT NULL,
  p_school_type          text     DEFAULT NULL,
  p_is_initiator         boolean  DEFAULT NULL,
  p_is_outgoing          boolean  DEFAULT NULL,
  p_activities           text[]   DEFAULT NULL,
  p_goals                text[]   DEFAULT NULL,
  p_values               text[]   DEFAULT NULL,
  p_hometown_cities      text[]   DEFAULT NULL,
  p_looking_for_church   boolean  DEFAULT NULL,
  p_political_lean       integer  DEFAULT -999
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles SET
    -- Non-clearable: keep existing if null/empty
    full_name          = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
    life_stage_id      = COALESCE(p_life_stage,    life_stage_id),
    church_id          = COALESCE(p_church_id,     church_id),
    love_language_id   = COALESCE(p_love_language, love_language_id),
    school_type_id     = COALESCE(p_school_type,   school_type_id),
    is_initiator       = COALESCE(p_is_initiator,  is_initiator),
    is_outgoing        = COALESCE(p_is_outgoing,   is_outgoing),

    -- Clearable text: direct assign (null clears the field)
    bio                = p_bio,
    hometown           = p_hometown,
    city               = p_city,
    state              = p_state,

    -- Arrays: null = don't touch
    hometown_cities    = CASE WHEN p_hometown_cities IS NOT NULL THEN p_hometown_cities ELSE hometown_cities END,

    -- Boolean: null = don't touch
    looking_for_church = CASE WHEN p_looking_for_church IS NOT NULL THEN p_looking_for_church ELSE looking_for_church END,

    -- political_lean: sentinel -999 = not passed (keep existing)
    political_lean     = CASE WHEN p_political_lean = -999 THEN political_lean ELSE p_political_lean END,

    last_active_at     = now()
  WHERE id = v_uid;

  -- Activities: non-null = replace
  IF p_activities IS NOT NULL THEN
    DELETE FROM public.profile_activities WHERE profile_id = v_uid;
    IF array_length(p_activities, 1) IS NOT NULL THEN
      INSERT INTO public.profile_activities (profile_id, activity_id)
      SELECT v_uid, unnest(p_activities)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Goals: non-null = replace
  IF p_goals IS NOT NULL THEN
    DELETE FROM public.profile_goals WHERE profile_id = v_uid;
    IF array_length(p_goals, 1) IS NOT NULL THEN
      INSERT INTO public.profile_goals (profile_id, goal_id)
      SELECT v_uid, unnest(p_goals)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Values: non-null = replace
  IF p_values IS NOT NULL THEN
    DELETE FROM public.profile_values WHERE profile_id = v_uid;
    IF array_length(p_values, 1) IS NOT NULL THEN
      INSERT INTO public.profile_values (profile_id, value_id)
      SELECT v_uid, unnest(p_values)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_profile(
  text,text,text,text,text,text,uuid,text,text,boolean,boolean,text[],text[],text[],text[],boolean,integer
) TO authenticated;


-- =============================================================================
-- Migration: 0082_highlight_reel_3_and_edit_group_post.sql
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────
-- 0082: Highlight reel cap 3 + editable group posts
--
-- 1. Trim every user's highlight reel to at most 3 photos.
--    Keeps the 3 with the lowest sort_order (i.e. the "first" ones).
--    Deletes rows beyond that — storage objects will 404 but won't break
--    the app; clean up storage manually or via a one-time script if needed.
--
-- 2. update_group_post RPC — lets the author edit the body of their post.
--    Admins/owners cannot edit others' posts (only delete them).
--
-- 3. Rebuild group_posts_feed to include can_edit flag.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Trim existing highlight reels to 3 ─────────────────────────────────
delete from public.photos
where owner_kind = 'profile'
  and id not in (
    select id
    from (
      select id,
             row_number() over (
               partition by owner_id
               order by sort_order asc, created_at asc
             ) as rn
      from public.photos
      where owner_kind = 'profile'
    ) ranked
    where rn <= 3
  );

-- ── 2. update_group_post RPC ───────────────────────────────────────────────
-- Only the original author may edit. Body must be non-empty text.
create or replace function public.update_group_post(
  p_post uuid,
  p_body text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author
  from public.group_posts
  where id = p_post;

  if v_author is null then
    raise exception 'Post not found';
  end if;

  if v_author <> auth.uid() then
    raise exception 'Only the author can edit this post';
  end if;

  if trim(p_body) = '' then
    raise exception 'Post body cannot be empty';
  end if;

  update public.group_posts
  set body       = trim(p_body),
      updated_at = now()
  where id = p_post;
end;
$$;

grant execute on function public.update_group_post(uuid, text) to authenticated;

-- Add updated_at column if it doesn't already exist (safe no-op if it does)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'group_posts'
      and column_name  = 'updated_at'
  ) then
    alter table public.group_posts add column updated_at timestamptz;
  end if;
end $$;

-- ── 3. Rebuild group_posts_feed with can_edit ──────────────────────────────
-- Must DROP first — adding columns to the return type isn't allowed with CREATE OR REPLACE
drop function if exists public.group_posts_feed(uuid);

create or replace function public.group_posts_feed(p_group uuid)
returns table (
  id            uuid,
  group_id      uuid,
  author_id     uuid,
  author_name   text,
  author_handle text,
  author_avatar text,
  author_role   text,
  body          text,
  photo_url     text,
  created_at    timestamptz,
  updated_at    timestamptz,
  can_delete    boolean,
  can_edit      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gp.id,
    gp.group_id,
    gp.author_id,
    coalesce(pr.full_name, pr.handle, 'Member') as author_name,
    pr.handle                                   as author_handle,
    pr.avatar_url                               as author_avatar,
    gm.role                                     as author_role,
    gp.body,
    gp.photo_url,
    gp.created_at,
    gp.updated_at,
    (gp.author_id = auth.uid() or public.is_group_admin(p_group)) as can_delete,
    (gp.author_id = auth.uid())                                    as can_edit
  from public.group_posts gp
  join public.profiles pr on pr.id = gp.author_id
  left join public.group_members gm
    on gm.group_id = gp.group_id and gm.profile_id = gp.author_id
  where gp.group_id = p_group
  order by gp.created_at desc;
$$;

grant execute on function public.group_posts_feed(uuid) to authenticated;

