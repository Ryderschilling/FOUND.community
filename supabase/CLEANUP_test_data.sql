-- =============================================================================
-- CLEANUP_test_data.sql  —  test / junk data purge
--
-- This file is in TWO halves:
--   PART 1  INSPECT  — read-only. Run it, look at the output, decide what is
--                      test data. Nothing is deleted.
--   PART 2  DELETE   — a template. Paste in the ids you confirmed are junk,
--                      then run. Destructive.
--
-- Run PART 1 first. Send the output back, or just eyeball it yourself — then
-- fill in PART 2. Do NOT run PART 2 blind.
--
-- (The admin panel's Users / Groups tabs show this same data with one-click
-- Delete buttons — fine for deleting a handful. Use the SQL below for bulk.)
-- =============================================================================


-- =============================================================================
-- PART 1 — INSPECT.  Read-only. Safe to run anytime.
-- =============================================================================

-- ---- 1a. All profiles, newest first, with junk signals --------------------
select
  p.id,
  p.full_name,
  p.handle,
  u.email,
  p.city,
  p.state,
  p.onboarding_complete,
  (p.location is not null)                                   as has_location,
  (select count(*) from public.connections c
     where c.from_profile = p.id or c.to_profile = p.id)     as connections,
  (select count(*) from public.messages m
     where m.sender_id = p.id)                               as messages_sent,
  (select count(*) from public.group_members gm
     where gm.profile_id = p.id)                             as groups_joined,
  p.created_at
from public.profiles p
left join auth.users u on u.id = p.id
order by p.created_at desc;

-- ---- 1b. All groups, newest first, with junk signals ----------------------
select
  g.id,
  g.name,
  g.description,
  o.full_name                                                as owner,
  g.member_count,
  (select count(*) from public.group_posts gp
     where gp.group_id = g.id)                               as posts,
  g.city,
  g.state,
  g.created_at
from public.groups g
left join public.profiles o on o.id = g.created_by
order by g.created_at desc;

-- ---- 1c. Quick suspects: groups that look like test data ------------------
--   tiny / empty groups, or names that look like keyboard mash.
select g.id, g.name, g.member_count, g.created_at
from public.groups g
where g.member_count <= 1
   or g.name ~* '(test|walkthrough|demo|asdf|qwer|rewf|xxx)'
order by g.created_at desc;

-- ---- 1d. Quick suspects: profiles that look like test data ----------------
--   never finished onboarding, no real activity.
select p.id, p.full_name, p.handle, p.created_at
from public.profiles p
where p.is_admin = false
  and (
        p.onboarding_complete = false
     or p.full_name is null
     or p.full_name ~* '(test|demo|asdf|qwer|rewf|xxx)'
  )
  and not exists (select 1 from public.connections c
                  where c.from_profile = p.id or c.to_profile = p.id)
  and not exists (select 1 from public.messages m where m.sender_id = p.id)
order by p.created_at desc;


-- =============================================================================
-- PART 2 — DELETE.  TEMPLATE. Destructive. Fill in confirmed ids, then run.
--
--   Deleting an auth.users row cascades to: profiles, connections, messages,
--   thread_participants, group_members, group_posts, reports, notifications,
--   push_tokens. Polymorphic `photos` rows have no FK — purged by hand below.
--   Deleting a groups row cascades its members, threads, messages, posts.
-- =============================================================================

-- ---- 2a. Delete junk GROUPS ------------------------------------------------
-- Replace the example ids with the real ones from query 1b / 1c.
/*
with junk_groups(id) as (
  values
    ('00000000-0000-0000-0000-000000000000'::uuid)   -- e.g. "rewf"
  -- ,('11111111-1111-1111-1111-111111111111'::uuid)  -- e.g. "Walkthrough Test Group"
)
-- polymorphic photo rows first (no FK to cascade them)
, _photos as (
  delete from public.photos
   where owner_kind = 'group'
     and owner_id in (select id from junk_groups)
  returning 1
)
delete from public.groups
 where id in (select id from junk_groups);
*/

-- ---- 2b. Delete junk PROFILES (full account cascade) -----------------------
-- Replace the example ids with the real ones from query 1a / 1d.
-- SAFETY: this query refuses to touch any profile where is_admin = true.
/*
with junk_profiles(id) as (
  values
    ('00000000-0000-0000-0000-000000000000'::uuid)
  -- ,('11111111-1111-1111-1111-111111111111'::uuid)
)
, safe as (   -- never delete an admin, even if listed by mistake
  select jp.id
  from junk_profiles jp
  join public.profiles p on p.id = jp.id
  where p.is_admin = false
)
-- profile photo rows (polymorphic)
, _pphotos as (
  delete from public.photos
   where owner_kind = 'profile' and owner_id in (select id from safe)
  returning 1
)
-- photo rows for groups those profiles OWN
, _gphotos as (
  delete from public.photos
   where owner_kind = 'group'
     and owner_id in (
       select gm.group_id from public.group_members gm
       where gm.profile_id in (select id from safe) and gm.role = 'owner'
     )
  returning 1
)
-- groups those profiles OWN (cascades members/threads/messages/posts)
, _groups as (
  delete from public.groups
   where id in (
     select gm.group_id from public.group_members gm
     where gm.profile_id in (select id from safe) and gm.role = 'owner'
   )
  returning 1
)
-- finally the auth user — cascades the rest
delete from auth.users
 where id in (select id from safe);
*/

-- =============================================================================
-- DONE.
-- =============================================================================
