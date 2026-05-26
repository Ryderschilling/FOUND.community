-- ─────────────────────────────────────────────────────────────────────────
-- 0040_csam_incidents.sql
--
-- Schema support for the Thorn Safer photo-scanning Edge Function.
--
--   * adds scan-state columns to public.photos
--   * creates a private quarantine storage bucket
--   * creates the csam_incidents table (admin-only RLS)
--
-- Runs after migration 0039.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Scan-state on photos -----------------------------------------------------

alter table public.photos
  add column if not exists scanned boolean not null default false,
  add column if not exists scanned_at timestamptz;

create index if not exists photos_unscanned_idx
  on public.photos (created_at)
  where scanned = false;

-- 2. Quarantine bucket --------------------------------------------------------

insert into storage.buckets (id, name, public)
  values ('quarantine', 'quarantine', false)
  on conflict (id) do nothing;

-- Deny-all RLS on quarantine bucket — only service role can touch it.
drop policy if exists "quarantine deny all"   on storage.objects;
create policy "quarantine deny all"
  on storage.objects
  as restrictive
  for all
  to authenticated, anon
  using ( bucket_id <> 'quarantine' )
  with check ( bucket_id <> 'quarantine' );

-- 3. Incident table -----------------------------------------------------------

create table if not exists public.csam_incidents (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  bucket_id             text not null,
  storage_path          text not null,
  profile_id            uuid references public.profiles(id) on delete set null,
  thorn_match_id        text,
  reported_to_ncmec     boolean not null default false,
  cybertip_id           text,
  notes                 text
);

alter table public.csam_incidents enable row level security;

drop policy if exists "csam_incidents admin read"  on public.csam_incidents;
drop policy if exists "csam_incidents admin write" on public.csam_incidents;

-- Only platform admins can read or write this table from a client.
-- The Edge Function uses the service role and bypasses RLS entirely.
create policy "csam_incidents admin read"
  on public.csam_incidents
  for select
  to authenticated
  using ( public._require_admin() );

create policy "csam_incidents admin write"
  on public.csam_incidents
  for all
  to authenticated
  using ( public._require_admin() )
  with check ( public._require_admin() );

create index if not exists csam_incidents_profile_idx
  on public.csam_incidents (profile_id);
create index if not exists csam_incidents_open_idx
  on public.csam_incidents (created_at)
  where reported_to_ncmec = false;

comment on table public.csam_incidents is
  'Auto-quarantined CSAM matches from Thorn Safer. Preserved per 18 U.S.C. § 2258A.';
