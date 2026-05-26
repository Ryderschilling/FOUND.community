-- =============================================================================
-- 0048_group_invites.sql
-- Lets group owners (and, for public groups, any member) invite their
-- connections to a group. Creates one in-app notification per invitee.
--
-- Tables / RPCs:
--   1. group_invites           — pending/accepted/declined invites
--   2. invite_to_group(...)    — bulk-invite RPC (creates rows + notifications)
--   3. respond_to_group_invite — accept/decline (accept = auto-join)
--   4. my_group_invites()      — list pending invites for the current user
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

-- ---- 1. group_invites table -------------------------------------------------
create table if not exists public.group_invites (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id)   on delete cascade,
  inviter_id    uuid not null references public.profiles(id) on delete cascade,
  invitee_id    uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined','revoked')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (group_id, invitee_id)
);

create index if not exists idx_group_invites_invitee_pending
  on public.group_invites (invitee_id) where status = 'pending';

create index if not exists idx_group_invites_group
  on public.group_invites (group_id);

-- ---- 2. RLS ----------------------------------------------------------------
alter table public.group_invites enable row level security;

drop policy if exists "group_invites: select own" on public.group_invites;
create policy "group_invites: select own"
  on public.group_invites for select
  using (invitee_id = auth.uid() or inviter_id = auth.uid());

-- All writes go through SECURITY DEFINER RPCs; no direct INSERT/UPDATE/DELETE.

-- ---- 3. invite_to_group RPC ------------------------------------------------
-- Anyone who is a member of the group can invite. (Tightens easily later by
-- restricting to owner if you want.)
create or replace function public.invite_to_group(
  p_group     uuid,
  p_invitees  uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_is_member  boolean;
  v_group_name text;
  v_actor_name text;
  v_invitee    uuid;
  v_count      int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_invitees is null or array_length(p_invitees, 1) is null then
    return 0;
  end if;

  -- Must be a member of the group.
  select exists (
    select 1 from public.group_members
    where group_id = p_group and profile_id = v_uid
  ) into v_is_member;
  if not v_is_member then
    raise exception 'not a group member';
  end if;

  select name into v_group_name from public.groups where id = p_group;
  if v_group_name is null then
    raise exception 'group not found';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;

  foreach v_invitee in array p_invitees loop
    -- Skip self, existing members, and dupes (unique constraint also blocks).
    if v_invitee = v_uid then continue; end if;
    if exists (
      select 1 from public.group_members
      where group_id = p_group and profile_id = v_invitee
    ) then continue; end if;

    -- Upsert the invite — re-invite resets status to pending.
    insert into public.group_invites (group_id, inviter_id, invitee_id, status)
    values (p_group, v_uid, v_invitee, 'pending')
    on conflict (group_id, invitee_id)
      do update set status = 'pending', responded_at = null, inviter_id = excluded.inviter_id;

    -- Fire a notification (uses the 0027 notifications table directly —
    -- there's no trigger because invites aren't a message/post).
    insert into public.notifications
      (user_id, type, actor_id, entity_type, entity_id, title, body)
    values
      (v_invitee,
       'group_invite',
       v_uid,
       'group',
       p_group,
       coalesce(v_actor_name, 'Someone') || ' invited you to a group',
       'Join "' || v_group_name || '" on FOUND.');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.invite_to_group(uuid, uuid[]) to authenticated;

-- ---- 4. respond_to_group_invite RPC ----------------------------------------
-- p_accept = true  → status='accepted' + join_group()
-- p_accept = false → status='declined'
create or replace function public.respond_to_group_invite(
  p_invite uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_group   uuid;
  v_status  text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select group_id, status into v_group, v_status
  from public.group_invites
  where id = p_invite and invitee_id = v_uid;

  if v_group is null then
    raise exception 'invite not found';
  end if;
  if v_status <> 'pending' then
    return v_status;
  end if;

  if p_accept then
    update public.group_invites
       set status = 'accepted', responded_at = now()
     where id = p_invite;
    perform public.join_group(v_group);
    return 'accepted';
  else
    update public.group_invites
       set status = 'declined', responded_at = now()
     where id = p_invite;
    return 'declined';
  end if;
end;
$$;

grant execute on function public.respond_to_group_invite(uuid, boolean) to authenticated;

-- ---- 5. my_group_invites RPC -----------------------------------------------
create or replace function public.my_group_invites()
returns table (
  id            uuid,
  group_id      uuid,
  group_name    text,
  group_cover   text,
  inviter_id    uuid,
  inviter_name  text,
  created_at    timestamptz
)
language sql stable
set search_path = public
as $$
  select gi.id, gi.group_id, g.name, g.cover_path,
         gi.inviter_id, p.full_name, gi.created_at
    from public.group_invites gi
    join public.groups   g on g.id = gi.group_id
    left join public.profiles p on p.id = gi.inviter_id
   where gi.invitee_id = auth.uid()
     and gi.status     = 'pending'
   order by gi.created_at desc;
$$;

grant execute on function public.my_group_invites() to authenticated;

commit;
