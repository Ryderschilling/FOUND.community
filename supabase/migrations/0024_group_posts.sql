-- =============================================================================
-- 0024_group_posts.sql
-- Group activity feed: members + admins post text (and an optional photo);
-- the feed is visible to anyone who can see the group.
--
-- Single-pass. No enum changes. Safe to run once on top of 0001..0023.
--
-- Sections:
--   1. is_group_member()  helper (SECURITY DEFINER — usable inside RLS)
--   2. group_posts table + index
--   3. RLS policies (public read, member insert, author/admin delete)
--   4. create_group_post()   RPC
--   5. group_posts_feed()    RPC  (joined with author + can_delete flag)
--   6. delete_group_post()   RPC
--   7. group-post-photos storage bucket + RLS
-- =============================================================================


-- =============================================================================
-- 1. is_group_member — am I a member (any role) of this group?
--   SECURITY DEFINER so it can be used inside RLS + storage.objects policies.
--   Mirrors is_group_admin() from 0018.
-- =============================================================================
create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group
      and profile_id = auth.uid()
  );
$$;

grant execute on function public.is_group_member(uuid) to authenticated;


-- =============================================================================
-- 2. group_posts table
--   A post must have a body, a photo, or both — enforced by the check.
--   ON DELETE CASCADE on both FKs: deleting a group or a profile removes
--   their posts. (Storage objects are purged client-side, like group photos.)
-- =============================================================================
create table if not exists public.group_posts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id)   on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text,
  photo_url  text,
  created_at timestamptz not null default now(),
  constraint group_posts_not_empty
    check (
      (body is not null and btrim(body) <> '')
      or photo_url is not null
    )
);

create index if not exists group_posts_group_created_idx
  on public.group_posts (group_id, created_at desc);


-- =============================================================================
-- 3. RLS — direct table access is safe even though the app uses the RPCs below.
--   read:   anyone who can see the group (public group, or a member)
--   insert: members only, and you can only post as yourself
--   delete: the author, or a group owner/admin
--   (no update policy — posts are not editable in this version)
-- =============================================================================
alter table public.group_posts enable row level security;

drop policy if exists "group_posts: read" on public.group_posts;
create policy "group_posts: read"
  on public.group_posts for select
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_posts.group_id
        and (g.is_public or public.is_group_member(g.id))
    )
  );

drop policy if exists "group_posts: member insert" on public.group_posts;
create policy "group_posts: member insert"
  on public.group_posts for insert
  with check (
    author_id = auth.uid()
    and public.is_group_member(group_id)
  );

drop policy if exists "group_posts: author or admin delete" on public.group_posts;
create policy "group_posts: author or admin delete"
  on public.group_posts for delete
  using (
    author_id = auth.uid()
    or public.is_group_admin(group_id)
  );


-- =============================================================================
-- 4. create_group_post — member/admin adds a post.
--   Validates membership + non-empty content server-side.
-- =============================================================================
create or replace function public.create_group_post(
  p_group     uuid,
  p_body      text default null,
  p_photo_url text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_url  text := nullif(btrim(coalesce(p_photo_url, '')), '');
  v_id   uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(p_group) then
    raise exception 'only group members can post';
  end if;
  if v_body is null and v_url is null then
    raise exception 'post must have text or a photo';
  end if;

  insert into public.group_posts (group_id, author_id, body, photo_url)
    values (p_group, v_me, v_body, v_url)
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_group_post(uuid, text, text) to authenticated;


-- =============================================================================
-- 5. group_posts_feed — the activity feed for one group, newest first.
--   Joined with the author's name/handle/avatar/role, plus a can_delete flag
--   so the client knows whether to show the delete control.
--   SECURITY DEFINER + the same public-or-member visibility gate as the RLS.
-- =============================================================================
create or replace function public.group_posts_feed(p_group uuid)
returns table (
  id            uuid,
  body          text,
  photo_url     text,
  created_at    timestamptz,
  author_id     uuid,
  author_name   text,
  author_handle text,
  author_avatar text,
  author_role   text,
  can_delete    boolean
)
language sql stable
security definer
set search_path = public
as $$
  select
    gp.id,
    gp.body,
    gp.photo_url,
    gp.created_at,
    gp.author_id,
    p.full_name                                          as author_name,
    p.handle::text                                       as author_handle,
    p.avatar_url                                         as author_avatar,
    coalesce(gm.role::text, 'member')                    as author_role,
    (gp.author_id = auth.uid() or public.is_group_admin(p_group)) as can_delete
  from public.group_posts gp
  join public.profiles p on p.id = gp.author_id
  left join public.group_members gm
    on gm.group_id = gp.group_id and gm.profile_id = gp.author_id
  where gp.group_id = p_group
    and exists (
      select 1 from public.groups g
      where g.id = p_group
        and (g.is_public or public.is_group_member(p_group))
    )
  order by gp.created_at desc;
$$;

grant execute on function public.group_posts_feed(uuid) to authenticated;


-- =============================================================================
-- 6. delete_group_post — the author or a group owner/admin removes a post.
--   Storage object for the photo (if any) is removed client-side.
-- =============================================================================
create or replace function public.delete_group_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := auth.uid();
  v_author uuid;
  v_group  uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  select author_id, group_id into v_author, v_group
    from public.group_posts
   where id = p_post;

  if v_author is null then return; end if;   -- already gone, no-op

  if v_author <> v_me and not public.is_group_admin(v_group) then
    raise exception 'only the author or a group admin can delete this post';
  end if;

  delete from public.group_posts where id = p_post;
end;
$$;

grant execute on function public.delete_group_post(uuid) to authenticated;


-- =============================================================================
-- 7. group-post-photos storage bucket + RLS
--   Public bucket. Path convention: {group_id}/{photo_id}.jpg
--   Write access gated by is_group_member() — unlike group-photos (the gallery,
--   admin-only), any member may attach a photo to their own post.
-- =============================================================================
insert into storage.buckets (id, name, public)
  values ('group-post-photos', 'group-post-photos', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "group-post-photos: public read" on storage.objects;
create policy "group-post-photos: public read"
  on storage.objects for select
  using (bucket_id = 'group-post-photos');

drop policy if exists "group-post-photos: member insert" on storage.objects;
create policy "group-post-photos: member insert"
  on storage.objects for insert
  with check (
    bucket_id = 'group-post-photos'
    and auth.role() = 'authenticated'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "group-post-photos: member delete" on storage.objects;
create policy "group-post-photos: member delete"
  on storage.objects for delete
  using (
    bucket_id = 'group-post-photos'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- =============================================================================
-- DONE.
-- =============================================================================
