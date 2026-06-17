-- =============================================================================
-- 0094_fix_church_admins_rls.sql
--
-- BUG: "infinite recursion detected in policy for relation church_admins"
--
-- ROOT CAUSE (two compounding issues):
--
--   1. church_admins SELECT policy self-references the same table:
--        using (user_id = auth.uid()
--               or church_id in (
--                 select church_id from church_admins where user_id = auth.uid()
--               ))
--      The sub-select re-enters the policy → infinite recursion.
--
--   2. churches UPDATE policy ("churches admin write") queries church_admins
--      directly instead of using the existing is_church_admin() security-definer
--      helper. Any direct table access from a policy re-triggers that table's
--      own RLS policies, cascading into the recursion above.
--
-- EFFECT: Every call that updates a church row (settings save, patch via
--         supabase-js .from('churches').update()) crashes with a 500 error.
--         Church admins cannot save their church profile.
--
-- FIX:
--   1. Simplify church_admins SELECT policy to user_id = auth.uid() only.
--      Admins see their own row — sufficient for all current dashboard queries.
--      (If co-admin listing is ever needed, use a security-definer function.)
--
--   2. Rewrite "churches admin write" UPDATE policy to call is_church_admin()
--      (already a security-definer function) so it bypasses RLS on church_admins.
--
-- Safe to re-run: uses DROP POLICY IF EXISTS throughout.
-- =============================================================================


-- =============================================================================
-- FIX 1: church_admins SELECT — remove self-referential sub-select
-- =============================================================================

drop policy if exists "church_admins select" on public.church_admins;

create policy "church_admins select" on public.church_admins
  for select using (user_id = auth.uid());


-- =============================================================================
-- FIX 2: churches UPDATE — use security-definer helper, not direct table scan
-- =============================================================================

drop policy if exists "churches admin write" on public.churches;

create policy "churches admin write" on public.churches
  for update using (public.is_church_admin(churches.id));


-- =============================================================================
-- VERIFY after applying:
--
--   -- Sign in as a church admin and run:
--   update public.churches set description = 'test' where id = '<your_church_id>';
--   -- Should succeed with no recursion error.
--
--   -- Confirm church_admins is readable:
--   select * from public.church_admins;  -- should return your row only
-- =============================================================================
