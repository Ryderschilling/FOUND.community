-- =============================================================================
-- 0023_group_address.sql
-- Adds a physical meeting address to groups.
--
--   1. groups.address          — new nullable text column.
--   2. create_group(...)       — drop+recreate with a p_address param.
--   3. group_detail(...)       — drop+recreate; returns `address` ONLY to
--                                members. Non-members get NULL so a group's
--                                meeting place (often a home) isn't exposed
--                                to anyone just browsing.
-- =============================================================================

-- ---- 1. Column -----------------------------------------------------------
alter table public.groups
  add column if not exists address text;


-- ---- 2. create_group (adds p_address) ------------------------------------
-- Signature changes → must DROP the old one first.
drop function if exists public.create_group(
  text, text, text, text, text, double precision, double precision, text, text, text
);

create or replace function public.create_group(
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_address       text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_icon          text default 'people-outline',
  p_icon_color    text default '#5A7A4A',
  p_icon_bg       text default '#EDF3EA'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  insert into public.groups
    (name, description, city, state, address, schedule_text, location,
     icon, icon_color, icon_bg, is_public, created_by)
  values
    (btrim(p_name),
     nullif(btrim(coalesce(p_description,'')),''),
     nullif(btrim(coalesce(p_city,'')),''),
     nullif(btrim(coalesce(p_state,'')),''),
     nullif(btrim(coalesce(p_address,'')),''),
     nullif(btrim(coalesce(p_schedule_text,'')),''),
     case when p_lat is not null and p_lng is not null
          then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
          else null end,
     coalesce(p_icon,       'people-outline'),
     coalesce(p_icon_color, '#5A7A4A'),
     coalesce(p_icon_bg,    '#EDF3EA'),
     true, v_me)
  returning id into v_id;

  insert into public.group_members (group_id, profile_id, role)
    values (v_id, v_me, 'owner')
    on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function public.create_group(
  text, text, text, text, text, text, double precision, double precision, text, text, text
) to authenticated;


-- ---- 3. group_detail (returns address, members only) ---------------------
-- Return type changes → must DROP the old one first.
drop function if exists public.group_detail(uuid);

create function public.group_detail(p_group uuid)
returns table (
  id            uuid,
  name          text,
  description   text,
  icon          text,
  icon_color    text,
  icon_bg       text,
  city          text,
  state         text,
  address       text,
  schedule_text text,
  member_count  int,
  church_id     uuid,
  created_by    uuid,
  cover_path    text,
  created_at    timestamptz,
  is_member     boolean,
  my_role       text
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    -- Address is members-only. Many groups meet at homes — don't leak the
    -- meeting location to people who haven't joined.
    case
      when exists (select 1 from public.group_members gm
                   where gm.group_id = g.id and gm.profile_id = auth.uid())
        then g.address
      else null
    end as address,
    g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
    g.created_at,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;
