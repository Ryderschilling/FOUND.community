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
