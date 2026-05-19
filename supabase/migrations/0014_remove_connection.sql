-- =============================================================================
-- 0014_remove_connection.sql
-- Lets the caller un-do a connect or a wave they sent.
--
-- remove_connection(p_other, p_kind)
--   - p_kind = 'like'  → cancels a pending request OR disconnects a mutual match
--   - p_kind = 'wave'  → cancels a wave
--   - p_kind = null    → removes ALL my outbound connections to that person
--                        (like + wave). Use this for a single "undo everything" tap.
--
-- Only ever deletes rows where from_profile = auth.uid(); enforced by both the
-- WHERE clause and RLS.
-- =============================================================================

create or replace function public.remove_connection(p_other uuid, p_kind public.connection_kind default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_other is null then raise exception 'p_other required'; end if;

  if p_kind is null then
    delete from public.connections
    where from_profile = v_me
      and to_profile   = p_other
      and kind in ('like','wave');
  else
    delete from public.connections
    where from_profile = v_me
      and to_profile   = p_other
      and kind         = p_kind;
  end if;
end;
$$;

grant execute on function public.remove_connection(uuid, public.connection_kind) to authenticated;
