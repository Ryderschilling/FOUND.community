-- =====================================================================
-- 0006_avatars.sql
-- Adds avatar support: profile column + public storage bucket + RLS.
-- =====================================================================

-- ---- 1. profiles.avatar_url -----------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;

-- ---- 2. Storage bucket: avatars -------------------------------------
-- Public bucket so we can serve URLs without signed-URL gymnastics.
-- File path convention: {user_id}/avatar.jpg
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = excluded.public;

-- ---- 3. RLS policies on storage.objects -----------------------------
-- Anyone (even anon) can READ — bucket is public.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Only the owner can INSERT/UPDATE/DELETE their own avatar files.
-- We enforce ownership by requiring the top-level folder of the path
-- to equal the user's auth.uid().
drop policy if exists "avatars: owner write" on storage.objects;
create policy "avatars: owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 4. Surface avatar_url in the matches feed ---------------------
-- top_matches_detailed must return avatar_url so the Discover feed and
-- MatchDetail screens can render real photos. We have to DROP the existing
-- function first because we're changing its return type (adding avatar_url) —
-- `create or replace function` cannot change a function's return signature.
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
  activities        jsonb
) language sql stable
set search_path = public
as $$
  with base as (
    select * from public.top_matches(p_limit)
  )
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
    ), '[]'::jsonb) as activities
  from base b
  join public.profiles p     on p.id = b.profile_id
  left join public.life_stages ls on ls.id = p.life_stage_id
  left join public.churches    c  on c.id  = p.church_id
  order by b.score desc, b.distance_mi nulls last;
$$;

grant execute on function public.top_matches_detailed(int) to authenticated;
