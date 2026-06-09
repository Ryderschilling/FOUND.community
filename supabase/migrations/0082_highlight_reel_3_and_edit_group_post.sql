-- ─────────────────────────────────────────────────────────────────────────
-- 0082: Highlight reel cap 3 + editable group posts
--
-- 1. Trim every user's highlight reel to at most 3 photos.
--    Keeps the 3 with the lowest sort_order (i.e. the "first" ones).
--    Deletes rows beyond that — storage objects will 404 but won't break
--    the app; clean up storage manually or via a one-time script if needed.
--
-- 2. update_group_post RPC — lets the author edit the body of their post.
--    Admins/owners cannot edit others' posts (only delete them).
--
-- 3. Rebuild group_posts_feed to include can_edit flag.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Trim existing highlight reels to 3 ─────────────────────────────────
delete from public.photos
where owner_kind = 'profile'
  and id not in (
    select id
    from (
      select id,
             row_number() over (
               partition by owner_id
               order by sort_order asc, created_at asc
             ) as rn
      from public.photos
      where owner_kind = 'profile'
    ) ranked
    where rn <= 3
  );

-- ── 2. update_group_post RPC ───────────────────────────────────────────────
-- Only the original author may edit. Body must be non-empty text.
create or replace function public.update_group_post(
  p_post uuid,
  p_body text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author
  from public.group_posts
  where id = p_post;

  if v_author is null then
    raise exception 'Post not found';
  end if;

  if v_author <> auth.uid() then
    raise exception 'Only the author can edit this post';
  end if;

  if trim(p_body) = '' then
    raise exception 'Post body cannot be empty';
  end if;

  update public.group_posts
  set body       = trim(p_body),
      updated_at = now()
  where id = p_post;
end;
$$;

grant execute on function public.update_group_post(uuid, text) to authenticated;

-- Add updated_at column if it doesn't already exist (safe no-op if it does)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'group_posts'
      and column_name  = 'updated_at'
  ) then
    alter table public.group_posts add column updated_at timestamptz;
  end if;
end $$;

-- ── 3. Rebuild group_posts_feed with can_edit ──────────────────────────────
-- Must DROP first — adding columns to the return type isn't allowed with CREATE OR REPLACE
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
    (gp.author_id = auth.uid() or public.is_group_admin(p_group)) as can_delete,
    (gp.author_id = auth.uid())                                    as can_edit
  from public.group_posts gp
  join public.profiles pr on pr.id = gp.author_id
  left join public.group_members gm
    on gm.group_id = gp.group_id and gm.profile_id = gp.author_id
  where gp.group_id = p_group
  order by gp.created_at desc;
$$;

grant execute on function public.group_posts_feed(uuid) to authenticated;
