-- =============================================================================
-- 0037_group_privacy.sql
-- Public / private groups + a join-request approval flow.
--
--   Public group  → tapping Join joins instantly (existing behaviour).
--   Private group → tapping Join files a request; an owner/admin approves it.
--
-- Design:
--   * Pending requests live in their own table (group_join_requests), NOT in
--     group_members. This keeps group_members = "real members only", so
--     is_group_member(), the member_count trigger, and every membership RLS
--     check stay correct with zero changes.
--   * my_groups_feed becomes SECURITY DEFINER so private groups are still
--     browseable (you can see them and request to join). Their posts/chat
--     stay protected — those RPCs gate on actual membership.
--
-- Single-pass. Safe to run once on top of 0001..0036.
--
-- Sections:
--   1. group_join_requests table + RLS
--   2. join_group        (drop+recreate: returns 'joined' | 'pending')
--   3. cancel_join_request / approve_join_request / decline_join_request
--   4. list_join_requests
--   5. set_group_privacy
--   6. group_detail      (drop+recreate: + is_public, has_pending_request)
--   7. my_groups_feed    (drop+recreate: SECURITY DEFINER, + is_public,
--                         has_pending_request, shows private groups too)
-- =============================================================================


-- =============================================================================
-- 1. group_join_requests — one pending request per (group, profile).
-- =============================================================================
create table if not exists public.group_join_requests (
  group_id   uuid not null references public.groups(id)   on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index if not exists idx_gjr_group on public.group_join_requests (group_id);

alter table public.group_join_requests enable row level security;

-- Read: the requester sees their own; owners/admins see their group's queue.
drop policy if exists "gjr: read" on public.group_join_requests;
create policy "gjr: read"
  on public.group_join_requests for select
  using (profile_id = auth.uid() or public.is_group_admin(group_id));

-- Insert: you can only file a request as yourself.
drop policy if exists "gjr: insert own" on public.group_join_requests;
create policy "gjr: insert own"
  on public.group_join_requests for insert
  with check (profile_id = auth.uid());

-- Delete: the requester can withdraw; an owner/admin can clear it.
drop policy if exists "gjr: delete" on public.group_join_requests;
create policy "gjr: delete"
  on public.group_join_requests for delete
  using (profile_id = auth.uid() or public.is_group_admin(group_id));


-- =============================================================================
-- 2. join_group — public joins instantly, private files a request.
--   Return type changes (void → text) → DROP first.
--   Returns 'joined' or 'pending' so the client can update its UI correctly.
-- =============================================================================
drop function if exists public.join_group(uuid);

create function public.join_group(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me        uuid := auth.uid();
  v_is_public boolean;
  v_thread    uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- Already in → nothing to do.
  if exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_me
  ) then
    return 'joined';
  end if;

  select is_public into v_is_public from public.groups where id = p_group;
  if v_is_public is null then raise exception 'group not found'; end if;

  if v_is_public then
    insert into public.group_members (group_id, profile_id, role)
      values (p_group, v_me, 'member')
      on conflict do nothing;

    -- Clear any stale request.
    delete from public.group_join_requests
      where group_id = p_group and profile_id = v_me;

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

    return 'joined';
  else
    insert into public.group_join_requests (group_id, profile_id)
      values (p_group, v_me)
      on conflict do nothing;
    return 'pending';
  end if;
end;
$$;

grant execute on function public.join_group(uuid) to authenticated;


-- =============================================================================
-- 3. cancel / approve / decline a join request
-- =============================================================================

-- The requester withdraws their own pending request.
create or replace function public.cancel_join_request(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.group_join_requests
   where group_id = p_group and profile_id = v_me;
end;
$$;

grant execute on function public.cancel_join_request(uuid) to authenticated;


-- Owner/admin approves a request → real membership + thread sync.
create or replace function public.approve_join_request(p_group uuid, p_profile uuid)
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
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can approve requests';
  end if;

  if not exists (
    select 1 from public.group_join_requests
    where group_id = p_group and profile_id = p_profile
  ) then
    return;   -- no pending request → no-op
  end if;

  insert into public.group_members (group_id, profile_id, role)
    values (p_group, p_profile, 'member')
    on conflict do nothing;

  delete from public.group_join_requests
   where group_id = p_group and profile_id = p_profile;

  select id into v_thread
    from public.threads
   where kind = 'group' and group_id = p_group
   limit 1;
  if v_thread is not null then
    insert into public.thread_participants (thread_id, profile_id)
      values (v_thread, p_profile)
      on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.approve_join_request(uuid, uuid) to authenticated;


-- Owner/admin declines (deletes) a request.
create or replace function public.decline_join_request(p_group uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can decline requests';
  end if;
  delete from public.group_join_requests
   where group_id = p_group and profile_id = p_profile;
end;
$$;

grant execute on function public.decline_join_request(uuid, uuid) to authenticated;


-- =============================================================================
-- 4. list_join_requests — the pending queue for one group (owner/admin only).
-- =============================================================================
create or replace function public.list_join_requests(p_group uuid)
returns table (
  profile_id   uuid,
  full_name    text,
  handle       text,
  avatar_url   text,
  requested_at timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select
    p.id            as profile_id,
    p.full_name,
    p.handle::text  as handle,
    p.avatar_url,
    r.created_at    as requested_at
  from public.group_join_requests r
  join public.profiles p on p.id = r.profile_id
  where r.group_id = p_group
    and public.is_group_admin(p_group)
  order by r.created_at asc;
$$;

grant execute on function public.list_join_requests(uuid) to authenticated;


-- =============================================================================
-- 5. set_group_privacy — owner/admin flips the public/private toggle.
-- =============================================================================
create or replace function public.set_group_privacy(p_group uuid, p_is_public boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can change group privacy';
  end if;
  if p_is_public is null then raise exception 'privacy value required'; end if;

  update public.groups set is_public = p_is_public where id = p_group;
end;
$$;

grant execute on function public.set_group_privacy(uuid, boolean) to authenticated;


-- =============================================================================
-- 6. group_detail — adds is_public + has_pending_request.
--   Return type changes → DROP first. Rebuilt from the 0023 definition
--   (members-only address) so nothing already shipped is lost.
-- =============================================================================
drop function if exists public.group_detail(uuid);

create function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    -- Address is members-only — many groups meet at homes.
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
    g.is_public,
    exists (select 1 from public.group_members gm
            where gm.group_id = g.id and gm.profile_id = auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = auth.uid()) as my_role,
    exists (select 1 from public.group_join_requests r
            where r.group_id = g.id and r.profile_id = auth.uid()) as has_pending_request
  from public.groups g
  where g.id = p_group;
$$;

grant execute on function public.group_detail(uuid) to authenticated;


-- =============================================================================
-- 7. my_groups_feed — adds is_public + has_pending_request.
--   Now SECURITY DEFINER so private groups are still browseable (you can see
--   one and request to join). Posts/chat stay protected — those RPCs gate on
--   real membership. Return type changes → DROP first.
-- =============================================================================
drop function if exists public.my_groups_feed();

create function public.my_groups_feed()
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  is_public           boolean,
  is_member           boolean,
  has_pending_request boolean
)
language sql stable
security definer
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
    g.is_public,
    exists (
      select 1 from public.group_members gm
      where gm.group_id = g.id and gm.profile_id = (select id from me)
    ) as is_member,
    exists (
      select 1 from public.group_join_requests r
      where r.group_id = g.id and r.profile_id = (select id from me)
    ) as has_pending_request
  from public.groups g
  order by
    case when exists (select 1 from public.group_members gm
                      where gm.group_id = g.id and gm.profile_id = (select id from me))
         then 0 else 1 end,
    g.member_count desc,
    g.created_at  desc;
$$;

grant execute on function public.my_groups_feed() to authenticated;


-- Force PostgREST to pick up the new functions immediately.
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE.
-- =============================================================================
