-- ─────────────────────────────────────────────────────────────────────────
-- 0072 · Add website_url to groups
-- Adds an optional URL field (e.g. church site, Eventbrite, etc.)
-- Updates group_detail() and update_group() to expose it.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.groups
  add column if not exists website_url text;

-- ── group_detail: expose website_url ─────────────────────────────────────
-- Must drop first — Postgres won't replace a function with a different return type.

drop function if exists public.group_detail(uuid);

create or replace function public.group_detail(p_group uuid)
returns table (
  id                  uuid,
  name                text,
  description         text,
  icon                text,
  icon_color          text,
  icon_bg             text,
  city                text,
  state               text,
  address             text,
  schedule_text       text,
  member_count        int,
  church_id           uuid,
  created_by          uuid,
  cover_path          text,
  created_at          timestamptz,
  is_public           boolean,
  is_member           boolean,
  my_role             text,
  has_pending_request boolean,
  has_pending_invite  boolean,
  website_url         text
)
language sql stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.icon, g.icon_color, g.icon_bg,
    g.city, g.state,
    case when exists(select 1 from public.group_members gm
                     where gm.group_id=g.id and gm.profile_id=auth.uid())
         then g.address else null end as address,
    g.schedule_text, g.member_count, g.church_id, g.created_by,
    (select ph.storage_path from public.photos ph
     where ph.owner_kind='group' and ph.owner_id=g.id
     order by ph.sort_order asc, ph.created_at asc limit 1) as cover_path,
    g.created_at,
    g.is_public,
    exists(select 1 from public.group_members gm
           where gm.group_id=g.id and gm.profile_id=auth.uid()) as is_member,
    (select gm.role::text from public.group_members gm
     where gm.group_id=g.id and gm.profile_id=auth.uid()) as my_role,
    exists(select 1 from public.group_join_requests r
           where r.group_id=g.id and r.profile_id=auth.uid()) as has_pending_request,
    exists(select 1 from public.group_invites gi
           where gi.group_id=g.id and gi.invitee_id=auth.uid()
             and gi.status='pending') as has_pending_invite,
    g.website_url
  from public.groups g
  where g.id = p_group;
$$;

-- ── update_group: accept website_url ─────────────────────────────────────

create or replace function public.update_group(
  p_group         uuid,
  p_name          text,
  p_description   text default null,
  p_city          text default null,
  p_state         text default null,
  p_schedule_text text default null,
  p_lat           double precision default null,
  p_lng           double precision default null,
  p_website_url   text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_group_admin(p_group) then
    raise exception 'only the owner or an admin can edit this group';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'group name required';
  end if;

  update public.groups set
    name          = btrim(p_name),
    description   = nullif(btrim(coalesce(p_description,'')),''),
    city          = nullif(btrim(coalesce(p_city,'')),''),
    state         = nullif(btrim(coalesce(p_state,'')),''),
    schedule_text = nullif(btrim(coalesce(p_schedule_text,'')),''),
    website_url   = nullif(btrim(coalesce(p_website_url,'')),''),
    location      = case when p_lat is not null and p_lng is not null
                         then ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
                         else location end
  where id = p_group;
end;
$$;
