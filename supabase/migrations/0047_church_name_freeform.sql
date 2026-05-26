-- =============================================================================
-- 0047_church_name_freeform.sql
--
-- We don't have a curated church list yet. Replace the picker with a free-text
-- field on profiles. The existing church_id FK stays in place for when we add
-- a curated directory later.
-- =============================================================================

alter table public.profiles
  add column if not exists church_name text;

comment on column public.profiles.church_name is
  'Free-text church the user attends. Used until we ship a curated church directory.';

-- Standalone setter — leaves complete_onboarding/update_profile untouched.
create or replace function public.set_church_name(p_church_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_name := nullif(btrim(coalesce(p_church_name, '')), '');
  if v_name is not null and length(v_name) > 120 then
    raise exception 'church name too long (max 120 characters)';
  end if;

  update public.profiles
     set church_name = v_name
   where id = v_uid;
end;
$$;

grant execute on function public.set_church_name(text) to authenticated;
