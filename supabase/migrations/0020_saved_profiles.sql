-- 0020_saved_profiles.sql
-- "Connect Later" — a PRIVATE saved list. Replaces the old "Wave" action.
--
-- Why a separate table (not a new connection_kind):
--   public.connections RLS lets the *recipient* read rows where they're the
--   target (to_profile = auth.uid()). Putting "saves" there would leak to the
--   saved person that they'd been saved. Connect Later must be private to the
--   saver, so it gets its own table with owner-only RLS.

create table if not exists public.saved_profiles (
  saver_id   uuid not null references public.profiles(id) on delete cascade,
  saved_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (saver_id, saved_id),
  check (saver_id <> saved_id)
);

-- Lookup by owner (the only access pattern) is already covered by the PK,
-- whose leading column is saver_id.

alter table public.saved_profiles enable row level security;

-- Owner-only: you can read, add, and remove ONLY your own saved rows.
drop policy if exists "saved_profiles read own" on public.saved_profiles;
create policy "saved_profiles read own" on public.saved_profiles
  for select using (saver_id = auth.uid());

drop policy if exists "saved_profiles write own" on public.saved_profiles;
create policy "saved_profiles write own" on public.saved_profiles
  for all using (saver_id = auth.uid()) with check (saver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Retire "Wave": the action is gone from the app. Purge any existing wave
-- rows so they stop surfacing in Activity inboxes. The 'wave' enum value is
-- left in connection_kind (Postgres can't drop enum values cleanly) — nothing
-- writes it anymore.
delete from public.connections where kind = 'wave';
