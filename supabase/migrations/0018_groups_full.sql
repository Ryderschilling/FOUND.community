-- =============================================================================
-- 0018_groups_full.sql
-- Completes the Groups vertical: trigger fix, geocoding, detail/member/chat
-- RPCs, owner management, and the group-photos storage bucket.
--
-- Single-pass. No enum changes. Safe to run once on top of 0001..0017.
--
-- Sections:
--   1.  Fix bump_group_member_count (SECURITY DEFINER — the member_count bug)
--   2.  is_group_admin() helper
--   3.  create_group   (drop+recreate: adds p_lat / p_lng geocoding)
--   4.  my_groups_feed (drop+recreate: adds created_by + cover_path)
--   5.  group_detail()
--   6.  group_members_list()
--   7.  open_group_thread()
--   8.  join_group / leave_group (SECURITY DEFINER + thread participant sync)
--   9.  update_group()
--   10. delete_group()
--   11. remove_group_member()
--   12. set_group_member_role()
--   13. my_threads_detailed (replace: group threads show the group name)
--   14. group-photos storage bucket + RLS
-- =============================================================================


-- =============================================================================
-- 1. Fix member_count trigger
--   The trigger function had no SECURITY DEFINER, so its `UPDATE public.groups`
--   ran as the joining user and was blocked by the "groups update own" RLS
--   policy (owner/admin only). A regular member joined → count never moved.
--   CREATE OR REPLACE keeps the existing triggers bound to this function.
-- =============================================================================
create or replace function public.bump_group_member_count() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set member_count = member_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set member_count = greatest(0, member_count - 1) where id = old.group_id;
  end if;
  return null;
end $$;


-- =============================================================================
-- 2. is_group_admin — am I owner or admin of this group?
--   SECURITY DEFINER so it can be used inside storage.objects RLS policies.
-- =============================================================================
create or replace function public.is_group_admin(p_group uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group
      and profile_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_group_admin(uuid) to authenticated;


-- =============================================================================
-- 3. create_group — now geocodes city/state into `location`.
--   Return type unchanged (uuid) but signature changes → DROP first.
--   New params p_lat / p_lng sit between p_schedule_text and p_icon.
-- =============================================================================
drop function if exists public.create_group(text, text, text, text, text, text, text, text);

create function public.create_group(
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
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
    (name, description, city, state, schedule_text, location,
     icon, icon_color, icon_bg, is_public, created_by)
  values
    (btrim(p_name),
     nullif(btrim(coalesce(p_description,'')),''),
     nullif(btrim(coalesce(p_city,'')),''),
     nullif(btrim(coalesce(p_state,'')),''),
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
  text, text, text, text, text, double precision, double precision, text, text, text
) to authenticated;


-- =============================================================================
-- 4. my_groups_feed — adds created_by + cover_path.
--   Return type changes → DROP first.
--   cover_path = storage_path of the group's first photo (sort_order, created_at).
-- =============================================================================
drop function if exists public.my_groups_feed();

create function public.my_groups_feed()
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
  created_by    uuid,
  cover_path    text,
  is_member     boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
    g.created_by,
    (select ph.storage_path
       from public.photos ph
      where ph.owner_kind = 'group' and ph.owner_id = g.id
      order by ph.sort_order asc, ph.created_at asc
      limit 1) as cover_path,
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
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    g.member_count desc,
    g.created_at  desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- =============================================================================
-- 5. group_detail — one row for the Group Detail screen.
--   Includes caller's membership state + role, and the cover photo path.
-- =============================================================================
create or replace function public.group_detail(p_group uuid)
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
    g.city, g.state, g.schedule_text, g.member_count, g.church_id,
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


-- =============================================================================
-- 6. group_members_list — roster for the Group Detail screen.
--   Ordered owner → admin → member, then by join date.
-- =============================================================================
create or replace function public.group_members_list(p_group uuid)
returns table (
  profile_id uuid,
  full_name  text,
  handle     text,
  avatar_url text,
  role       text,
  joined_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.handle::text,
    p.avatar_url,
    gm.role::text,
    gm.joined_at
  from public.group_members gm
  join public.profiles p on p.id = gm.profile_id
  where gm.group_id = p_group
  order by
    case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    gm.joined_at asc;
$$;

grant execute on function public.group_members_list(uuid) to authenticated;


-- =============================================================================
-- 7. open_group_thread — find-or-create the group's chat thread.
--   SECURITY DEFINER: backfills ALL current members as thread_participants so
--   the existing messages RLS (is_thread_participant) works unchanged.
-- =============================================================================
create or replace function public.open_group_thread(p_group uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_me
  ) then
    raise exception 'not a group member';
  end if;

  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is null then
    insert into public.threads (kind, group_id)
      values ('group', p_group)
      returning id into v_thread;
  end if;

  -- Sync every current member into the thread (idempotent)
  insert into public.thread_participants (thread_id, profile_id)
    select v_thread, gm.profile_id
      from public.group_members gm
     where gm.group_id = p_group
  on conflict do nothing;

  return v_thread;
end;
$$;

grant execute on function public.open_group_thread(uuid) to authenticated;


-- =============================================================================
-- 8. join_group / leave_group — SECURITY DEFINER, keep thread participants
--    in sync. leave_group blocks the owner (must transfer or delete instead).
-- =============================================================================
create or replace function public.join_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  insert into public.group_members (group_id, profile_id, role)
    values (p_group, v_me, 'member')
    on conflict do nothing;

  -- If the group chat already exists, add the new member to it.
  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is not null then
    insert into public.thread_participants (thread_id, profile_id)
      values (v_thread, v_me)
      on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.join_group(uuid) to authenticated;


create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_role   group_role;
  v_thread uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select role into v_role
    from public.group_members
   where group_id = p_group and profile_id = v_me;

  if v_role is null then return; end if;   -- not a member, no-op

  if v_role = 'owner' then
    raise exception 'owner cannot leave; transfer ownership or delete the group';
  end if;

  delete from public.group_members
   where group_id = p_group and profile_id = v_me;

  -- Drop them from the group chat too.
  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is not null then
    delete from public.thread_participants
     where thread_id = v_thread and profile_id = v_me;
  end if;
end;
$$;

grant execute on function public.leave_group(uuid) to authenticated;


-- =============================================================================
-- 9. update_group — owner/admin edits group fields. Re-geocodes when lat/lng
--    are supplied; otherwise keeps the existing location.
-- =============================================================================
create or replace function public.update_group(
  p_group         uuid,
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can edit this group';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  update public.groups set
    name          = btrim(p_name),
    description   = nullif(btrim(coalesce(p_description,'')),''),
    city          = nullif(btrim(coalesce(p_city,'')),''),
    state         = nullif(btrim(coalesce(p_state,'')),''),
    schedule_text = nullif(btrim(coalesce(p_schedule_text,'')),''),
    location      = case when p_lat is not null and p_lng is not null
                         then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
                         else location end
  where id = p_group;
end;
$$;

grant execute on function public.update_group(
  uuid, text, text, text, text, text, double precision, double precision
) to authenticated;


-- =============================================================================
-- 10. delete_group — owner only. The polymorphic `photos` table has no FK to
--     groups, so its rows must be deleted manually. The groups row delete then
--     cascades group_members, group_activities, threads → participants/messages.
--
--     NOTE: storage objects in the group-photos bucket are NOT removed here.
--     The client deletes those before calling this RPC.
-- =============================================================================
create or replace function public.delete_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select profile_id into v_owner
    from public.group_members
   where group_id = p_group and role = 'owner'
   limit 1;

  if v_owner is null or v_owner <> v_me then
    raise exception 'only the owner can delete this group';
  end if;

  delete from public.photos
   where owner_kind = 'group' and owner_id = p_group;

  delete from public.groups where id = p_group;
end;
$$;

grant execute on function public.delete_group(uuid) to authenticated;


-- =============================================================================
-- 11. remove_group_member — owner/admin removes someone else.
--     Cannot remove yourself (use leave_group) or the owner.
-- =============================================================================
create or replace function public.remove_group_member(p_group uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  v_target_role group_role;
  v_thread      uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can remove members';
  end if;
  if p_profile = v_me then
    raise exception 'use leave_group to remove yourself';
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group and profile_id = p_profile;

  if v_target_role is null then return; end if;   -- already gone, no-op
  if v_target_role = 'owner' then
    raise exception 'cannot remove the group owner';
  end if;

  delete from public.group_members
   where group_id = p_group and profile_id = p_profile;

  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;

  if v_thread is not null then
    delete from public.thread_participants
     where thread_id = v_thread and profile_id = p_profile;
  end if;
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated;


-- =============================================================================
-- 12. set_group_member_role — owner only. Promote/demote between member/admin.
--     Cannot change your own role or the owner's role.
-- =============================================================================
create or replace function public.set_group_member_role(
  p_group   uuid,
  p_profile uuid,
  p_role    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me          uuid := auth.uid();
  v_my_role     group_role;
  v_target_role group_role;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_role not in ('member', 'admin') then
    raise exception 'role must be member or admin';
  end if;

  select role into v_my_role
    from public.group_members
   where group_id = p_group and profile_id = v_me;

  if v_my_role is distinct from 'owner' then
    raise exception 'only the owner can change member roles';
  end if;
  if p_profile = v_me then
    raise exception 'cannot change your own role';
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group and profile_id = p_profile;

  if v_target_role is null then
    raise exception 'that person is not a member of this group';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot change the owner role';
  end if;

  update public.group_members
     set role = p_role::group_role
   where group_id = p_group and profile_id = p_profile;
end;
$$;

grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;


-- =============================================================================
-- 13. my_threads_detailed — group threads now show the group name instead of
--     an arbitrary other participant, and expose group_id so the Messages tab
--     can open them in group mode. Return type changes → DROP first.
-- =============================================================================
drop function if exists public.my_threads_detailed();

create function public.my_threads_detailed()
returns table (
  thread_id             uuid,
  kind                  public.thread_kind,
  group_id              uuid,
  other_profile_id      uuid,
  other_full_name       text,
  other_handle          text,
  last_message_at       timestamptz,
  last_message_body     text,
  last_message_sender   uuid,
  last_read_at          timestamptz,
  unread_count          int
)
language sql
stable
set search_path = public
as $$
  with my_threads as (
    select tp.thread_id, tp.last_read_at
    from public.thread_participants tp
    where tp.profile_id = auth.uid()
  ),
  other_party as (
    select distinct on (tp.thread_id)
           tp.thread_id,
           p.id           as other_id,
           p.full_name    as other_name,
           p.handle::text as other_handle
    from public.thread_participants tp
    join public.profiles p on p.id = tp.profile_id
    where tp.thread_id in (select thread_id from my_threads)
      and tp.profile_id <> auth.uid()
    order by tp.thread_id, tp.joined_at asc
  ),
  last_msg as (
    select distinct on (m.thread_id)
           m.thread_id, m.body, m.sender_id, m.created_at
    from public.messages m
    where m.thread_id in (select thread_id from my_threads)
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::int as cnt
    from public.messages m
    join my_threads mt on mt.thread_id = m.thread_id
    where m.sender_id <> auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
    group by m.thread_id
  )
  select t.id              as thread_id,
         t.kind,
         t.group_id,
         case when t.kind = 'group' then null else op.other_id end      as other_profile_id,
         case when t.kind = 'group' then g.name else op.other_name end   as other_full_name,
         case when t.kind = 'group' then null else op.other_handle end   as other_handle,
         t.last_message_at,
         lm.body            as last_message_body,
         lm.sender_id       as last_message_sender,
         mt.last_read_at,
         coalesce(u.cnt, 0) as unread_count
  from public.threads t
  join       my_threads mt on mt.thread_id = t.id
  left join other_party op  on op.thread_id = t.id
  left join last_msg     lm  on lm.thread_id = t.id
  left join unread       u   on u.thread_id  = t.id
  left join public.groups g  on g.id = t.group_id
  order by t.last_message_at desc nulls last,
           t.created_at      desc;
$$;

grant execute on function public.my_threads_detailed() to authenticated;


-- =============================================================================
-- 14. group-photos storage bucket + RLS
--   Public bucket. Path convention: {group_id}/{photo_id}.jpg
--   Write access gated by is_group_admin() on the first path segment.
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('group-photos', 'group-photos', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "group-photos: public read" on storage.objects;
create policy "group-photos: public read"
  on storage.objects for select
  using (bucket_id = 'group-photos');

drop policy if exists "group-photos: admin insert" on storage.objects;
create policy "group-photos: admin insert"
  on storage.objects for insert
  with check (
    bucket_id = 'group-photos'
    and auth.role() = 'authenticated'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "group-photos: admin update" on storage.objects;
create policy "group-photos: admin update"
  on storage.objects for update
  using (
    bucket_id = 'group-photos'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'group-photos'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "group-photos: admin delete" on storage.objects;
create policy "group-photos: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'group-photos'
    and public.is_group_admin(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- DONE.
-- =============================================================================
