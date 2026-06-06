-- =============================================================================
-- 0078_filming_editing_and_church_connections.sql
--
-- 1) Add "Filming & Editing" to the activities taxonomy.
-- 2) Update my_connections() to return church_id + church_name so the
--    FOUND tab can filter connections by "My Church".
--
-- Run after 0077.
-- =============================================================================

-- ── 1. New activity ──────────────────────────────────────────────────────────

insert into public.activities (id, label, icon, icon_color, sort_order)
values ('filming-editing', 'Filming & Editing', 'videocam-outline', '#1A1A1A', 125)
on conflict (id) do update
  set label      = excluded.label,
      icon       = excluded.icon,
      icon_color = excluded.icon_color,
      sort_order = excluded.sort_order;


-- ── 2. my_connections() — add church_id + church_name ────────────────────────

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
  activities        jsonb,
  church_id         uuid,
  church_name       text
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
    ), '[]'::jsonb)                 as activities,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then p.church_id else null end as church_id,
    case when coalesce((p.privacy_prefs ->> 'show_church')::boolean, true)
         then ch.name else null end     as church_name
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches     ch on ch.id = p.church_id
  order by m.pinned_at desc nulls last, m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;

-- =============================================================================
-- DONE.
-- Verify:
--   select id, label from activities where id = 'filming-editing';
--   select church_id, church_name from my_connections() limit 5;
-- =============================================================================
