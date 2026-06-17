-- =============================================================================
-- 0091_church_powerhouse.sql
--
-- Adds 7 new church dashboard power features:
--   1. church_prospect_pipeline  — unchurched people near the church
--   2. church_care_queue         — smarter at-risk: engaged but isolated
--   3. church_staff table        — staff directory shown in mobile app
--   4. churches.slug             — URL-friendly invite links
--   5. welcome_automation        — trigger DM when member joins church
--   6. suggest_group_for_member  — group matching engine
--   7. church_weekly_digest      — data bundle for weekly email
--
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DO blocks throughout.
-- Run AFTER 0090_skip_profile_for_church_admins.sql
-- =============================================================================


-- =============================================================================
-- 1. PROSPECT PIPELINE
--    Returns profiles near the church where looking_for_church = true,
--    ordered by distance. Radius defaults to 25 miles.
-- =============================================================================

create or replace function public.church_prospect_pipeline(
  p_church_id  uuid,
  p_radius_mi  float default 25
)
returns table (
  id               uuid,
  full_name        text,
  city             text,
  state            text,
  life_stage_id    text,
  looking_for_church boolean,
  joined_found_at  timestamptz,
  distance_mi      float
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_church_lat double precision;
  v_church_lng double precision;
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  -- Get church coordinates from profiles of members (use first member with
  -- a location, or fall back to city/state geocode via the churches table itself).
  -- We store church lat/lng via the first admin profile or a dedicated column.
  -- Use the church's city/state to derive a rough center if no PostGIS point exists.
  -- For now: pull from churches table if we have a location col, else use any
  -- member's location as the centroid.

  -- Try to get coords from any member profile at this church
  select ST_Y(location::geometry), ST_X(location::geometry)
  into   v_church_lat, v_church_lng
  from   public.profiles
  where  church_id = p_church_id
    and  location is not null
    and  onboarding_complete = true
  limit 1;

  -- If no member has coords, return all looking_for_church profiles (no geo filter)
  if v_church_lat is null then
    return query
      select
        p.id,
        p.full_name,
        p.city,
        p.state,
        p.life_stage_id,
        p.looking_for_church,
        p.created_at as joined_found_at,
        null::float   as distance_mi
      from public.profiles p
      where p.looking_for_church = true
        and p.onboarding_complete = true
        and p.church_id is null
      order by p.created_at desc
      limit 100;
    return;
  end if;

  -- With coords: filter by radius, order by proximity
  return query
    select
      p.id,
      p.full_name,
      p.city,
      p.state,
      p.life_stage_id,
      p.looking_for_church,
      p.created_at as joined_found_at,
      (ST_Distance(
        p.location,
        ST_SetSRID(ST_MakePoint(v_church_lng, v_church_lat), 4326)::geography
      ) / 1609.344)::float as distance_mi
    from public.profiles p
    where p.looking_for_church = true
      and p.onboarding_complete = true
      and p.church_id is null
      and p.location is not null
      and ST_DWithin(
        p.location,
        ST_SetSRID(ST_MakePoint(v_church_lng, v_church_lat), 4326)::geography,
        p_radius_mi * 1609.344
      )
    order by distance_mi asc
    limit 100;
end;
$$;

grant execute on function public.church_prospect_pipeline(uuid, float) to authenticated;


-- =============================================================================
-- 2. MEMBER CARE QUEUE
--    Smarter than "at_risk". Combines:
--      - Member of this church 60+ days
--      - Zero mutual connections
--      - Not in any group
--      - Still active (last_active_at within 30 days OR joined < 90 days ago)
--    Sorted by urgency score (days_on_found DESC — longer without community = more urgent).
-- =============================================================================

create or replace function public.church_care_queue(p_church_id uuid)
returns table (
  id               uuid,
  full_name        text,
  city             text,
  state            text,
  life_stage_id    text,
  days_on_found    int,
  connection_count int,
  in_a_group       boolean,
  urgency_score    int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.city,
      p.state,
      p.life_stage_id,
      extract(day from now() - p.created_at)::int as days_on_found,
      (
        select count(*)::int
        from public.connections c1
        join public.connections c2
          on c1.from_profile = c2.to_profile
         and c1.to_profile   = c2.from_profile
        where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
      ) as connection_count,
      exists (
        select 1 from public.group_members gm
        where gm.profile_id = p.id
      ) as in_a_group,
      -- urgency: more days without community = higher score
      extract(day from now() - p.created_at)::int as urgency_score
    from public.profiles p
    where
      p.church_id = p_church_id
      and p.onboarding_complete = true
      -- 60+ days as a member
      and p.created_at < now() - interval '60 days'
      -- no mutual connections
      and not exists (
        select 1 from public.connections c1
        join public.connections c2
          on c1.from_profile = c2.to_profile
         and c1.to_profile   = c2.from_profile
        where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
      )
      -- not in any group
      and not exists (
        select 1 from public.group_members gm where gm.profile_id = p.id
      )
      -- still active — joined recently enough OR profile updated recently
      and (
        p.created_at > now() - interval '90 days'
        or p.updated_at > now() - interval '30 days'
      )
    order by urgency_score desc
    limit 50;
end;
$$;

grant execute on function public.church_care_queue(uuid) to authenticated;


-- =============================================================================
-- 3. CHURCH STAFF TABLE
--    Staff members shown on the church's public profile in the mobile app.
-- =============================================================================

create table if not exists public.church_staff (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  name        text not null,
  title       text,
  bio         text,
  avatar_url  text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_church_staff_church on public.church_staff (church_id, sort_order);

alter table public.church_staff enable row level security;

-- Anyone can read staff (public profile in mobile app)
drop policy if exists "church_staff public read" on public.church_staff;
create policy "church_staff public read" on public.church_staff
  for select using (true);

-- Only church admins can write
drop policy if exists "church_staff admin write" on public.church_staff;
create policy "church_staff admin write" on public.church_staff
  for all using (public.is_church_admin(church_id));


-- RPC: list staff for a church (public, used by mobile app)
create or replace function public.church_staff_list(p_church_id uuid)
returns table (
  id         uuid,
  name       text,
  title      text,
  bio        text,
  avatar_url text,
  sort_order int
)
language sql stable security definer set search_path = public as $$
  select id, name, title, bio, avatar_url, sort_order
  from   public.church_staff
  where  church_id = p_church_id
  order  by sort_order, created_at;
$$;

grant execute on function public.church_staff_list(uuid) to authenticated, anon;


-- RPC: upsert a staff member (dashboard)
create or replace function public.upsert_church_staff(
  p_church_id  uuid,
  p_staff_id   uuid default null,   -- null = insert new
  p_name       text  default '',
  p_title      text  default null,
  p_bio        text  default null,
  p_avatar_url text  default null,
  p_sort_order int   default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(p_staff_id, gen_random_uuid());
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  insert into public.church_staff (id, church_id, name, title, bio, avatar_url, sort_order, updated_at)
  values (v_id, p_church_id, btrim(p_name),
          nullif(btrim(coalesce(p_title,'')), ''),
          nullif(btrim(coalesce(p_bio,'')),   ''),
          nullif(btrim(coalesce(p_avatar_url,'')), ''),
          p_sort_order, now())
  on conflict (id) do update set
    name       = excluded.name,
    title      = excluded.title,
    bio        = excluded.bio,
    avatar_url = excluded.avatar_url,
    sort_order = excluded.sort_order,
    updated_at = now();

  return v_id;
end;
$$;

grant execute on function public.upsert_church_staff(uuid,uuid,text,text,text,text,int) to authenticated;


-- RPC: delete a staff member
create or replace function public.delete_church_staff(p_church_id uuid, p_staff_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;
  delete from public.church_staff where id = p_staff_id and church_id = p_church_id;
end;
$$;

grant execute on function public.delete_church_staff(uuid, uuid) to authenticated;


-- =============================================================================
-- 4. CHURCH INVITE SLUG
--    Adds a url-friendly slug to churches so invite links work:
--    found.community/join/[slug]
-- =============================================================================

alter table public.churches
  add column if not exists slug text unique;

-- Generate slugs for any churches that don't have one yet.
-- Format: lowercase-name-city  e.g. "grace-community-denver"
do $$
declare
  rec record;
  base_slug text;
  final_slug text;
  counter   int;
begin
  for rec in
    select id, name, city from public.churches where slug is null
  loop
    base_slug := lower(
      regexp_replace(
        regexp_replace(
          coalesce(rec.name, '') || '-' || coalesce(rec.city, ''),
          '[^a-z0-9\s-]', '', 'gi'
        ),
        '\s+', '-', 'g'
      )
    );
    -- strip leading/trailing dashes
    base_slug := trim(both '-' from base_slug);
    if base_slug = '' or base_slug = '-' then
      base_slug := 'church-' || left(rec.id::text, 8);
    end if;

    final_slug := base_slug;
    counter    := 1;

    -- Ensure uniqueness
    while exists (select 1 from public.churches where slug = final_slug and id <> rec.id) loop
      final_slug := base_slug || '-' || counter;
      counter    := counter + 1;
    end loop;

    update public.churches set slug = final_slug where id = rec.id;
  end loop;
end;
$$;


-- RPC: get_church_by_slug — used by the /join/[slug] landing page
create or replace function public.get_church_by_slug(p_slug text)
returns table (
  id          uuid,
  name        text,
  city        text,
  state       text,
  description text,
  logo_url    text,
  website     text,
  denomination text,
  service_times jsonb
)
language sql stable security definer set search_path = public as $$
  select id, name, city, state, description, logo_url, website,
         denomination, service_times
  from   public.churches
  where  slug = lower(btrim(p_slug))
  limit 1;
$$;

grant execute on function public.get_church_by_slug(text) to authenticated, anon;


-- RPC: generate_church_slug — callable from dashboard to regenerate if needed
create or replace function public.get_my_church_slug()
returns text
language sql stable security definer set search_path = public as $$
  select c.slug
  from   public.churches c
  join   public.church_admins ca on ca.church_id = c.id
  where  ca.user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.get_my_church_slug() to authenticated;


-- =============================================================================
-- 5. WELCOME AUTOMATION
--    When a user links to a church (profiles.church_id changes from NULL → value),
--    insert a notification so the church admin can see it AND send a system
--    welcome message into the user's notification feed.
--
--    Note: We can't DM from the church admin account directly inside a trigger
--    (would need a known admin user_id), so we insert into notifications instead.
--    The dashboard shows these as "new member alerts" and lets the admin
--    click to send a personal welcome message.
-- =============================================================================

-- Track welcome messages sent so we don't duplicate
create table if not exists public.church_welcome_log (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references public.churches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  unique (church_id, profile_id)
);

create index if not exists idx_welcome_log_church on public.church_welcome_log (church_id);

alter table public.church_welcome_log enable row level security;

drop policy if exists "welcome_log admin read" on public.church_welcome_log;
create policy "welcome_log admin read" on public.church_welcome_log
  for select using (public.is_church_admin(church_id));


-- Trigger function: fires when profiles.church_id is set
create or replace function public.on_profile_church_set()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only fire when church_id changes from null → non-null
  if (old.church_id is not null) or (new.church_id is null) then
    return new;
  end if;

  -- Log it (idempotent)
  insert into public.church_welcome_log (church_id, profile_id)
  values (new.church_id, new.id)
  on conflict do nothing;

  -- Insert a welcome notification into the new member's feed
  -- type: 'church_welcome' — handled by the mobile app notification renderer
  insert into public.notifications (
    user_id, type, title, body, data
  ) values (
    new.id,
    'church_welcome',
    'Welcome to the family!',
    'Your church is on FOUND. Connect with members and find your people.',
    jsonb_build_object('church_id', new.church_id)
  )
  on conflict do nothing;

  return new;
end;
$$;

-- Drop + recreate trigger so this is safe to re-run
drop trigger if exists trg_profile_church_set on public.profiles;
create trigger trg_profile_church_set
  after update of church_id on public.profiles
  for each row
  execute function public.on_profile_church_set();


-- RPC: church_new_member_alerts — lets the dashboard see recent joins for manual welcome
create or replace function public.church_new_member_alerts(
  p_church_id uuid,
  p_days_back int default 14
)
returns table (
  profile_id      uuid,
  full_name       text,
  city            text,
  state           text,
  life_stage_id   text,
  joined_at       timestamptz,
  welcome_sent    boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.id as profile_id,
    p.full_name,
    p.city,
    p.state,
    p.life_stage_id,
    p.created_at as joined_at,
    exists (
      select 1 from public.church_welcome_log wl
      where wl.church_id = p_church_id and wl.profile_id = p.id
    ) as welcome_sent
  from public.profiles p
  where p.church_id = p_church_id
    and p.onboarding_complete = true
    and p.created_at >= now() - (p_days_back || ' days')::interval
  order by p.created_at desc;
$$;

grant execute on function public.church_new_member_alerts(uuid, int) to authenticated;


-- RPC: send_church_welcome — admin manually triggers a welcome notification
create or replace function public.send_church_welcome(
  p_church_id  uuid,
  p_profile_id uuid,
  p_message    text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_church_name text;
  v_body        text;
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  select name into v_church_name from public.churches where id = p_church_id;

  v_body := coalesce(
    p_message,
    v_church_name || ' wants to welcome you. Reach out to connect with other members!'
  );

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_profile_id,
    'church_welcome',
    'A message from ' || v_church_name,
    v_body,
    jsonb_build_object('church_id', p_church_id)
  );

  -- Mark as welcomed
  insert into public.church_welcome_log (church_id, profile_id)
  values (p_church_id, p_profile_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.send_church_welcome(uuid, uuid, text) to authenticated;


-- =============================================================================
-- 6. GROUP MATCHING ENGINE
--    Given a member profile, return ranked church groups they'd fit best.
--    Scoring:
--      - Life stage match        → +40 pts (groups.life_stage_focus = member life stage)
--      - City match              → +30 pts
--      - Member count (smaller)  → +20 pts (avoid sending everyone to same big group)
--      - State match fallback    → +10 pts
-- =============================================================================

-- Add life_stage_focus column to groups if not there yet
alter table public.groups
  add column if not exists life_stage_focus text;

create or replace function public.suggest_groups_for_member(
  p_church_id  uuid,
  p_profile_id uuid,
  p_limit      int default 3
)
returns table (
  group_id      uuid,
  group_name    text,
  description   text,
  schedule_text text,
  member_count  int,
  city          text,
  state         text,
  match_score   int,
  match_reason  text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_life_stage text;
  v_city       text;
  v_state      text;
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  select life_stage_id, city, state
  into   v_life_stage, v_city, v_state
  from   public.profiles
  where  id = p_profile_id;

  return query
    select
      g.id   as group_id,
      g.name as group_name,
      g.description,
      g.schedule_text,
      g.member_count,
      g.city,
      g.state,
      (
        -- life stage match
        case when g.life_stage_focus = v_life_stage then 40 else 0 end
        -- city match
        + case when lower(g.city) = lower(coalesce(v_city,'')) then 30 else 0 end
        -- prefer smaller groups (more intimacy); cap at 20
        + greatest(0, 20 - coalesce(g.member_count, 0))
        -- state fallback
        + case when upper(g.state) = upper(coalesce(v_state,'')) and lower(g.city) <> lower(coalesce(v_city,'')) then 10 else 0 end
      )::int as match_score,
      -- human-readable reason
      case
        when g.life_stage_focus = v_life_stage and lower(g.city) = lower(coalesce(v_city,''))
          then 'Same life stage · Same city'
        when g.life_stage_focus = v_life_stage
          then 'Same life stage'
        when lower(g.city) = lower(coalesce(v_city,''))
          then 'Same city'
        else 'Good fit'
      end as match_reason
    from public.groups g
    where g.church_id = p_church_id
      -- don't suggest groups they're already in
      and not exists (
        select 1 from public.group_members gm
        where gm.group_id = g.id and gm.profile_id = p_profile_id
      )
    order by match_score desc, g.member_count asc
    limit p_limit;
end;
$$;

grant execute on function public.suggest_groups_for_member(uuid, uuid, int) to authenticated;


-- =============================================================================
-- 7. WEEKLY DIGEST DATA BUNDLE
--    Returns all the data the Monday email needs in one RPC call.
--    The API route (Next.js or Edge Function) calls this and formats the email.
-- =============================================================================

create or replace function public.church_weekly_digest(p_church_id uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_new_members     int;
  v_new_groups      int;
  v_isolated_count  int;
  v_care_queue      int;
  v_total_members   int;
  v_connected       int;
  v_church_name     text;
  v_new_member_list json;
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  select name into v_church_name from public.churches where id = p_church_id;

  -- New members this week
  select count(*) into v_new_members
  from public.profiles
  where church_id = p_church_id
    and onboarding_complete = true
    and created_at >= now() - interval '7 days';

  -- Groups created this week
  select count(*) into v_new_groups
  from public.groups
  where church_id = p_church_id
    and created_at >= now() - interval '7 days';

  -- Total isolated
  select count(*) into v_isolated_count
  from public.profiles p
  where p.church_id = p_church_id
    and p.onboarding_complete = true
    and not exists (
      select 1 from public.connections c1
      join public.connections c2
        on c1.from_profile = c2.to_profile and c1.to_profile = c2.from_profile
      where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
    );

  -- Care queue size
  select count(*) into v_care_queue
  from (select public.church_care_queue(p_church_id)) cq;

  -- Total + connected
  select count(*) into v_total_members
  from public.profiles
  where church_id = p_church_id and onboarding_complete = true;

  select count(distinct p.id) into v_connected
  from public.profiles p
  where p.church_id = p_church_id
    and p.onboarding_complete = true
    and exists (
      select 1 from public.connections c1
      join public.connections c2
        on c1.from_profile = c2.to_profile and c1.to_profile = c2.from_profile
      where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
    );

  -- New members list (names only, for the email)
  select json_agg(json_build_object(
    'name', full_name,
    'city', city,
    'state', state,
    'life_stage', life_stage_id
  ) order by created_at desc)
  into v_new_member_list
  from public.profiles
  where church_id = p_church_id
    and onboarding_complete = true
    and created_at >= now() - interval '7 days';

  return json_build_object(
    'church_name',     v_church_name,
    'church_id',       p_church_id,
    'week_ending',     now()::date,
    'total_members',   v_total_members,
    'connected',       v_connected,
    'isolated',        v_isolated_count,
    'care_queue',      v_care_queue,
    'new_this_week',   v_new_members,
    'new_groups',      v_new_groups,
    'new_member_list', coalesce(v_new_member_list, '[]'::json)
  );
end;
$$;

grant execute on function public.church_weekly_digest(uuid) to authenticated;


-- =============================================================================
-- WEEKLY DIGEST SUBSCRIPTION TABLE
-- Tracks which church admins have opted into the Monday digest email.
-- =============================================================================

create table if not exists public.church_digest_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (church_id, user_id)
);

alter table public.church_digest_subscriptions enable row level security;

drop policy if exists "digest_sub own" on public.church_digest_subscriptions;
create policy "digest_sub own" on public.church_digest_subscriptions
  for all using (user_id = auth.uid());

grant execute on function public.church_weekly_digest(uuid) to authenticated;


-- RPC: toggle digest subscription
create or replace function public.set_digest_subscription(
  p_church_id uuid,
  p_email     text,
  p_active    boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  insert into public.church_digest_subscriptions (church_id, user_id, email, active)
  values (p_church_id, auth.uid(), p_email, p_active)
  on conflict (church_id, user_id) do update set
    active = excluded.active,
    email  = excluded.email;
end;
$$;

grant execute on function public.set_digest_subscription(uuid, text, boolean) to authenticated;


-- RPC: get digest subscription status
create or replace function public.get_digest_subscription(p_church_id uuid)
returns table (active boolean, email text)
language sql stable security definer set search_path = public as $$
  select active, email
  from   public.church_digest_subscriptions
  where  church_id = p_church_id and user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.get_digest_subscription(uuid) to authenticated;


-- =============================================================================
-- VERIFY (run after applying):
--   select public.church_prospect_pipeline('<church_id>', 25);
--   select public.church_care_queue('<church_id>');
--   select * from public.church_staff where church_id = '<church_id>';
--   select public.get_church_by_slug('grace-community-denver');
--   select public.suggest_groups_for_member('<church_id>', '<profile_id>', 3);
--   select public.church_weekly_digest('<church_id>');
-- =============================================================================


-- =============================================================================
-- STORAGE: church-staff bucket
-- Run this in Supabase Dashboard → Storage → New bucket, OR via SQL:
-- =============================================================================
-- insert into storage.buckets (id, name, public)
-- values ('church-staff', 'church-staff', true)
-- on conflict do nothing;
--
-- drop policy if exists "church staff photos public read" on storage.objects;
-- create policy "church staff photos public read" on storage.objects
--   for select using (bucket_id = 'church-staff');
--
-- drop policy if exists "church staff photos admin upload" on storage.objects;
-- create policy "church staff photos admin upload" on storage.objects
--   for insert with check (
--     bucket_id = 'church-staff' and auth.role() = 'authenticated'
--   );
--
-- drop policy if exists "church staff photos admin delete" on storage.objects;
-- create policy "church staff photos admin delete" on storage.objects
--   for delete using (
--     bucket_id = 'church-staff' and auth.role() = 'authenticated'
--   );
