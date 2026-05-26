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
