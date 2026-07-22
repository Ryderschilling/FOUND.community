-- ─────────────────────────────────────────────────────────────────────────
-- 0114_group_post_reactions.sql
--
-- iMessage-style emoji reactions on group activity-feed posts.
--   • group_post_reactions table — ONE reaction per user per post (toggle).
--   • toggle_group_post_reaction(p_post, p_emoji) RPC — add / change / remove.
--   • group_posts_feed() rebuilt to return each post's reaction summary
--     (reactions jsonb: [{emoji,count}]) + the caller's own reaction.
--
-- Additive + backward-compatible: the currently-shipped app reads a subset of
-- group_posts_feed columns, so adding columns does not break it. New table and
-- RPC are unused by the old build. Safe to apply to prod before the new build
-- reaches TestFlight.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Table ───────────────────────────────────────────────────────────────
create table if not exists public.group_post_reactions (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.group_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id)    on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)   -- one reaction per user per post (iMessage-style)
);

create index if not exists group_post_reactions_post_idx
  on public.group_post_reactions (post_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Read: anyone who can see the post's group (public group or a member).
-- Write: only the reacting user, and only in groups they belong to.
alter table public.group_post_reactions enable row level security;

drop policy if exists "post_reactions: read" on public.group_post_reactions;
create policy "post_reactions: read"
  on public.group_post_reactions for select
  using (
    exists (
      select 1
      from public.group_posts gp
      join public.groups g on g.id = gp.group_id
      where gp.id = group_post_reactions.post_id
        and (g.is_public or public.is_group_member(g.id))
    )
  );

drop policy if exists "post_reactions: insert own" on public.group_post_reactions;
create policy "post_reactions: insert own"
  on public.group_post_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_posts gp
      where gp.id = group_post_reactions.post_id
        and public.is_group_member(gp.group_id)
    )
  );

drop policy if exists "post_reactions: update own" on public.group_post_reactions;
create policy "post_reactions: update own"
  on public.group_post_reactions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "post_reactions: delete own" on public.group_post_reactions;
create policy "post_reactions: delete own"
  on public.group_post_reactions for delete
  using (user_id = auth.uid());

-- ── 3. toggle_group_post_reaction RPC ────────────────────────────────────────
-- One reaction per user per post:
--   • no existing reaction        → insert  → returns new emoji
--   • same emoji tapped again      → delete  → returns null
--   • different emoji tapped       → update  → returns new emoji
create or replace function public.toggle_group_post_reaction(
  p_post  uuid,
  p_emoji text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_group    uuid;
  v_existing text;
  v_emoji    text := btrim(coalesce(p_emoji, ''));
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if v_emoji = '' then raise exception 'emoji required'; end if;

  select group_id into v_group from public.group_posts where id = p_post;
  if v_group is null then raise exception 'post not found'; end if;

  if not public.is_group_member(v_group) then
    raise exception 'only group members can react';
  end if;

  select emoji into v_existing
    from public.group_post_reactions
   where post_id = p_post and user_id = v_me;

  if v_existing is null then
    insert into public.group_post_reactions (post_id, user_id, emoji)
      values (p_post, v_me, v_emoji);
    return v_emoji;
  elsif v_existing = v_emoji then
    delete from public.group_post_reactions
      where post_id = p_post and user_id = v_me;
    return null;
  else
    update public.group_post_reactions
       set emoji = v_emoji, created_at = now()
     where post_id = p_post and user_id = v_me;
    return v_emoji;
  end if;
end;
$$;

grant execute on function public.toggle_group_post_reaction(uuid, text) to authenticated;

-- ── 4. Rebuild group_posts_feed with reaction summary ────────────────────────
-- Return signature changes → must DROP first.
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
  can_edit      boolean,
  reactions     jsonb,
  my_reaction   text
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
    coalesce(pr.full_name, pr.handle, 'Member')                    as author_name,
    pr.handle                                                       as author_handle,
    pr.avatar_url                                                   as author_avatar,
    gm.role::text                                                  as author_role,
    gp.body,
    gp.photo_url,
    gp.created_at,
    gp.updated_at,
    gp.is_pinned,
    gp.pinned_at,
    (gp.author_id = auth.uid() or public.is_group_admin(p_group))  as can_delete,
    (gp.author_id = auth.uid())                                    as can_edit,
    coalesce(agg.reactions, '[]'::jsonb)                           as reactions,
    mine.emoji                                                     as my_reaction
  from public.group_posts gp
  join public.profiles pr on pr.id = gp.author_id
  left join public.group_members gm
    on gm.group_id = gp.group_id and gm.profile_id = gp.author_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('emoji', e.emoji, 'count', e.cnt)
             order by e.cnt desc, e.emoji
           ) as reactions
    from (
      select emoji, count(*)::int as cnt
      from public.group_post_reactions
      where post_id = gp.id
      group by emoji
    ) e
  ) agg on true
  left join public.group_post_reactions mine
    on mine.post_id = gp.id and mine.user_id = auth.uid()
  where gp.group_id = p_group
  order by gp.is_pinned desc, gp.pinned_at asc, gp.created_at desc;
$$;

grant execute on function public.group_posts_feed(uuid) to authenticated;
