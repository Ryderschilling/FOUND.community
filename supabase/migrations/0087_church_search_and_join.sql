-- =============================================================================
-- 0087_church_search_and_join.sql
-- Three RPCs the mobile ChurchPicker calls that were missing:
--   1. search_churches       — users search for their church by name/city
--   2. set_profile_church    — user selects a church (sets profiles.church_id)
--   3. submit_church_request — user requests a church not in the list yet
--                              (inserts as unverified, links user immediately)
-- =============================================================================

-- ---------- 1. search_churches -----------------------------------------------
-- Called by ChurchPicker on every keystroke.
-- Returns all churches (claimed & unclaimed, verified & unverified).
-- Users need to find any church — not just ones already claimed by admins.
create or replace function public.search_churches(p_query text)
returns table (
  id    uuid,
  name  text,
  city  text,
  state text
)
language sql stable security definer set search_path = public as $$
  select id, name, city, state
  from public.churches
  where
    lower(name) like '%' || lower(btrim(p_query)) || '%'
    or lower(city) like '%' || lower(btrim(p_query)) || '%'
  order by
    -- exact name prefix matches first
    case when lower(name) like lower(btrim(p_query)) || '%' then 0 else 1 end,
    name
  limit 20;
$$;

grant execute on function public.search_churches(text) to authenticated, anon;


-- ---------- 2. set_profile_church --------------------------------------------
-- Called when a user selects a church, marks themselves as home-church, or clears.
--
-- Semantics:
--   p_church_id = <uuid>,  p_is_home_church = false  → selected a specific church
--   p_church_id = null,    p_is_home_church = true   → "I'm a home church person"
--   p_church_id = null,    p_is_home_church = false  → cleared / still searching
create or replace function public.set_profile_church(
  p_church_id      uuid,
  p_is_home_church boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  update public.profiles
  set
    church_id          = p_church_id,
    -- looking_for_church: true = still searching, false = found or home church
    looking_for_church = case
                           when p_church_id is not null then false   -- found one
                           when p_is_home_church        then false   -- home church, done
                           else                              true    -- cleared, still looking
                         end
  where id = v_uid;
end;
$$;

grant execute on function public.set_profile_church(uuid, boolean) to authenticated;


-- ---------- 3. submit_church_request -----------------------------------------
-- User wants a church that's not in the database yet.
-- Inserts the church as unverified and immediately links the user to it so they
-- show up in the dashboard once a church admin claims + verifies the record.
create or replace function public.submit_church_request(
  p_name           text,
  p_city           text    default null,
  p_state          text    default null,
  p_years_attended integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_church_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if btrim(p_name) = '' then raise exception 'church name is required'; end if;

  -- Check if a church with this exact name + city already exists (case-insensitive).
  -- If so, just link the user to it rather than creating a duplicate.
  select id into v_church_id
  from public.churches
  where lower(name) = lower(btrim(p_name))
    and (
      (p_city is null and city is null)
      or lower(city) = lower(btrim(coalesce(p_city, '')))
    )
  limit 1;

  -- If no match, create a new unverified church record
  if v_church_id is null then
    insert into public.churches (name, city, state, is_verified)
    values (
      btrim(p_name),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''),
      false
    )
    returning id into v_church_id;
  end if;

  -- Link the user to this church immediately
  update public.profiles
  set
    church_id          = v_church_id,
    looking_for_church = false
  where id = v_uid;

  return v_church_id;
end;
$$;

grant execute on function public.submit_church_request(text, text, text, integer) to authenticated;

-- =============================================================================
-- Verify:
--   select public.search_churches('grace');
--   select public.set_profile_church('<uuid>', false);
--   select public.submit_church_request('Grace Church', 'Austin', 'TX', 3);
-- =============================================================================
