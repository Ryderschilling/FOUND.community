-- ─────────────────────────────────────────────────────────────────────────
-- 0083: Pinned group posts
--
-- 1. Add is_pinned + pinned_at columns to group_posts.
-- 2. pin_group_post RPC — owner only, max 3 pinned per group.
-- 3. unpin_group_post RPC — owner only.
-- 4. Rebuild group_posts_feed to include is_pinned, sorted pinned-first.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Columns ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'group_posts' and column_name = 'is_pinned'
  ) then
    alter table public.group_posts add column is_pinned boolean not null default false;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'group_posts' and column_name = 'pinned_at'
  ) then
    alter table public.group_posts add column pinned_at timestamptz;
  end if;
end $$;

-- ── 2. pin_group_post RPC ─────────────────────────────────────────────────
create or replace function public.pin_group_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group       uuid;
  v_pin_count   int;
begin
  select group_id into v_group
  from public.group_posts
  where id = p_post;

  if v_group is null then
    raise exception 'Post not found';
  end if;

  -- Owner-only gate
  if not exists (
    select 1 from public.group_members
    where group_id = v_group
      and profile_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'Only the group owner can pin posts';
  end if;

  -- Max 3 pinned posts per group
  select count(*) into v_pin_count
  from public.group_posts
  where group_id = v_group and is_pinned = true;

  if v_pin_count >= 3 then
    raise exception 'A group can have at most 3 pinned posts. Unpin one first.';
  end if;

  update public.group_posts
  set is_pinned = true,
      pinned_at = now()
  where id = p_post;
end;
$$;

grant execute on function public.pin_group_post(uuid) to authenticated;

-- ── 3. unpin_group_post RPC ───────────────────────────────────────────────
create or replace function public.unpin_group_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  select group_id into v_group
  from public.group_posts
  where id = p_post;

  if v_group is null then
    raise exception 'Post not found';
  end if;

  -- Owner-only gate
  if not exists (
    select 1 from public.group_members
    where group_id = v_group
      and profile_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'Only the group owner can unpin posts';
  end if;

  update public.group_posts
  set is_pinned = false,
      pinned_at = null
  where id = p_post;
end;
$$;

grant execute on function public.unpin_group_post(uuid) to authenticated;

-- ── 4. Rebuild group_posts_feed with is_pinned ────────────────────────────
-- Must DROP first — changing return columns isn't allowed with CREATE OR REPLACE
drop function if exists public.group_posts_feed(uuid);

create or replace function public.group_posts_feed(p_group uuid)
returns table (
  id            uuid,
  group_id      uuid,
  author_id     uuid,
  author_name   text,
  author_handle text,
  author_avatar text,
  author_role   text,
  body          text,
  photo_url     text,
  created_at    timestamptz,
  updated_at    timestamptz,
  is_pinned     boolean,
  pinned_at     timestamptz,
  can_delete    boolean,
  can_edit      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gp.id,
    gp.group_id,
    gp.author_id,
    coalesce(pr.full_name, pr.handle, 'Member') as author_name,
    pr.handle                                   as author_handle,
    pr.avatar_url                               as author_avatar,
    gm.role                                     as author_role,
    gp.body,
    gp.photo_url,
    gp.created_at,
    gp.updated_at,
    gp.is_pinned,
    gp.pinned_at,
    (gp.author_id = auth.uid() or public.is_group_admin(p_group)) as can_delete,
    (gp.author_id = auth.uid())                                    as can_edit
  from public.group_posts gp
  join public.profiles pr on pr.id = gp.author_id
  left join public.group_members gm
    on gm.group_id = gp.group_id and gm.profile_id = gp.author_id
  where gp.group_id = p_group
  order by gp.is_pinned desc, gp.pinned_at asc, gp.created_at desc;
$$;

grant execute on function public.group_posts_feed(uuid) to authenticated;
