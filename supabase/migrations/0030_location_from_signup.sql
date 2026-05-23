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
