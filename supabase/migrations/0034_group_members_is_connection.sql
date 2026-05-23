-- 0034_group_members_is_connection.sql
--
-- Adds `is_connection` to group_members_list so the Group Detail screen can
-- show a "Friends in this group" strip to non-members and badge connected
-- members in the full roster modal.
--
-- is_connection = true when the calling user has a mutual 'like' with that
-- member (same definition used by my_connections()).
-- =============================================================================

drop function if exists public.group_members_list(uuid);

create or replace function public.group_members_list(p_group uuid)
returns table (
  profile_id    uuid,
  full_name     text,
  handle        text,
  avatar_url    text,
  role          text,
  joined_at     timestamptz,
  is_connection boolean
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
    gm.joined_at,
    -- Mutual connection check: caller liked them AND they liked caller.
    exists (
      select 1
      from public.connections c1
      join public.connections c2
        on  c1.to_profile   = c2.from_profile
        and c1.from_profile = c2.to_profile
        and c2.kind = 'like'
      where c1.from_profile = auth.uid()
        and c1.kind         = 'like'
        and c2.from_profile = p.id
    ) as is_connection
  from public.group_members gm
  join public.profiles       p  on p.id = gm.profile_id
  where gm.group_id = p_group
  order by
    case gm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    gm.joined_at asc;
$$;

grant execute on function public.group_members_list(uuid) to authenticated;
