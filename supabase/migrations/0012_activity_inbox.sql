-- =============================================================================
-- 0012_activity_inbox.sql
-- Activity inbox: lets the recipient of a connect/wave mark notifications as
-- seen (so the badge clears) or soft-dismiss them (so they stop showing in
-- the Activity feed, but the underlying connection row stays — they can still
-- appear in the matches feed and can re-request).
--
-- New columns on connections:
--   seen_at       — when the recipient opened Activity for this row
--   dismissed_at  — when the recipient soft-dismissed the row
--
-- New RPCs:
--   mark_inbound_seen(p_from)    — mark inbound rows from one sender as seen
--                                  (or all when p_from is NULL)
--   dismiss_inbound(p_from)      — soft-dismiss inbound rows from one sender
--   unread_inbound_count()       — int count for tab badge
--
-- Also updates inbound_connections() to filter out dismissed rows and to
-- return seen_at so the UI can render unseen-state styling.
-- =============================================================================

-- ---- 1. Schema: seen_at + dismissed_at -----------------------------------
alter table public.connections
  add column if not exists seen_at      timestamptz,
  add column if not exists dismissed_at timestamptz;

-- Partial index for the unread-count query (cheap; most rows will be seen).
create index if not exists idx_connections_to_unread
  on public.connections (to_profile)
  where seen_at is null and dismissed_at is null;

-- ---- 2. mark_inbound_seen(p_from) ----------------------------------------
-- Recipient marks inbound row(s) as seen. Pass NULL to mark ALL inbound seen
-- (used when the user opens the Activity tab). SECURITY DEFINER because the
-- recipient doesn't own these rows (the sender does); RLS would block them.
create or replace function public.mark_inbound_seen(p_from uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
  set seen_at = coalesce(seen_at, now())
  where to_profile = auth.uid()
    and (p_from is null or from_profile = p_from)
    and seen_at is null
    and kind in ('like','wave');
$$;
grant execute on function public.mark_inbound_seen(uuid) to authenticated;

-- ---- 3. dismiss_inbound(p_from) ------------------------------------------
-- Soft-dismiss: hides the row from the Activity feed but leaves the
-- underlying like/wave intact (so the sender can still appear in the
-- recipient's matches feed and can re-request).
create or replace function public.dismiss_inbound(p_from uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
  set dismissed_at = now()
  where to_profile = auth.uid()
    and from_profile = p_from
    and kind in ('like','wave');
$$;
grant execute on function public.dismiss_inbound(uuid) to authenticated;

-- ---- 4. unread_inbound_count() — tab badge -------------------------------
create or replace function public.unread_inbound_count()
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.connections
  where to_profile = auth.uid()
    and kind in ('like','wave')
    and seen_at is null
    and dismissed_at is null;
$$;
grant execute on function public.unread_inbound_count() to authenticated;

-- ---- 5. Rebuild inbound_connections() to filter dismissed + return seen_at
-- Drop+recreate to change return type.
drop function if exists public.inbound_connections();

create or replace function public.inbound_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  their_kind        public.connection_kind,
  my_kind           public.connection_kind,
  is_match          boolean,
  seen_at           timestamptz,
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.seen_at, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
      and c.dismissed_at is null
    order by c.from_profile,
             case c.kind when 'like' then 0 when 'wave' then 1 else 2 end,
             c.created_at desc
  )
  select
    p.id                                  as profile_id,
    p.full_name,
    p.handle::text                        as handle,
    p.avatar_url,
    ls.label                              as life_stage_label,
    p.city,
    p.state,
    i.kind                                as their_kind,
    (
      select kind from public.connections m
      where m.from_profile = (select id from me)
        and m.to_profile = p.id
      order by case m.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                     as my_kind,
    (
      exists (
        select 1 from public.connections m
        where m.from_profile = (select id from me)
          and m.to_profile = p.id
          and m.kind = 'like'
      ) and i.kind = 'like'
    )                                     as is_match,
    i.seen_at,
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;
grant execute on function public.inbound_connections() to authenticated;
