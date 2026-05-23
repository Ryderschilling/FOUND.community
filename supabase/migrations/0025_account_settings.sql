-- =============================================================================
-- 0025_account_settings.sql
-- Backing store for the Profile → Settings screens (Notifications, Privacy,
-- Location). Adds three preference columns to `profiles` and one RPC to
-- update them.
--
-- Single-pass. No enum changes. Safe to run once on top of 0001..0024.
--
-- Sections:
--   1. profiles preference columns
--   2. update_account_settings() RPC
--   3. account_settings() read RPC
-- =============================================================================


-- =============================================================================
-- 1. Preference columns
--   notification_prefs / privacy_prefs — jsonb so new toggles can be added
--     without further migrations.
--   discovery_radius_miles — int; 0 means "Anywhere" (no distance limit).
-- =============================================================================
alter table public.profiles
  add column if not exists notification_prefs jsonb not null
    default '{"new_messages":true,"connections":true,"group_posts":true,"group_messages":true}'::jsonb,
  add column if not exists privacy_prefs jsonb not null
    default '{"discoverable":true,"show_church":true,"show_location":true}'::jsonb,
  add column if not exists discovery_radius_miles int not null default 50;


-- =============================================================================
-- 2. update_account_settings — partial update; pass only the group you changed.
--   jsonb params: null leaves that group untouched.
--   discovery_radius_miles: null leaves it untouched; 0 = Anywhere.
-- =============================================================================
create or replace function public.update_account_settings(
  p_notification_prefs     jsonb default null,
  p_privacy_prefs          jsonb default null,
  p_discovery_radius_miles int   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  if p_discovery_radius_miles is not null
     and (p_discovery_radius_miles < 0 or p_discovery_radius_miles > 1000) then
    raise exception 'discovery radius out of range';
  end if;

  update public.profiles set
    notification_prefs     = coalesce(p_notification_prefs, notification_prefs),
    privacy_prefs          = coalesce(p_privacy_prefs, privacy_prefs),
    discovery_radius_miles = coalesce(p_discovery_radius_miles, discovery_radius_miles)
  where id = v_me;
end;
$$;

grant execute on function public.update_account_settings(jsonb, jsonb, int) to authenticated;


-- =============================================================================
-- 3. account_settings — read the caller's current preferences in one call.
-- =============================================================================
create or replace function public.account_settings()
returns table (
  notification_prefs     jsonb,
  privacy_prefs          jsonb,
  discovery_radius_miles int,
  city                   text,
  state                  text
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.notification_prefs,
    p.privacy_prefs,
    p.discovery_radius_miles,
    p.city,
    p.state
  from public.profiles p
  where p.id = auth.uid();
$$;

grant execute on function public.account_settings() to authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================
