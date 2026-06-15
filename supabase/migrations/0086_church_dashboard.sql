-- =============================================================================
-- 0030_church_dashboard.sql
-- Church B2B Dashboard: extends churches table + adds church_admins + RPCs
-- Safe to run: all statements use IF NOT EXISTS / OR REPLACE / DO blocks
-- =============================================================================

-- ---------- Extend churches table -------------------------------------------
alter table public.churches
  add column if not exists logo_url         text,
  add column if not exists description      text,
  add column if not exists denomination     text,
  add column if not exists service_times    jsonb default '[]'::jsonb,
  add column if not exists claimed_by       uuid references auth.users(id) on delete set null,
  add column if not exists claimed_at       timestamptz,
  add column if not exists stripe_customer_id     text,
  add column if not exists subscription_status    text default 'unclaimed'
    check (subscription_status in ('unclaimed','trialing','active','past_due','canceled')),
  add column if not exists subscription_tier      text
    check (subscription_tier in ('small','large') or subscription_tier is null),
  add column if not exists trial_ends_at    timestamptz;

-- ---------- Church admins (staff who can access dashboard) ------------------
create table if not exists public.church_admins (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'admin'
    check (role in ('owner','admin','viewer')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (church_id, user_id)
);
create index if not exists idx_church_admins_user   on public.church_admins (user_id);
create index if not exists idx_church_admins_church on public.church_admins (church_id);

-- ---------- RLS on church_admins --------------------------------------------
alter table public.church_admins enable row level security;

-- Admins can see their own church's admin rows
drop policy if exists "church_admins select" on public.church_admins;
create policy "church_admins select" on public.church_admins
  for select using (
    user_id = auth.uid()
    or church_id in (
      select church_id from public.church_admins where user_id = auth.uid()
    )
  );

-- Only owners can insert new admins
drop policy if exists "church_admins insert" on public.church_admins;
create policy "church_admins insert" on public.church_admins
  for insert with check (
    exists (
      select 1 from public.church_admins
      where church_id = church_admins.church_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- Owners can delete admins
drop policy if exists "church_admins delete" on public.church_admins;
create policy "church_admins delete" on public.church_admins
  for delete using (
    exists (
      select 1 from public.church_admins ca2
      where ca2.church_id = church_admins.church_id
        and ca2.user_id = auth.uid()
        and ca2.role = 'owner'
    )
  );

-- ---------- Update churches RLS to allow admin writes -----------------------
drop policy if exists "churches admin write" on public.churches;
create policy "churches admin write" on public.churches
  for update using (
    exists (
      select 1 from public.church_admins
      where church_id = churches.id
        and user_id = auth.uid()
        and role in ('owner','admin')
    )
  );

-- ---------- Helper: is caller an admin of a church? -------------------------
create or replace function public.is_church_admin(p_church uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.church_admins
    where church_id = p_church and user_id = auth.uid()
  );
$$;

-- ---------- RPC: claim_church -----------------------------------------------
-- Called when a church admin claims an existing church listing.
-- Creates the admin account + sets subscription to 'trialing' (30-day trial).
create or replace function public.claim_church(p_church_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Only allow if unclaimed
  if exists (
    select 1 from public.churches where id = p_church_id and claimed_by is not null
  ) then
    raise exception 'Church already claimed';
  end if;

  update public.churches set
    claimed_by          = v_uid,
    claimed_at          = now(),
    subscription_status = 'trialing',
    trial_ends_at       = now() + interval '30 days'
  where id = p_church_id;

  insert into public.church_admins (church_id, user_id, role)
    values (p_church_id, v_uid, 'owner')
    on conflict do nothing;
end;
$$;

grant execute on function public.claim_church(uuid) to authenticated;

-- ---------- RPC: add_church -------------------------------------------------
-- Used when church doesn't exist yet — creates the record + claims it.
create or replace function public.add_and_claim_church(
  p_name     text,
  p_city     text,
  p_state    text,
  p_address  text default null,
  p_zip      text default null,
  p_website  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  insert into public.churches (name, city, state, address, zip, website,
                                claimed_by, claimed_at,
                                subscription_status, trial_ends_at)
  values (btrim(p_name), btrim(p_city), btrim(p_state),
          nullif(btrim(coalesce(p_address,'')), ''),
          nullif(btrim(coalesce(p_zip,'')), ''),
          nullif(btrim(coalesce(p_website,'')), ''),
          v_uid, now(), 'trialing', now() + interval '30 days')
  returning id into v_id;

  insert into public.church_admins (church_id, user_id, role)
    values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

grant execute on function public.add_and_claim_church(text,text,text,text,text,text) to authenticated;

-- ---------- RPC: my_church --------------------------------------------------
-- Returns the church record the current user is an admin of.
create or replace function public.my_church()
returns setof public.churches
language sql stable security definer set search_path = public as $$
  select c.* from public.churches c
  join public.church_admins ca on ca.church_id = c.id
  where ca.user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.my_church() to authenticated;

-- ---------- RPC: church_community_health ------------------------------------
-- Returns the dashboard summary stats for a church.
create or replace function public.church_community_health(p_church_id uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_total_members    int;
  v_connected        int;
  v_isolated         int;
  v_new_this_month   int;
  v_at_risk          int; -- no connections in 30 days but member > 30 days
  v_active_groups    int;
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  -- Total members on FOUND at this church
  select count(*) into v_total_members
  from public.profiles
  where church_id = p_church_id and onboarding_complete = true;

  -- Connected: has at least 1 mutual like
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

  v_isolated := v_total_members - v_connected;

  -- New this calendar month
  select count(*) into v_new_this_month
  from public.profiles
  where church_id = p_church_id
    and onboarding_complete = true
    and created_at >= date_trunc('month', now());

  -- At risk: member > 30 days, zero connections
  select count(*) into v_at_risk
  from public.profiles p
  where p.church_id = p_church_id
    and p.onboarding_complete = true
    and p.created_at < now() - interval '30 days'
    and not exists (
      select 1 from public.connections c1
      join public.connections c2
        on c1.from_profile = c2.to_profile and c1.to_profile = c2.from_profile
      where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
    );

  -- Active groups linked to this church
  select count(*) into v_active_groups
  from public.groups
  where church_id = p_church_id;

  return json_build_object(
    'total_members',  v_total_members,
    'connected',      v_connected,
    'isolated',       v_isolated,
    'new_this_month', v_new_this_month,
    'at_risk',        v_at_risk,
    'active_groups',  v_active_groups
  );
end;
$$;

grant execute on function public.church_community_health(uuid) to authenticated;

-- ---------- RPC: church_members_list ----------------------------------------
-- Returns all FOUND members at this church with connection counts + join date.
create or replace function public.church_members_list(
  p_church_id uuid,
  p_limit     int default 100,
  p_offset    int default 0
)
returns table (
  id              uuid,
  full_name       text,
  city            text,
  state           text,
  life_stage_id   text,
  connection_count int,
  is_connected    boolean,
  joined_found_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    p.city,
    p.state,
    p.life_stage_id,
    (
      select count(*)::int from public.connections c1
      join public.connections c2
        on c1.from_profile = c2.to_profile and c1.to_profile = c2.from_profile
      where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
    ) as connection_count,
    exists (
      select 1 from public.connections c1
      join public.connections c2
        on c1.from_profile = c2.to_profile and c1.to_profile = c2.from_profile
      where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
    ) as is_connected,
    p.created_at as joined_found_at
  from public.profiles p
  where p.church_id = p_church_id
    and p.onboarding_complete = true
    and public.is_church_admin(p_church_id)
  order by p.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.church_members_list(uuid, int, int) to authenticated;

-- ---------- RPC: church_visitor_pipeline ------------------------------------
-- Returns members who joined in the last 90 days — the "visitor pipeline".
create or replace function public.church_visitor_pipeline(p_church_id uuid)
returns table (
  id              uuid,
  full_name       text,
  city            text,
  state           text,
  life_stage_id   text,
  connection_count int,
  joined_found_at  timestamptz,
  days_since_join  int
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    p.city,
    p.state,
    p.life_stage_id,
    (
      select count(*)::int from public.connections c1
      join public.connections c2
        on c1.from_profile = c2.to_profile and c1.to_profile = c2.from_profile
      where c1.from_profile = p.id and c1.kind = 'like' and c2.kind = 'like'
    ) as connection_count,
    p.created_at as joined_found_at,
    extract(day from now() - p.created_at)::int as days_since_join
  from public.profiles p
  where p.church_id = p_church_id
    and p.onboarding_complete = true
    and p.created_at >= now() - interval '90 days'
    and public.is_church_admin(p_church_id)
  order by p.created_at desc;
$$;

grant execute on function public.church_visitor_pipeline(uuid) to authenticated;

-- ---------- RPC: search_churches_for_claim ----------------------------------
-- Lets a new church admin search for their church before claiming.
create or replace function public.search_churches_for_claim(p_query text)
returns table (
  id        uuid,
  name      text,
  city      text,
  state     text,
  address   text,
  is_claimed boolean
)
language sql stable security definer set search_path = public as $$
  select
    id,
    name,
    city,
    state,
    address,
    (claimed_by is not null) as is_claimed
  from public.churches
  where lower(name) like '%' || lower(btrim(p_query)) || '%'
     or lower(city) like '%' || lower(btrim(p_query)) || '%'
  order by
    case when lower(name) like lower(btrim(p_query)) || '%' then 0 else 1 end,
    name
  limit 20;
$$;

grant execute on function public.search_churches_for_claim(text) to authenticated, anon;

-- ---------- RPC: church_groups_list -----------------------------------------
-- Returns groups linked to this church with member counts.
create or replace function public.church_groups_list(p_church_id uuid)
returns table (
  id            uuid,
  name          text,
  description   text,
  schedule_text text,
  member_count  int,
  city          text,
  state         text,
  created_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    g.id, g.name, g.description, g.schedule_text,
    g.member_count, g.city, g.state, g.created_at
  from public.groups g
  where g.church_id = p_church_id
    and public.is_church_admin(p_church_id)
  order by g.member_count desc, g.created_at desc;
$$;

grant execute on function public.church_groups_list(uuid) to authenticated;

-- ---------- RPC: create_church_group ----------------------------------------
create or replace function public.create_church_group(
  p_church_id   uuid,
  p_name        text,
  p_description text default null,
  p_city        text default null,
  p_state       text default null,
  p_schedule    text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_church_admin(p_church_id) then
    raise exception 'not authorized';
  end if;

  insert into public.groups (name, description, city, state, schedule_text,
                              church_id, created_by, is_public)
  values (btrim(p_name),
          nullif(btrim(coalesce(p_description,'')), ''),
          nullif(btrim(coalesce(p_city,'')), ''),
          nullif(btrim(coalesce(p_state,'')), ''),
          nullif(btrim(coalesce(p_schedule,'')), ''),
          p_church_id, auth.uid(), true)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_church_group(uuid,text,text,text,text,text) to authenticated;

-- =============================================================================
-- DONE — run this after 0029_*.sql migrations
-- Verify: select column_name from information_schema.columns where table_name = 'churches';
-- =============================================================================
