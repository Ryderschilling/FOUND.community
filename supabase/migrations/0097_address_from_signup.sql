-- =============================================================================
-- 0097_address_from_signup.sql
--
-- Adds `address` (street address) to the fields captured at signup and written
-- by handle_new_user(). Previously only city/state/zip were persisted; the
-- street address typed in the signup autocomplete was discarded.
--
-- The `address` column already exists on the profiles table (migration 0001).
-- This migration simply teaches the trigger to read it from raw_user_meta_data.
--
-- Safe to re-run. Run AFTER 0096_fix_send_message_to_church.sql.
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
  if (new.raw_user_meta_data->>'is_church_admin')::boolean = true then
    return new;
  end if;

  insert into public.profiles (id, full_name, phone, zip, city, state, address, location)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(trim(new.raw_user_meta_data->>'phone'),   ''),
    nullif(trim(new.raw_user_meta_data->>'zip'),     ''),
    nullif(trim(new.raw_user_meta_data->>'city'),    ''),
    upper(nullif(trim(new.raw_user_meta_data->>'state'), '')),
    nullif(trim(new.raw_user_meta_data->>'address'), ''),
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
-- VERIFY:
--   -- New signups should have address populated:
--   select id, address, city, state, zip from public.profiles order by created_at desc limit 5;
-- =============================================================================
