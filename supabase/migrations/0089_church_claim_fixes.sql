-- =============================================================================
-- 0088_church_claim_fixes.sql
--
-- Fixes two bugs in the church claim flow:
--
--   BUG 1: add_and_claim_church had no dedup logic.
--     If a user submitted a church request (creating id=AAA), then a church
--     admin ran "Add my church" with the same name+city, a second record
--     id=BBB was created. Users were linked to AAA, admin owned BBB → 0 members
--     in the dashboard.
--     FIX: check for existing unclaimed church by name+city first. If found,
--     claim it. Only insert a new record if no match exists.
--
--   BUG 2: Neither claim_church nor add_and_claim_church set profiles.church_id
--     for the admin themselves.
--     FIX: after claiming, set profiles.church_id = church_id for auth.uid().
--     This ensures the admin shows up as a member in their own dashboard.
-- =============================================================================

-- ---------- RPC: claim_church (patched) --------------------------------------
create or replace function public.claim_church(p_church_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Only allow if unclaimed
  if exists (
    select 1 from public.churches where id = p_church_id and claimed_by is not null
  ) then
    raise exception 'Church already claimed';
  end if;

  update public.churches set
    claimed_by          = v_uid,
    claimed_at          = now(),
    subscription_status = 'trialing',
    trial_ends_at       = now() + interval '30 days'
  where id = p_church_id;

  insert into public.church_admins (church_id, user_id, role)
    values (p_church_id, v_uid, 'owner')
    on conflict do nothing;

  -- FIX BUG 2: link the admin's own profile to this church so they appear
  -- as a member in church_members_list and community health stats.
  update public.profiles
  set church_id = p_church_id
  where id = v_uid;
end;
$$;

grant execute on function public.claim_church(uuid) to authenticated;


-- ---------- RPC: add_and_claim_church (patched) ------------------------------
create or replace function public.add_and_claim_church(
  p_name     text,
  p_city     text,
  p_state    text,
  p_address  text default null,
  p_zip      text default null,
  p_website  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- FIX BUG 1: check for an existing unclaimed church with the same name+city
  -- before creating a new record. This prevents duplicate church IDs when a
  -- user already submitted a church request and an admin then tries to add it.
  select id into v_id
  from public.churches
  where lower(name) = lower(btrim(p_name))
    and lower(coalesce(city, '')) = lower(btrim(coalesce(p_city, '')))
    and claimed_by is null
  limit 1;

  if v_id is not null then
    -- Existing unclaimed record found — claim it and patch any missing fields.
    update public.churches set
      claimed_by          = v_uid,
      claimed_at          = now(),
      subscription_status = 'trialing',
      trial_ends_at       = now() + interval '30 days',
      -- Only fill in missing optional fields; don't overwrite existing data.
      state   = coalesce(state,   nullif(btrim(coalesce(p_state,'')),   '')),
      address = coalesce(address, nullif(btrim(coalesce(p_address,'')), '')),
      zip     = coalesce(zip,     nullif(btrim(coalesce(p_zip,'')),     '')),
      website = coalesce(website, nullif(btrim(coalesce(p_website,'')), ''))
    where id = v_id;
  else
    -- No matching church — create a fresh record.
    insert into public.churches (name, city, state, address, zip, website,
                                  claimed_by, claimed_at,
                                  subscription_status, trial_ends_at)
    values (btrim(p_name), btrim(p_city), btrim(p_state),
            nullif(btrim(coalesce(p_address,'')), ''),
            nullif(btrim(coalesce(p_zip,'')),     ''),
            nullif(btrim(coalesce(p_website,'')), ''),
            v_uid, now(), 'trialing', now() + interval '30 days')
    returning id into v_id;
  end if;

  insert into public.church_admins (church_id, user_id, role)
    values (v_id, v_uid, 'owner')
    on conflict do nothing;

  -- FIX BUG 2: link the admin's own profile to this church.
  update public.profiles
  set church_id = v_id
  where id = v_uid;

  return v_id;
end;
$$;

grant execute on function public.add_and_claim_church(text,text,text,text,text,text) to authenticated;

-- =============================================================================
-- DONE.
-- To verify after applying:
--   1. select * from public.churches where subscription_status = 'trialing';
--   2. select church_id from public.profiles where id = '<admin_user_id>';
--      → should match the church they just claimed.
--   3. select * from church_members_list('<church_id>', 100, 0);
--      → admin should appear as a member.
-- =============================================================================
