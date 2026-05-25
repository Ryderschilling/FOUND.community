-- ════════════════════════════════════════════════════════════════════════
-- FOUND — DATABASE HEALTH CHECK
-- Paste this WHOLE file into the Supabase SQL editor and hit Run.
-- Every row should show ✅. Failures (❌) and warnings (⚠️) sort to the top.
-- This checks STRUCTURE only (catalog-based, always safe to run).
-- For seed-data / row counts, run PART B at the bottom afterwards.
-- ════════════════════════════════════════════════════════════════════════

with
expected_tables(name) as (values
  ('profiles'),('churches'),('life_stages'),('activities'),('community_goals'),
  ('family_values'),('school_types'),('love_languages'),
  ('profile_activities'),('profile_goals'),('profile_values'),('photos'),
  ('groups'),('group_activities'),('group_members'),('group_posts'),
  ('group_join_requests'),('threads'),('thread_participants'),('messages'),
  ('connections'),('saved_profiles'),('notifications'),('push_tokens'),('reports')
),
expected_rpcs(name) as (values
  ('complete_onboarding'),('update_profile'),('get_profile_detail'),
  ('get_profile_photos'),('reorder_profile_photos'),('update_account_settings'),
  ('account_settings'),('top_matches'),('top_matches_detailed'),
  ('get_my_location'),('set_profile_location'),('set_location_by_id'),
  ('my_connections'),('inbound_connections'),('connection_status_with'),
  ('remove_connection'),('start_direct_thread'),('my_threads_detailed'),
  ('messageable_contacts'),('unread_messages_count'),('unread_inbound_count'),
  ('mark_inbound_seen'),('dismiss_inbound'),('dismiss_all_inbound'),
  ('create_group'),('update_group'),('delete_group'),('group_detail'),
  ('my_groups_feed'),('group_members_list'),('join_group'),('leave_group'),
  ('open_group_thread'),('remove_group_member'),('set_group_member_role'),
  ('is_group_admin'),('create_group_post'),('group_posts_feed'),
  ('delete_group_post'),('set_group_privacy'),('list_join_requests'),
  ('approve_join_request'),('decline_join_request'),('cancel_join_request'),
  ('list_notifications'),('unread_notification_count'),('mark_notifications_read'),
  ('register_push_token'),('unregister_push_token'),
  ('block_user'),('unblock_user'),('list_blocked_users'),('report_content'),
  ('delete_account'),
  ('admin_stats'),('admin_list_reports'),('admin_resolve_report'),
  ('admin_delete_message'),('admin_delete_group_post'),('admin_delete_group'),
  ('admin_suspend_user'),('admin_unsuspend_user'),('admin_delete_user'),
  ('admin_list_users'),('admin_list_groups')
),
expected_internal(name) as (values
  ('handle_new_user'),('set_updated_at'),('bump_group_member_count'),
  ('touch_thread_last_message'),('notify_on_message'),('notify_on_group_post'),
  ('notify_on_connection'),('push_on_notification'),('match_score'),
  ('is_thread_participant'),('is_group_member'),('_require_admin')
),
expected_triggers(name) as (values
  ('trg_on_auth_user_created'),('trg_touch_thread'),('trg_notify_message'),
  ('trg_notify_group_post'),('trg_notify_connection'),('trg_push_on_notification'),
  ('trg_group_member_count_ins'),('trg_group_member_count_del'),
  ('trg_profiles_updated_at'),('trg_groups_updated_at'),('trg_churches_updated_at')
),
expected_profile_cols(name) as (values
  ('notification_prefs'),('privacy_prefs'),('discovery_radius_miles'),
  ('is_admin'),('suspended'),('suspended_at'),('suspended_reason')
)
select * from (

  -- 1. TABLES (must exist + have RLS enabled)
  select '1. TABLE' as section, e.name as item,
    case
      when not exists (select 1 from pg_class c
        where c.relname = e.name and c.relnamespace = 'public'::regnamespace
          and c.relkind = 'r') then '❌ MISSING'
      when (select c.relrowsecurity from pg_class c
        where c.relname = e.name and c.relnamespace = 'public'::regnamespace)
        then '✅ ok (RLS on)'
      else '⚠️ exists but RLS OFF — data is public'
    end as status
  from expected_tables e

  union all
  -- 2. APP RPCs (functions the app calls directly)
  select '2. APP RPC', e.name,
    case when exists (select 1 from pg_proc p
      where p.proname = e.name and p.pronamespace = 'public'::regnamespace)
      then '✅ ok' else '❌ MISSING' end
  from expected_rpcs e

  union all
  -- 3. INTERNAL FUNCTIONS (back triggers + RLS policies)
  select '3. INTERNAL FN', e.name,
    case when exists (select 1 from pg_proc p
      where p.proname = e.name and p.pronamespace = 'public'::regnamespace)
      then '✅ ok' else '❌ MISSING' end
  from expected_internal e

  union all
  -- 4. TRIGGERS
  select '4. TRIGGER', e.name,
    case when exists (select 1 from pg_trigger tg
      where tg.tgname = e.name and not tg.tgisinternal)
      then '✅ ok' else '❌ MISSING' end
  from expected_triggers e

  union all
  -- 5. profiles COLUMNS added by later migrations
  select '5. profiles COLUMN', e.name,
    case when exists (select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'profiles'
        and c.column_name = e.name)
      then '✅ ok' else '❌ MISSING' end
  from expected_profile_cols e

  union all
  -- 6. EXTENSIONS
  select '6. EXTENSION', 'postgis (location features)',
    case when exists (select 1 from pg_extension where extname = 'postgis')
      then '✅ ok' else '❌ MISSING — Discover/location will fail' end
  union all
  select '6. EXTENSION', 'pgcrypto/uuid (id generation)',
    case when exists (select 1 from pg_extension
      where extname in ('pgcrypto','uuid-ossp'))
      then '✅ ok' else '⚠️ verify uuid generation works' end

  union all
  -- 7. ENUM sanity
  select '7. ENUM', 'connection_kind has "block" value',
    case when exists (select 1 from pg_enum en
      join pg_type t on t.oid = en.enumtypid
      where t.typname = 'connection_kind' and en.enumlabel = 'block')
      then '✅ ok' else '❌ block missing — block_user will fail' end

  union all
  -- 8. STORAGE buckets (photo / avatar uploads)
  select '8. STORAGE', 'buckets configured',
    case when (select count(*) from storage.buckets) > 0
      then '✅ ' || (select count(*) from storage.buckets)::text || ' bucket(s)'
      else '❌ NONE — photo upload will fail' end
  union all
  select '8. STORAGE BUCKET', b.name,
    '✅ ' || case when b.public then 'public' else 'private' end
  from storage.buckets b

) report
order by
  (status like '❌%') desc,
  (status like '⚠️%') desc,
  section, item;


-- ════════════════════════════════════════════════════════════════════════
-- PART B — SEED DATA CHECK
-- Run this SEPARATELY, only after PART A shows all tables ✅.
-- Onboarding reads these taxonomy tables; if any is empty, onboarding breaks.
-- ════════════════════════════════════════════════════════════════════════
-- select tbl, rows, status from (
--   select 'churches'        as tbl, count(*) as rows, case when count(*)>0 then '✅' else '❌ EMPTY' end as status from public.churches
--   union all select 'life_stages',     count(*), case when count(*)>0 then '✅' else '❌ EMPTY' end from public.life_stages
--   union all select 'activities',      count(*), case when count(*)>0 then '✅' else '❌ EMPTY' end from public.activities
--   union all select 'community_goals', count(*), case when count(*)>0 then '✅' else '❌ EMPTY' end from public.community_goals
--   union all select 'family_values',   count(*), case when count(*)>0 then '✅' else '❌ EMPTY' end from public.family_values
--   union all select 'school_types',    count(*), case when count(*)>0 then '✅' else '❌ EMPTY' end from public.school_types
--   union all select 'love_languages',  count(*), case when count(*)>0 then '✅' else '❌ EMPTY' end from public.love_languages
-- ) seed order by (status like '❌%') desc, tbl;
