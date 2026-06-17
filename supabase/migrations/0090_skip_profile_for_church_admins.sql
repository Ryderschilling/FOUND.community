-- =============================================================================
-- 0090_skip_profile_for_church_admins.sql
--
-- Church dashboard signups pass { is_church_admin: true } in raw_user_meta_data.
-- The handle_new_user() trigger was creating a profiles row for ALL auth.users
-- inserts — including church admins — which caused them to appear in the Discover
-- feed as individual user profiles.
--
-- Fix: bail out of the trigger early when is_church_admin = true.
-- Church admins have no profile row and will never surface in Discover, matches,
-- or any consumer-facing query. Their auth account exists solely to authenticate
-- into the church dashboard (church_admins table).
--
-- Safe to re-run. Run AFTER 0089_church_claim_fixes.sql.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision := nullif(trim(new.raw_user_meta_data->>'lat'), '')::double precision;
  v_lng double precision := nullif(trim(new.raw_user_meta_data->>'lng'), '')::double precision;
begin
  -- Church dashboard admins must NOT get a consumer profile.
  -- They authenticate via the same auth.users table but are a completely
  -- separate entity — their presence in `profiles` would make them appear
  -- in Discover, match queries, and any other consumer-facing surface.
  if (new.raw_user_meta_data->>'is_church_admin')::boolean = true then
    return new;
  end if;

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

-- =============================================================================
-- CLEANUP: Delete any profiles that were accidentally created for church admins.
--
-- Matches auth.users rows where is_church_admin = true that have a
-- corresponding profiles row. This is safe — church admins have no onboarding
-- data, no connections, no messages. The profile row is pure noise.
-- =============================================================================
delete from public.profiles
where id in (
  select au.id
  from auth.users au
  where (au.raw_user_meta_data->>'is_church_admin')::boolean = true
);

-- =============================================================================
-- VERIFY:
--   -- Should return 0 rows after cleanup
--   select count(*) from public.profiles p
--   join auth.users au on au.id = p.id
--   where (au.raw_user_meta_data->>'is_church_admin')::boolean = true;
--
--   -- New church signups should no longer appear in:
--   select * from public.profiles order by created_at desc limit 10;
-- =============================================================================
