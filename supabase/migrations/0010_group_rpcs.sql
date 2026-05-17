-- =============================================================================
-- 0010_group_rpcs.sql
-- Groups feed + actions:
--   - my_groups_feed()       : joined + suggested in one round-trip
--   - join_group(p_group)    : adds caller as member
--   - leave_group(p_group)   : removes caller
--   - create_group(...)      : creates group + owner membership
-- =============================================================================

-- ---- my_groups_feed --------------------------------------------------------
-- Returns rows for every public group + every group the user is a member of.
-- `is_member` indicates whether the caller is in the group, so the client
-- splits the response into "Joined" vs "Suggested" sections.
create or replace function public.my_groups_feed()
returns table (
  id            uuid,
  name          text,
  description   text,
  icon          text,
  icon_color    text,
  icon_bg       text,
  city          text,
  state         text,
  schedule_text text,
  member_count  int,
  church_id     uuid,
  is_member     boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member
  from public.groups g
  where g.is_public
     or exists (
       select 1 from public.group_members gm
       where gm.group_id = g.id and gm.profile_id = (select id from me)
     )
  order by
    -- joined groups float to the top, then by member_count desc
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    g.member_count desc,
    g.created_at  desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;

-- ---- join_group ------------------------------------------------------------
create or replace function public.join_group(p_group uuid)
returns void
language plpgsql
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  insert into public.group_members (group_id, profile_id, role)
    values (p_group, v_me, 'member')
    on conflict do nothing;
end;
$$;

grant execute on function public.join_group(uuid) to authenticated;

-- ---- leave_group -----------------------------------------------------------
create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.group_members
    where group_id = p_group and profile_id = v_me;
end;
$$;

grant execute on function public.leave_group(uuid) to authenticated;

-- ---- create_group ----------------------------------------------------------
-- Atomic: insert group row + owner membership. Returns new group id.
create or replace function public.create_group(
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
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
    (name, description, city, state, schedule_text, icon, icon_color, icon_bg,
     is_public, created_by)
    values
    (btrim(p_name), nullif(btrim(coalesce(p_description,'')),''),
     nullif(btrim(coalesce(p_city,'')),''),
     nullif(btrim(coalesce(p_state,'')),''),
     nullif(btrim(coalesce(p_schedule_text,'')),''),
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

grant execute on function public.create_group(text, text, text, text, text, text, text, text) to authenticated;
