-- =============================================================================
-- 0008_wave_and_reciprocal.sql
-- Adds:
--   - 'wave' kind on connection_kind enum
--   - connection_status_with(p_other) RPC: my outbound + their inbound status
--   - inbound_connections(): people who've connected/waved at me (Likes-You feed)
--   - top_matches_detailed: now also returns inbound flags so the Discover feed
--     can render "they liked you" / "they waved" badges on first paint.
-- =============================================================================

-- ---- 1. Add 'wave' to connection_kind enum --------------------------------
do $$
begin
  alter type public.connection_kind add value if not exists 'wave';
exception when duplicate_object then null;
end $$;

-- ---- 2. connection_status_with(p_other) -----------------------------------
-- Returns a single row describing the connection state between me and p_other.
--   my_kind         — my outbound kind (NULL if I haven't acted)
--   their_kind      — their outbound kind toward me (NULL if they haven't)
--   is_match        — both sides have 'like' (mutual)
create or replace function public.connection_status_with(p_other uuid)
returns table (
  my_kind     public.connection_kind,
  their_kind  public.connection_kind,
  is_match    boolean
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       mine as (
         select kind from public.connections
         where from_profile = (select id from me)
           and to_profile = p_other
           -- "Like" trumps "wave" if both exist; surface the strongest signal.
         order by case kind when 'like' then 0 when 'wave' then 1 else 2 end
         limit 1
       ),
       theirs as (
         select kind from public.connections
         where from_profile = p_other
           and to_profile = (select id from me)
         order by case kind when 'like' then 0 when 'wave' then 1 else 2 end
         limit 1
       )
  select
    (select kind from mine)                                          as my_kind,
    (select kind from theirs)                                        as their_kind,
    ((select kind from mine) = 'like' and (select kind from theirs) = 'like') as is_match;
$$;

grant execute on function public.connection_status_with(uuid) to authenticated;

-- ---- 3. inbound_connections() — "wants to connect with you" feed ----------
-- People who've sent me a 'like' or 'wave'. Most recent first.
-- For each, also returns my outbound kind so the UI can render the right CTA
-- (e.g. "Connect back" vs "Connected").
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
  created_at        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  inbound as (
    select distinct on (c.from_profile)
           c.from_profile, c.kind, c.created_at
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
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
    i.created_at
  from inbound i
  join public.profiles p     on p.id = i.from_profile
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by i.created_at desc;
$$;

grant execute on function public.inbound_connections() to authenticated;

-- ---- 4. top_matches_detailed: add inbound flags ---------------------------
-- Drop+recreate to change return type.
drop function if exists public.top_matches_detailed(int);

create or replace function public.top_matches_detailed(p_limit int default 25)
returns table (
  profile_id        uuid,
  score             int,
  distance_mi       numeric,
  full_name         text,
  handle            text,
  bio               text,
  city              text,
  state             text,
  avatar_url        text,
  life_stage_id     text,
  life_stage_label  text,
  church_id         uuid,
  church_name       text,
  activities        jsonb,
  their_kind        public.connection_kind,  -- their outbound toward me
  my_kind           public.connection_kind,  -- my outbound toward them
  is_match          boolean
) language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
       base as (select * from public.top_matches(p_limit))
  select
    b.profile_id,
    b.score,
    b.distance_mi,
    p.full_name,
    p.handle::text,
    p.bio,
    p.city,
    p.state,
    p.avatar_url,
    p.life_stage_id,
    ls.label as life_stage_label,
    p.church_id,
    c.name   as church_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',         a.id,
          'label',      a.label,
          'icon',       a.icon,
          'icon_color', a.icon_color
        )
        order by a.sort_order
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb) as activities,
    (
      select kind from public.connections cn
      where cn.from_profile = p.id
        and cn.to_profile = (select id from me)
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as their_kind,
    (
      select kind from public.connections cn
      where cn.from_profile = (select id from me)
        and cn.to_profile = p.id
      order by case cn.kind when 'like' then 0 when 'wave' then 1 else 2 end
      limit 1
    )                                       as my_kind,
    (
      exists (
        select 1 from public.connections cn
        where cn.from_profile = (select id from me)
          and cn.to_profile = p.id
          and cn.kind = 'like'
      )
      and
      exists (
        select 1 from public.connections cn
        where cn.from_profile = p.id
          and cn.to_profile = (select id from me)
          and cn.kind = 'like'
      )
    )                                       as is_match
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int) to authenticated;
