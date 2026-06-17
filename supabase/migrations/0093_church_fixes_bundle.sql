-- =============================================================================
-- 0093_church_fixes_bundle.sql
--
-- Fixes three bugs found during QA on 2026-06-17:
--
--   BUG 1: notifications table missing `data jsonb` column.
--     Migration 0091 created a trigger (on_profile_church_set) that inserts
--     into notifications(user_id, type, title, body, data), but never ran
--     ALTER TABLE to add the column. Any set_profile_church call crashes with
--     "column data of relation notifications does not exist".
--
--   BUG 2: create_church_group violates FK constraint.
--     The groups.created_by column references profiles(id). Church admins have
--     no profile row (migration 0090 intentionally prevents it). Passing
--     auth.uid() as created_by always fails with a FK violation error.
--     Fix: use NULL for church-created groups — they're owned by the church,
--     not an individual profile.
--
--   BUG 3: New churches don't get a slug on creation.
--     Migration 0091 added churches.slug and backfilled existing records, but
--     didn't update add_and_claim_church / claim_church to auto-generate a slug
--     for new churches. The invite link shows "Generating…" forever.
--
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS / OR REPLACE throughout.
-- =============================================================================


-- =============================================================================
-- FIX 1: Add missing data column to notifications
-- =============================================================================

alter table public.notifications
  add column if not exists data jsonb;


-- =============================================================================
-- FIX 2: create_church_group — use NULL for created_by (no profile for admins)
-- =============================================================================

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

  -- created_by is intentionally NULL for church-dashboard-created groups.
  -- Church admins have no profile row (by design — migration 0090), so we
  -- cannot reference their auth.uid() via the profiles FK.
  -- The church_id column is sufficient to identify ownership.
  insert into public.groups (name, description, city, state, schedule_text,
                              church_id, created_by, is_public)
  values (btrim(p_name),
          nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_city,        '')), ''),
          nullif(btrim(coalesce(p_state,        '')), ''),
          nullif(btrim(coalesce(p_schedule,     '')), ''),
          p_church_id, null, true)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_church_group(uuid, text, text, text, text, text) to authenticated;


-- =============================================================================
-- FIX 3: Slug generation helper (extracted from 0091 DO block for reuse)
-- =============================================================================

-- Internal helper — generates a unique slug for a given church name + city.
-- Not exposed to the API.
create or replace function public._generate_church_slug(
  p_name text,
  p_city text,
  p_id   uuid   -- the church's own id so we can skip it in the uniqueness check
) returns text
language plpgsql security definer set search_path = public as $$
declare
  base_slug  text;
  final_slug text;
  counter    int := 2;
begin
  -- Build slug from name + city
  base_slug := lower(
    regexp_replace(
      trim(both '-' from
        regexp_replace(
          btrim(p_name) || '-' || btrim(coalesce(p_city, '')),
          '[^a-zA-Z0-9]+', '-', 'g'
        )
      ),
      '-+', '-', 'g'
    )
  );

  -- Fallback if slug is empty after sanitisation
  if base_slug = '' or base_slug = '-' then
    base_slug := 'church-' || left(p_id::text, 8);
  end if;

  final_slug := base_slug;

  -- Ensure uniqueness
  while exists (
    select 1 from public.churches
    where slug = final_slug
      and id <> p_id
  ) loop
    final_slug := base_slug || '-' || counter;
    counter    := counter + 1;
  end loop;

  return final_slug;
end;
$$;


-- =============================================================================
-- FIX 3a: add_and_claim_church — auto-generate slug on creation
-- =============================================================================

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
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_slug text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Check for an existing unclaimed church with the same name+city.
  -- Prevents duplicate church IDs when a user already submitted a church
  -- request and an admin then tries to add it.
  select id into v_id
  from public.churches
  where lower(name) = lower(btrim(p_name))
    and lower(coalesce(city, '')) = lower(btrim(coalesce(p_city, '')))
    and claimed_by is null
  limit 1;

  if v_id is not null then
    -- Existing unclaimed record found — claim it and patch missing fields.
    update public.churches set
      claimed_by          = v_uid,
      claimed_at          = now(),
      subscription_status = 'trialing',
      trial_ends_at       = now() + interval '30 days',
      state   = coalesce(state,   nullif(btrim(coalesce(p_state,   '')), '')),
      address = coalesce(address, nullif(btrim(coalesce(p_address, '')), '')),
      zip     = coalesce(zip,     nullif(btrim(coalesce(p_zip,     '')), '')),
      website = coalesce(website, nullif(btrim(coalesce(p_website, '')), ''))
    where id = v_id;
  else
    -- No matching church — create a fresh record.
    insert into public.churches (name, city, state, address, zip, website,
                                  claimed_by, claimed_at,
                                  subscription_status, trial_ends_at)
    values (btrim(p_name), btrim(p_city), btrim(p_state),
            nullif(btrim(coalesce(p_address, '')), ''),
            nullif(btrim(coalesce(p_zip,     '')), ''),
            nullif(btrim(coalesce(p_website, '')), ''),
            v_uid, now(), 'trialing', now() + interval '30 days')
    returning id into v_id;
  end if;

  -- Auto-generate slug if not already set
  update public.churches
  set slug = public._generate_church_slug(name, city, id)
  where id = v_id and slug is null;

  insert into public.church_admins (church_id, user_id, role)
    values (v_id, v_uid, 'owner')
    on conflict do nothing;

  -- Link admin's own profile to this church (no-op for admins with no profile).
  update public.profiles
  set church_id = v_id
  where id = v_uid;

  return v_id;
end;
$$;

grant execute on function public.add_and_claim_church(text, text, text, text, text, text) to authenticated;


-- =============================================================================
-- FIX 3b: claim_church — auto-generate slug when claiming
-- =============================================================================

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

  -- Auto-generate slug if not already set
  update public.churches
  set slug = public._generate_church_slug(name, city, id)
  where id = p_church_id and slug is null;

  insert into public.church_admins (church_id, user_id, role)
    values (p_church_id, v_uid, 'owner')
    on conflict do nothing;

  -- Link admin's own profile (no-op for admins with no profile row).
  update public.profiles
  set church_id = p_church_id
  where id = v_uid;
end;
$$;

grant execute on function public.claim_church(uuid) to authenticated;


-- =============================================================================
-- BACKFILL: generate slugs for any claimed churches that still don't have one
-- (catches any churches that were claimed between 0091 and this migration)
-- =============================================================================

do $$
declare
  rec record;
begin
  for rec in
    select id, name, city
    from public.churches
    where slug is null
      and claimed_by is not null
  loop
    update public.churches
    set slug = public._generate_church_slug(rec.name, rec.city, rec.id)
    where id = rec.id;
  end loop;
end $$;


-- =============================================================================
-- VERIFY after applying:
--
--   1. notifications.data column exists:
--      select column_name from information_schema.columns
--      where table_name = 'notifications' and column_name = 'data';
--
--   2. create_church_group succeeds (no FK error):
--      select create_church_group('<church_id>', 'Test Group');
--
--   3. All claimed churches now have slugs:
--      select count(*) from churches where claimed_by is not null and slug is null;
--      -- should return 0
--
--   4. set_profile_church no longer crashes:
--      select set_profile_church('<church_id>', false);
-- =============================================================================
