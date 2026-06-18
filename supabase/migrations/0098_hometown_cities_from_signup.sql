-- =============================================================================
-- 0098_hometown_cities_from_signup.sql
--
-- Fixes: hometown_cities collected at signup was never written to profiles.
-- The signup form passes hometown_cities as a JSON-encoded string in
-- raw_user_meta_data (e.g. '["Miami, FL","Atlanta, GA"]'). The trigger was
-- ignoring it and only writing city/state/zip.
--
-- Also writes `hometown` (derived from the first city in the array) so both
-- columns stay in sync from day one.
--
-- Safe to re-run. Run AFTER 0097_address_from_signup.sql.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat              double precision := nullif(trim(new.raw_user_meta_data->>'lat'), '')::double precision;
  v_lng              double precision := nullif(trim(new.raw_user_meta_data->>'lng'), '')::double precision;
  v_hometown_raw     text             := nullif(trim(new.raw_user_meta_data->>'hometown_cities'), '');
  v_hometown_cities  text[]           := null;
  v_hometown         text             := null;
begin
  -- Church dashboard admins must NOT get a consumer profile.
  if (new.raw_user_meta_data->>'is_church_admin')::boolean = true then
    return new;
  end if;

  -- Parse hometown_cities from JSON string → text[].
  -- The app sends it as JSON.stringify(["Miami, FL", "Atlanta, GA"]).
  -- If parsing fails (empty / malformed), leave as null.
  if v_hometown_raw is not null then
    begin
      v_hometown_cities := array(
        select trim(elem)
        from   jsonb_array_elements_text(v_hometown_raw::jsonb) as elem
        where  trim(elem) <> ''
      );
      -- Derive primary hometown from first entry
      if array_length(v_hometown_cities, 1) > 0 then
        v_hometown := v_hometown_cities[1];
      end if;
    exception when others then
      v_hometown_cities := null;
    end;
  end if;

  insert into public.profiles (
    id, full_name, phone, zip, city, state, address,
    hometown, hometown_cities, location
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(trim(new.raw_user_meta_data->>'phone'),   ''),
    nullif(trim(new.raw_user_meta_data->>'zip'),     ''),
    nullif(trim(new.raw_user_meta_data->>'city'),    ''),
    upper(nullif(trim(new.raw_user_meta_data->>'state'), '')),
    nullif(trim(new.raw_user_meta_data->>'address'), ''),
    v_hometown,
    v_hometown_cities,
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
--   select id, full_name, address, hometown, hometown_cities
--   from public.profiles
--   order by created_at desc limit 5;
-- =============================================================================
