-- =============================================================================
-- 0038_admin_moderation.sql
-- Moderation backend for the admin web panel (admin.html).
--
-- WHY THIS EXISTS:
--   0036 created the `reports` table but its RLS only lets a user read their
--   OWN reports — there is no way to REVIEW reports. The Terms legally promise
--   reported content is actioned within 24h, so a reviewer surface is required.
--
-- DESIGN — no service-role key in the browser:
--   The admin panel logs in as a normal Supabase user. Every admin action goes
--   through a SECURITY DEFINER RPC that first checks `profiles.is_admin` for the
--   caller. A non-admin (or anon) calling any admin_* RPC gets "not authorized".
--   This means the panel only ever needs the public anon key — the same key the
--   app and website already ship. The service-role key never leaves Supabase.
--
-- Single-pass. Safe to run once on top of 0001..0037. Idempotent where possible.
--
-- Sections:
--   1.  Schema: is_admin + suspension columns on profiles
--   1b. Defensive guard: reports table (in case 0036 was never applied)
--   2.  _require_admin() guard helper
--   3.  admin_stats()            — dashboard counters
--   4.  admin_list_reports()     — the reviewer queue, with target previews
--   5.  admin_resolve_report()   — change a report's status
--   6.  admin_delete_message / admin_delete_group_post / admin_delete_group
--   7.  admin_suspend_user / admin_unsuspend_user
--   8.  admin_delete_user()      — nuclear: full account cascade for any profile
--   9.  admin_list_users / admin_list_groups — moderation + test-data cleanup
--   10. Make yourself an admin (commented — run once with your email)
-- =============================================================================


-- =============================================================================
-- 1. SCHEMA — admin flag + suspension state on profiles
--   suspended is enforced app-side (AuthContext): a suspended profile is bounced
--   to a "Account Suspended" screen on next load. Reversible via unsuspend.
-- =============================================================================
alter table public.profiles
  add column if not exists is_admin         boolean     not null default false,
  add column if not exists suspended        boolean     not null default false,
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_reason text;


-- =============================================================================
-- 1b. DEFENSIVE GUARD — reports table.
--   0036 created this. If 0036 was applied this whole block is a no-op. If it
--   was not, 0038 still stands on its own. (Migration drift is a known issue on
--   this DB — see the gotchas note about ad-hoc SQL-editor patching.)
-- =============================================================================
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('profile','message','group','group_post')),
  target_id   uuid not null,
  reason      text not null check (reason in ('spam','harassment','inappropriate','safety','fake','other')),
  details     text,
  status      text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_reports_status on public.reports (status, created_at desc);
create index if not exists idx_reports_target on public.reports (target_kind, target_id);
alter table public.reports enable row level security;


-- =============================================================================
-- 2. ADMIN GUARD
--   Raises 42501 (insufficient privilege) unless the caller is an admin.
--   Every admin_* RPC calls this as its first statement. SECURITY DEFINER so it
--   can read profiles.is_admin regardless of the caller's RLS.
-- =============================================================================
create or replace function public._require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not coalesce(
       (select p.is_admin from public.profiles p where p.id = auth.uid()),
       false
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._require_admin() from public;
grant execute on function public._require_admin() to authenticated;


-- =============================================================================
-- 3. admin_stats — counters for the panel header.
-- =============================================================================
create or replace function public.admin_stats()
returns table (
  open_reports     int,
  total_reports    int,
  total_users      int,
  suspended_users  int,
  total_groups     int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    (select count(*)::int from public.reports  where status = 'open'),
    (select count(*)::int from public.reports),
    (select count(*)::int from public.profiles),
    (select count(*)::int from public.profiles where suspended),
    (select count(*)::int from public.groups);
end;
$$;

revoke all on function public.admin_stats() from public;
grant execute on function public.admin_stats() to authenticated;


-- =============================================================================
-- 4. admin_list_reports — THE reviewer queue.
--   For every report it resolves the target into a human-readable preview so a
--   reviewer never has to go digging. target_id is polymorphic (no FK), so each
--   kind is LEFT JOINed separately and gated by target_kind.
--
--   target_owner_id is the profile RESPONSIBLE for the reported content
--   (the message sender / post author / group creator / the profile itself) —
--   so the panel can offer a one-click "suspend the offender" action.
--
--   target_exists tells the reviewer if the content is already gone (deleted by
--   the user, or by an earlier moderation action) — a report can outlive it.
-- =============================================================================
create or replace function public.admin_list_reports(p_status text default null)
returns table (
  report_id          uuid,
  created_at         timestamptz,
  status             text,
  reason             text,
  details            text,
  reporter_id        uuid,
  reporter_name      text,
  reporter_handle    text,
  target_kind        text,
  target_id          uuid,
  target_exists      boolean,
  target_label       text,
  target_preview     text,
  target_owner_id    uuid,
  target_owner_name  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  if p_status is not null
     and p_status not in ('open','reviewed','actioned','dismissed') then
    raise exception 'invalid status filter';
  end if;

  return query
  select
    r.id,
    r.created_at,
    r.status,
    r.reason,
    r.details,
    r.reporter_id,
    rp.full_name,
    rp.handle::text,
    r.target_kind,
    r.target_id,
    -- target_exists
    case r.target_kind
      when 'profile'    then (tp.id is not null)
      when 'message'    then (m.id  is not null)
      when 'group'      then (g.id  is not null)
      when 'group_post' then (gp.id is not null)
      else false
    end,
    -- target_label
    case r.target_kind
      when 'profile'    then coalesce(tp.full_name, '(deleted profile)')
      when 'message'    then 'Direct message'
      when 'group'      then coalesce(g.name, '(deleted group)')
      when 'group_post' then coalesce('Post in "' || gpg.name || '"', 'Group post')
      else r.target_kind
    end,
    -- target_preview
    case r.target_kind
      when 'profile'    then tp.bio
      when 'message'    then m.body
      when 'group'      then g.description
      when 'group_post' then gp.body
      else null
    end,
    -- target_owner_id  (who is responsible for the content)
    case r.target_kind
      when 'profile'    then tp.id
      when 'message'    then m.sender_id
      when 'group'      then g.created_by
      when 'group_post' then gp.author_id
      else null
    end,
    -- target_owner_name
    case r.target_kind
      when 'profile'    then tp.full_name
      when 'message'    then mo.full_name
      when 'group'      then go.full_name
      when 'group_post' then gpo.full_name
      else null
    end
  from public.reports r
  left join public.profiles    rp  on rp.id  = r.reporter_id
  left join public.profiles    tp  on r.target_kind = 'profile'    and tp.id  = r.target_id
  left join public.messages    m   on r.target_kind = 'message'    and m.id   = r.target_id
  left join public.profiles    mo  on mo.id  = m.sender_id
  left join public.groups      g   on r.target_kind = 'group'      and g.id   = r.target_id
  left join public.profiles    go  on go.id  = g.created_by
  left join public.group_posts gp  on r.target_kind = 'group_post' and gp.id  = r.target_id
  left join public.profiles    gpo on gpo.id = gp.author_id
  left join public.groups      gpg on gpg.id = gp.group_id
  where p_status is null or r.status = p_status
  order by
    case r.status when 'open' then 0 else 1 end,
    r.created_at desc;
end;
$$;

revoke all on function public.admin_list_reports(text) from public;
grant execute on function public.admin_list_reports(text) to authenticated;


-- =============================================================================
-- 5. admin_resolve_report — move a report through its lifecycle.
--   open -> reviewed (looked at, no action) / actioned (content removed or user
--   suspended) / dismissed (not a real violation). Reversible to 'open'.
-- =============================================================================
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_status not in ('open','reviewed','actioned','dismissed') then
    raise exception 'invalid status';
  end if;
  update public.reports set status = p_status where id = p_report_id;
  if not found then
    raise exception 'report not found';
  end if;
end;
$$;

revoke all on function public.admin_resolve_report(uuid, text) from public;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;


-- =============================================================================
-- 6. CONTENT REMOVAL
--   Each deletes the offending content. They do NOT auto-resolve the report —
--   the panel calls admin_resolve_report('actioned') right after, so the
--   reviewer stays in control of the report lifecycle.
-- =============================================================================

-- ---- delete a direct message -------------------------------------------------
create or replace function public.admin_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.messages where id = p_message_id;
end;
$$;
revoke all on function public.admin_delete_message(uuid) from public;
grant execute on function public.admin_delete_message(uuid) to authenticated;


-- ---- delete a group post -----------------------------------------------------
--   group_posts stores its image in a `photo_url` column (not the polymorphic
--   `photos` table), so there is no photos row to clean. The storage object, if
--   any, is left orphaned — not leaked data, just an unreferenced file.
create or replace function public.admin_delete_group_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.group_posts where id = p_post_id;
end;
$$;
revoke all on function public.admin_delete_group_post(uuid) from public;
grant execute on function public.admin_delete_group_post(uuid) to authenticated;


-- ---- delete an entire group --------------------------------------------------
--   Cascades members, threads, messages, posts, activities via FKs. Polymorphic
--   `photos` rows for the group have no FK, so they are cleaned by hand first —
--   same pattern as delete_account() in 0036.
create or replace function public.admin_delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.photos
   where owner_kind = 'group' and owner_id = p_group_id;
  delete from public.groups where id = p_group_id;
end;
$$;
revoke all on function public.admin_delete_group(uuid) from public;
grant execute on function public.admin_delete_group(uuid) to authenticated;


-- =============================================================================
-- 7. USER SUSPENSION — the normal, reversible moderation action.
--   Sets the suspended flag; enforcement is app-side (AuthContext bounces a
--   suspended profile to the "Account Suspended" screen). Cannot suspend an
--   admin (prevents a compromised/rogue admin locking out another).
-- =============================================================================
create or replace function public.admin_suspend_user(
  p_profile_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_profile_id is null then raise exception 'no target'; end if;
  if coalesce((select is_admin from public.profiles where id = p_profile_id), false) then
    raise exception 'cannot suspend an admin';
  end if;
  update public.profiles
     set suspended        = true,
         suspended_at     = now(),
         suspended_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_profile_id;
  if not found then raise exception 'profile not found'; end if;
end;
$$;
revoke all on function public.admin_suspend_user(uuid, text) from public;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated;


create or replace function public.admin_unsuspend_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.profiles
     set suspended        = false,
         suspended_at     = null,
         suspended_reason = null
   where id = p_profile_id;
  if not found then raise exception 'profile not found'; end if;
end;
$$;
revoke all on function public.admin_unsuspend_user(uuid) from public;
grant execute on function public.admin_unsuspend_user(uuid) to authenticated;


-- =============================================================================
-- 8. admin_delete_user — nuclear option. Full account cascade for ANY profile.
--   Mirrors delete_account() from 0036 but targets an arbitrary profile. Use
--   for confirmed bad actors and for purging junk/test accounts. Irreversible.
--   Refuses to delete an admin.
-- =============================================================================
create or replace function public.admin_delete_user(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_profile_id is null then raise exception 'no target'; end if;
  if coalesce((select is_admin from public.profiles where id = p_profile_id), false) then
    raise exception 'cannot delete an admin account';
  end if;

  -- Profile photo rows (polymorphic table, no FK to profiles).
  delete from public.photos
   where owner_kind = 'profile' and owner_id = p_profile_id;

  -- Groups this user owns: purge polymorphic photo rows, then the groups.
  delete from public.photos
   where owner_kind = 'group'
     and owner_id in (
       select gm.group_id from public.group_members gm
       where gm.profile_id = p_profile_id and gm.role = 'owner'
     );
  delete from public.groups
   where id in (
     select gm.group_id from public.group_members gm
     where gm.profile_id = p_profile_id and gm.role = 'owner'
   );

  -- Remove the auth user. FK cascades auth.users -> profiles -> everything else.
  delete from auth.users where id = p_profile_id;
end;
$$;
revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- =============================================================================
-- 9. LISTING RPCs — power the Users and Groups tabs of the panel.
--   Also the fastest way to eyeball junk/test data for cleanup.
-- =============================================================================
create or replace function public.admin_list_users()
returns table (
  profile_id          uuid,
  full_name           text,
  handle              text,
  email               text,
  city                text,
  state               text,
  onboarding_complete boolean,
  suspended           boolean,
  is_admin            boolean,
  report_count        int,
  created_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    p.id,
    p.full_name,
    p.handle::text,
    u.email::text,
    p.city,
    p.state,
    p.onboarding_complete,
    p.suspended,
    p.is_admin,
    (select count(*)::int from public.reports r
       where r.target_kind = 'profile' and r.target_id = p.id),
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;


create or replace function public.admin_list_groups()
returns table (
  group_id     uuid,
  name         text,
  description  text,
  city         text,
  state        text,
  created_by   uuid,
  owner_name   text,
  member_count int,
  is_public    boolean,
  report_count int,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  return query
  select
    g.id,
    g.name,
    g.description,
    g.city,
    g.state,
    g.created_by,
    o.full_name,
    g.member_count,
    g.is_public,
    (select count(*)::int from public.reports r
       where r.target_kind = 'group' and r.target_id = g.id),
    g.created_at
  from public.groups g
  left join public.profiles o on o.id = g.created_by
  order by g.created_at desc;
end;
$$;
revoke all on function public.admin_list_groups() from public;
grant execute on function public.admin_list_groups() to authenticated;


-- Force PostgREST to pick up the new functions + column immediately.
notify pgrst, 'reload schema';


-- =============================================================================
-- 10. MAKE YOURSELF AN ADMIN  —  RUN THIS ONCE, SEPARATELY.
--   Uncomment, set your FOUND login email, run it. Until you do, every admin_*
--   RPC returns "not authorized" — including for you.
-- =============================================================================
-- update public.profiles set is_admin = true
--  where id = (select id from auth.users where lower(email) = lower('you@example.com'));

-- =============================================================================
-- DONE.
-- =============================================================================
