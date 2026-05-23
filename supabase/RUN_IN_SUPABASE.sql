-- #############################################################################
-- #  FOUND — RUN THIS ONCE IN THE SUPABASE SQL EDITOR                          #
-- #                                                                           #
-- #  Open Supabase  →  SQL Editor  →  New query  →  paste ALL of this  →  Run. #
-- #                                                                           #
-- #  This bundles four pending migrations into one atomic block:               #
-- #    0023  group meeting address                                            #
-- #    0024  group posts (activity feed) + photo storage bucket                #
-- #    0025  account settings columns (notifications / privacy / radius)       #
-- #    0026  wires privacy + discovery-radius settings into the live feed      #
-- #                                                                           #
-- #  Wrapped in BEGIN/COMMIT — if anything fails, NOTHING is applied, so it's  #
-- #  safe to fix and re-run. Re-running the whole block is also safe.          #
-- #############################################################################

begin;



-- ===== 0023_group_address.sql =====

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


-- ===== 0024_group_posts.sql =====

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


-- ===== 0025_account_settings.sql =====

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


-- ===== 0026_privacy_discovery_wiring.sql =====

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


commit;
