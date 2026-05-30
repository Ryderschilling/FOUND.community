-- =============================================================================
-- 0056_denomination.sql
--
-- 1) Creates `denominations` reference table (same pattern as school_types).
-- 2) Adds `denomination_id` FK to profiles.
-- 3) Seeds 13 common denominations.
-- 4) Enables RLS + public read policy.
-- 5) Rewrites `complete_onboarding` to accept `p_denomination_id`.
-- 6) Adds denomination exact-match (+10) to match_score.
--    Total possible: 120, clamped to 100.
--
-- Idempotent. Safe to re-run.
-- Run AFTER 0055_match_score_overhaul.sql.
-- =============================================================================

-- ─── 1) Reference table ──────────────────────────────────────────────────────
create table if not exists public.denominations (
  id          text primary key,
  label       text not null,
  icon        text not null default 'business-outline',
  icon_color  text not null default '#1A1A1A',
  sort_order  int  not null default 0
);

-- ─── 2) Column on profiles ───────────────────────────────────────────────────
alter table public.profiles
  add column if not exists denomination_id text
  references public.denominations(id) on delete set null;

create index if not exists idx_profiles_denomination on public.profiles (denomination_id);

-- ─── 3) Seed denominations ───────────────────────────────────────────────────
insert into public.denominations (id, label, icon, icon_color, sort_order) values
  ('non-denom',       'Non-Denominational',     'infinite-outline',        '#1A1A1A', 10),
  ('baptist',         'Baptist',                'book-outline',            '#1A1A1A', 20),
  ('methodist',       'Methodist',              'heart-outline',           '#1A1A1A', 30),
  ('presbyterian',    'Presbyterian',           'library-outline',         '#1A1A1A', 40),
  ('lutheran',        'Lutheran',               'leaf-outline',            '#1A1A1A', 50),
  ('catholic',        'Catholic',               'business-outline',        '#1A1A1A', 60),
  ('anglican',        'Anglican / Episcopal',   'navigate-outline',        '#1A1A1A', 70),
  ('pentecostal',     'Pentecostal / Charismatic','flame-outline',         '#1A1A1A', 80),
  ('assemblies',      'Assemblies of God',      'people-outline',          '#1A1A1A', 90),
  ('church-of-christ','Church of Christ',       'home-outline',            '#1A1A1A', 100),
  ('reformed',        'Reformed / Calvinist',   'shield-outline',          '#1A1A1A', 110),
  ('evangelical',     'Evangelical Free',       'star-outline',            '#1A1A1A', 120),
  ('other',           'Other',                  'ellipsis-horizontal-outline','#1A1A1A', 999)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order;

-- ─── 4) RLS ──────────────────────────────────────────────────────────────────
alter table public.denominations enable row level security;

drop policy if exists denominations_public_read on public.denominations;
create policy denominations_public_read
  on public.denominations for select
  to authenticated
  using (true);

-- ─── 5) complete_onboarding (new signature with denomination) ────────────────
drop function if exists public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[], integer
);

create or replace function public.complete_onboarding(
  p_life_stage      text,
  p_school_type     text,
  p_love_language   text,
  p_church_id       uuid,
  p_city            text,
  p_state           text,
  p_is_initiator    boolean,
  p_is_outgoing     boolean,
  p_activities      text[],
  p_goals           text[],
  p_values          text[],
  p_political_lean  integer default null,
  p_denomination_id text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles set
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = p_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    political_lean      = p_political_lean,
    denomination_id     = p_denomination_id,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x
    on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x
    on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x
    on conflict do nothing;
  end if;
end;
$$;

grant execute on function public.complete_onboarding(
  text, text, text, uuid, text, text, boolean, boolean, text[], text[], text[], integer, text
) to authenticated;

-- ─── 6) match_score — add denomination alignment ─────────────────────────────
-- Adds +10 for exact denomination match on top of 0055 weights.
-- Max possible: 120, clamped to 100. No change to other signals.

create or replace function public.match_score(viewer uuid, candidate uuid)
returns int language plpgsql stable as $$
declare
  v_lifestage   text;
  c_lifestage   text;
  v_hometown    text;
  c_hometown    text;
  v_political   integer;
  c_political   integer;
  v_denom       text;
  c_denom       text;
  shared_acts   int;
  total_acts    int;
  shared_goals  int;
  total_goals   int;
  shared_vals   int;
  total_vals    int;
  parent_stages text[] := ARRAY[
    'married-babies', 'married-young', 'married-teens', 'married-mixed'
  ];
  political_diff numeric;
  score         int := 0;
begin
  if viewer = candidate then return 100; end if;

  select life_stage_id, hometown, political_lean, denomination_id
    into v_lifestage, v_hometown, v_political, v_denom
    from public.profiles where id = viewer;

  select life_stage_id, hometown, political_lean, denomination_id
    into c_lifestage, c_hometown, c_political, c_denom
    from public.profiles where id = candidate;

  -- ── Activities (Jaccard × 30) ─────────────────────────────────────────────
  select count(*) into shared_acts
    from public.profile_activities pa1
    join public.profile_activities pa2 on pa1.activity_id = pa2.activity_id
    where pa1.profile_id = viewer and pa2.profile_id = candidate;
  select count(distinct activity_id) into total_acts
    from public.profile_activities
    where profile_id in (viewer, candidate);
  if total_acts > 0 then
    score := score + (shared_acts::numeric / total_acts * 30)::int;
  end if;

  -- ── Goals (Jaccard × 25) ──────────────────────────────────────────────────
  select count(*) into shared_goals
    from public.profile_goals pg1
    join public.profile_goals pg2 on pg1.goal_id = pg2.goal_id
    where pg1.profile_id = viewer and pg2.profile_id = candidate;
  select count(distinct goal_id) into total_goals
    from public.profile_goals
    where profile_id in (viewer, candidate);
  if total_goals > 0 then
    score := score + (shared_goals::numeric / total_goals * 25)::int;
  end if;

  -- ── Life stage (20 exact | 8 parent-tier partial) ─────────────────────────
  if v_lifestage is not null and v_lifestage = c_lifestage then
    score := score + 20;
  elsif v_lifestage = any(parent_stages) and c_lifestage = any(parent_stages) then
    score := score + 8;
  end if;

  -- ── Family values (Jaccard × 15) ──────────────────────────────────────────
  select count(*) into shared_vals
    from public.profile_values pv1
    join public.profile_values pv2 on pv1.value_id = pv2.value_id
    where pv1.profile_id = viewer and pv2.profile_id = candidate;
  select count(distinct value_id) into total_vals
    from public.profile_values
    where profile_id in (viewer, candidate);
  if total_vals > 0 then
    score := score + (shared_vals::numeric / total_vals * 15)::int;
  end if;

  -- ── Hometown (+10) ────────────────────────────────────────────────────────
  if v_hometown is not null and c_hometown is not null
     and length(btrim(v_hometown)) > 0
     and lower(btrim(v_hometown)) = lower(btrim(c_hometown)) then
    score := score + 10;
  end if;

  -- ── Political lean (+0–10, optional) ─────────────────────────────────────
  if v_political is not null and c_political is not null then
    political_diff := abs(v_political - c_political);
    score := score + greatest(0, round(10.0 * (1.0 - political_diff / 200.0)))::int;
  end if;

  -- ── Denomination exact match (+10, optional) ──────────────────────────────
  -- Only fires when both answered. 'other' vs 'other' still counts.
  if v_denom is not null and c_denom is not null and v_denom = c_denom then
    score := score + 10;
  end if;

  return greatest(0, least(100, score));
end $$;

-- =============================================================================
-- DONE.
-- Verify:
--   select id, label from public.denominations order by sort_order;   -- 13 rows
--   select column_name from information_schema.columns
--     where table_name = 'profiles' and column_name = 'denomination_id';
-- =============================================================================
