-- =============================================================================
-- 0033_dismiss_all_inbound.sql
--
-- dismiss_all_inbound()
--   Soft-dismisses every pending inbound row for the calling user by setting
--   dismissed_at = now() on the connections rows. Mirrors dismiss_inbound()
--   but applies to all senders at once. Used by "Mark all read" on Activity.
-- =============================================================================

create or replace function public.dismiss_all_inbound()
returns void
language sql
security definer
set search_path = public
as $$
  update public.connections
  set dismissed_at = now()
  where to_profile   = auth.uid()
    and kind         in ('like', 'wave')
    and dismissed_at is null;
$$;

grant execute on function public.dismiss_all_inbound() to authenticated;
