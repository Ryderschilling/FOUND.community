-- =============================================================================
-- 0013_my_connections.sql
-- my_connections(): returns everyone the caller is *mutually* connected with
-- (both sides have kind='like'). This is the LinkedIn-style "Connected"
-- definition, used by the Profile screen's stat card + popup list.
--
-- Replaces the old "outbound likes" count, which was misleading after the
-- accept/decline flow shipped (it counted unaccepted requests as connections).
-- =============================================================================

create or replace function public.my_connections()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  connected_at      timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  -- For each outbound like of mine, find the reciprocal like from the other
  -- side. "connected_at" is the later of the two timestamps (when it became
  -- mutual).
  mutual as (
    select distinct on (c2.from_profile)
      c2.from_profile                          as other_id,
      greatest(c1.created_at, c2.created_at)   as connected_at
    from public.connections c1
    join public.connections c2
      on c1.to_profile   = c2.from_profile
     and c1.from_profile = c2.to_profile
     and c2.kind = 'like'
    where c1.from_profile = (select id from me)
      and c1.kind = 'like'
    order by c2.from_profile, connected_at desc
  )
  select
    p.id                            as profile_id,
    p.full_name,
    p.handle::text                  as handle,
    p.avatar_url,
    ls.label                        as life_stage_label,
    p.city,
    p.state,
    m.connected_at
  from mutual m
  join public.profiles p          on p.id = m.other_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by m.connected_at desc;
$$;

grant execute on function public.my_connections() to authenticated;
