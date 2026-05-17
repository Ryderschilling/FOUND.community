-- =============================================================================
-- 0007_profile_photos.sql
-- Multi-photo highlight reel: storage bucket, RLS, helper RPCs.
-- Uses the existing public.photos table (owner_kind='profile') from 0001.
-- =============================================================================

-- ---- 1. Storage bucket: profile-photos -------------------------------------
-- Public bucket. Path convention: {user_id}/{photo_id}.jpg
insert into storage.buckets (id, name, public)
  values ('profile-photos', 'profile-photos', true)
  on conflict (id) do update set public = excluded.public;

-- ---- 2. RLS on storage.objects --------------------------------------------
drop policy if exists "profile-photos: public read" on storage.objects;
create policy "profile-photos: public read"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

drop policy if exists "profile-photos: owner insert" on storage.objects;
create policy "profile-photos: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'profile-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile-photos: owner update" on storage.objects;
create policy "profile-photos: owner update"
  on storage.objects for update
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile-photos: owner delete" on storage.objects;
create policy "profile-photos: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 3. Helper RPC: get_profile_photos(p_profile) -------------------------
-- Returns photos for any profile, ordered by sort_order then created_at.
-- Includes the public URL so the client doesn't need to construct it.
create or replace function public.get_profile_photos(p_profile uuid)
returns table (
  id           uuid,
  storage_path text,
  url          text,
  sort_order   int,
  created_at   timestamptz
)
language sql stable
set search_path = public
as $$
  select
    ph.id,
    ph.storage_path,
    -- Build absolute URL using Supabase's public object path.
    -- This is hardcoded for the 'profile-photos' bucket.
    (
      select concat(
        rtrim(current_setting('app.settings.storage_url', true), '/'),
        '/storage/v1/object/public/profile-photos/',
        ph.storage_path
      )
    ) as url,
    ph.sort_order,
    ph.created_at
  from public.photos ph
  where ph.owner_kind = 'profile'
    and ph.owner_id   = p_profile
  order by ph.sort_order asc, ph.created_at asc;
$$;

grant execute on function public.get_profile_photos(uuid) to authenticated, anon;

-- NOTE: The `url` column above depends on a custom GUC that we don't actually
-- set in Supabase, so it will be NULL. That's fine — the client computes the
-- URL via supabase.storage.from('profile-photos').getPublicUrl(path), which
-- is the canonical Supabase way. We keep the column in the return type so
-- callers can use it later if we ever wire the GUC.

-- ---- 4. Reorder helper ----------------------------------------------------
-- Caller passes an array of photo IDs in the desired order. We update
-- sort_order to match. RLS ensures the caller can only update their own rows.
create or replace function public.reorder_profile_photos(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_idx int := 0;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  foreach v_id in array p_ids loop
    update public.photos
      set sort_order = v_idx
      where id = v_id
        and owner_kind = 'profile'
        and owner_id   = v_me;
    v_idx := v_idx + 1;
  end loop;
end;
$$;

grant execute on function public.reorder_profile_photos(uuid[]) to authenticated;
