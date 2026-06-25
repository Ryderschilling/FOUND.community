-- =============================================================================
-- 0106_fix_is_home_church.sql
--
-- BUG: is_home_church column never existed in profiles table.
-- set_profile_church accepted p_is_home_church as a parameter but never wrote it.
-- Result: clicking "Home Church" in ChurchPicker had no persistent effect.
--
-- FIX:
--   1. Add is_home_church boolean column to profiles
--   2. Recreate set_profile_church to actually write it
-- =============================================================================

-- 1. Add the column (safe to re-run)
alter table public.profiles
  add column if not exists is_home_church boolean not null default false;

-- 2. Fix set_profile_church to write is_home_church
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
    is_home_church     = p_is_home_church,
    looking_for_church = case
                           when p_church_id is not null then false   -- found one
                           when p_is_home_church        then false   -- home church, done
                           else                              true    -- cleared, still looking
                         end
  where id = v_uid;
end;
$$;

grant execute on function public.set_profile_church(uuid, boolean) to authenticated;
