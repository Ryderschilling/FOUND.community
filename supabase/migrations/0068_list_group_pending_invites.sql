-- =============================================================================
-- 0068_list_group_pending_invites.sql
-- Lets group owners/admins see who has been invited but not yet responded.
-- Used by GroupDetailScreen to render the "Invited" row in the members list.
-- =============================================================================

begin;

create or replace function public.list_group_pending_invites(p_group uuid)
returns table (
  invite_id   uuid,
  profile_id  uuid,
  full_name   text,
  handle      text,
  avatar_url  text,
  invited_at  timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  -- Only owners and admins can see the full pending-invite list.
  select
    gi.id           as invite_id,
    p.id            as profile_id,
    p.full_name,
    p.handle,
    p.avatar_url,
    gi.created_at   as invited_at
  from public.group_invites gi
  join public.profiles p on p.id = gi.invitee_id
  where gi.group_id = p_group
    and gi.status   = 'pending'
    and exists (
      select 1
      from public.group_members gm
      where gm.group_id   = p_group
        and gm.profile_id = auth.uid()
        and gm.role in ('owner', 'admin')
    )
  order by gi.created_at;
$$;

grant execute on function public.list_group_pending_invites(uuid) to authenticated;

-- Verify
-- select * from list_group_pending_invites('<group_uuid>');

commit;
