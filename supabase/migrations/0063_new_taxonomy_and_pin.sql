-- =============================================================================
-- 0063_new_taxonomy_and_pin.sql
--
-- 1. Adds "Single Parent" life stage and "I'm not sure" love language to DB
-- 2. Adds pinned_at to connections table
-- 3. Updates my_connections() to return pinned_at (preserves all 0061 logic)
-- 4. Adds pin_connection / unpin_connection RPCs
-- =============================================================================


-- ── 1. New taxonomy rows ─────────────────────────────────────────────────────

insert into public.life_stages (id, label, icon, icon_color, sort_order, has_kids)
values ('single-parent', 'Single Parent', 'person-circle-outline', '#7A5AA8', 10, false)
on conflict (id) do update
  set label      = excluded.label,
      icon       = excluded.icon,
      icon_color = excluded.icon_color,
      sort_order = excluded.sort_order;

insert into public.love_languages (id, label, icon, icon_color, sort_order)
values ('not-sure', 'I''m not sure', 'help-circle-outline', '#999999', 6)
on conflict (id) do update
  set label      = excluded.label,
      icon       = excluded.icon,
      icon_color = excluded.icon_color,
      sort_order = excluded.sort_order;


-- ── 2. Pin column on connections ─────────────────────────────────────────────

alter table public.connections
  add column if not exists pinned_at timestamptz default null;


-- ── 3. my_connections() — add pinned_at, preserve all 0061 logic ─────────────

drop function if exists public.my_connections();

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  bio               text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz,
  pinned_at         timestamptz,
  score             int,
  activities        jsonb
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at,
      c1.pinned_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
      and not exists (
        select 1 from public.connections b
        where b.kind = 'block'
          and (
            (b.from_profile = (select id from me) and b.to_profile = c2.from_profile)
            or (b.from_profile = c2.from_profile and b.to_profile = (select id from me))
          )
      )
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.bio,
    p.avatar_url,
    ls.label                        as life_stage_label,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.city else null end  as city,
    case when coalesce((p.privacy_prefs ->> 'show_location')::boolean, true)
         then p.state else null end as state,
    m.connected_at,
    m.pinned_at,
    public.match_score((select id from me), p.id) as score,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.id, 'label', a.label)
        order by a.label
      )
      from public.profile_activities pa
      join public.activities a on a.id = pa.activity_id
      where pa.profile_id = p.id
    ), '[]'::jsonb)                 as activities
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by
    m.pinned_at desc nulls last,
    m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;


-- ── 4. pin_connection / unpin_connection ─────────────────────────────────────

create or replace function public.pin_connection(p_profile uuid)
returns void
language sql
set search_path = public
as $$
  update public.connections
  set pinned_at = now()
  where from_profile = auth.uid()
    and to_profile   = p_profile
    and kind         = 'like';
$$;

grant execute on function public.pin_connection(uuid) to authenticated;

create or replace function public.unpin_connection(p_profile uuid)
returns void
language sql
set search_path = public
as $$
  update public.connections
  set pinned_at = null
  where from_profile = auth.uid()
    and to_profile   = p_profile
    and kind         = 'like';
$$;

grant execute on function public.unpin_connection(uuid) to authenticated;
