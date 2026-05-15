-- =============================================================================
-- seed-profiles.sql
-- Idempotent dev-only seed: 25 fake profiles with realistic life stages,
-- activities, goals, values, and churches.
--
-- Run from the Supabase SQL editor (executes as the postgres superuser,
-- which is what allows direct inserts into auth.users).
--
-- Re-running this file UPSERTS — existing seed users (looked up by email)
-- are updated in place; no duplicates created.
--
-- Companion to scripts/seed-profiles.js (which uses the official Admin API
-- and is preferable when you have the service-role key handy).
-- =============================================================================

-- ─── Session-scoped helper function ─────────────────────────────────────
create or replace function pg_temp.seed_profile(
  p_email          text,
  p_handle         text,
  p_full_name      text,
  p_bio            text,
  p_life_stage     text,
  p_school_type    text,
  p_love_language  text,
  p_church_name    text,
  p_city           text,
  p_state          text,
  p_is_initiator   boolean,
  p_is_outgoing    boolean,
  p_activities     text[],
  p_goals          text[],
  p_values         text[]
) returns void language plpgsql as $$
declare
  v_uid       uuid;
  v_church_id uuid;
begin
  -- Find or create the auth user (idempotent on email)
  select id into v_uid from auth.users where email = p_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid, 'authenticated', 'authenticated',
      p_email,
      crypt('Seed!FoundDev2026', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name),
      now(), now(),
      '', '', '', ''
    );
    -- handle_new_user trigger fires and creates public.profiles row
  end if;

  if p_church_name is not null then
    select id into v_church_id from public.churches where name = p_church_name limit 1;
  end if;

  -- Safety net: ensure profile row exists even if the trigger didn't fire
  insert into public.profiles (id, full_name)
  values (v_uid, p_full_name)
  on conflict (id) do nothing;

  update public.profiles set
    handle              = p_handle,
    full_name           = p_full_name,
    bio                 = p_bio,
    life_stage_id       = p_life_stage,
    school_type_id      = p_school_type,
    love_language_id    = p_love_language,
    church_id           = v_church_id,
    city                = p_city,
    state               = p_state,
    is_initiator        = p_is_initiator,
    is_outgoing         = p_is_outgoing,
    onboarding_complete = true,
    last_active_at      = now()
  where id = v_uid;

  -- Replace M:M rows
  delete from public.profile_activities where profile_id = v_uid;
  if p_activities is not null and array_length(p_activities, 1) is not null then
    insert into public.profile_activities (profile_id, activity_id)
    select v_uid, x from unnest(p_activities) as x on conflict do nothing;
  end if;

  delete from public.profile_goals where profile_id = v_uid;
  if p_goals is not null and array_length(p_goals, 1) is not null then
    insert into public.profile_goals (profile_id, goal_id)
    select v_uid, x from unnest(p_goals) as x on conflict do nothing;
  end if;

  delete from public.profile_values where profile_id = v_uid;
  if p_values is not null and array_length(p_values, 1) is not null then
    insert into public.profile_values (profile_id, value_id)
    select v_uid, x from unnest(p_values) as x on conflict do nothing;
  end if;
end;
$$;

-- ─── 30A area ────────────────────────────────────────────────────────────
select pg_temp.seed_profile('seed.jake.m@found.local','seed.jake_m','Jake Mitchell','Florida native, weekend surfer, Sunday Bible study leader.','single',null,'quality-time','Bayside Church','Santa Rosa Beach','FL',true,true,
  array['surfing','beach','sports','fitness'],array['couple-friends','bible-study','activity-partners'],array['no-smoking','healthy-eating']);

select pg_temp.seed_profile('seed.caroline.h@found.local','seed.caroline_h','Caroline Henley','Coffee in the morning, beach in the afternoon. Looking for solid girlfriends.','single',null,'words','Seacoast Community Church','Santa Rosa Beach','FL',false,true,
  array['beach','fitness','dining','concerts'],array['couple-friends','bible-study','prayer'],array['no-cussing','healthy-eating']);

select pg_temp.seed_profile('seed.tyler.b@found.local','seed.tyler_b','Tyler Brooks','Sales by day, pickup soccer & live music by night.','single',null,'acts-of-service','CrossPoint Church','Watersound','FL',true,true,
  array['sports','dining','concerts','fitness'],array['activity-partners','networking','young-adult'],array['no-smoking']);

select pg_temp.seed_profile('seed.sarah.r@found.local','seed.sarah_r','Sarah Reeves','College senior. Worship team, beach walks, way too much coffee.','student',null,'quality-time','Bayside Church','Santa Rosa Beach','FL',false,false,
  array['beach','music','concerts','dining'],array['bible-study','mentorship','young-adult'],array['no-alcohol','no-cussing']);

select pg_temp.seed_profile('seed.andrew.w@found.local','seed.andrew_w','Andrew Watts','Newlywed. Wife Claire & I host dinners; come hungry.','married-no-kids',null,'physical-touch','Seacoast Community Church','Seaside','FL',true,true,
  array['dining','hiking','beach','concerts'],array['couple-friends','bible-study'],array['family-worship']);

select pg_temp.seed_profile('seed.marcus.p@found.local','seed.marcus_p','Marcus Pena','Crossfit, finance, faith. Wife is a designer, both 30 and figuring it out.','married-no-kids',null,'acts-of-service','Bayside Church','Santa Rosa Beach','FL',true,false,
  array['fitness','sports','dining','hiking'],array['couple-friends','accountability','networking'],array['no-alcohol','healthy-eating']);

select pg_temp.seed_profile('seed.lauren.h@found.local','seed.lauren_h','Lauren Hayes','Mom of 2 under 3. Beach playdates & adult conversation welcome.','married-babies','public','words','Seacoast Community Church','Santa Rosa Beach','FL',false,true,
  array['beach','playgrounds','dining'],array['mom-friends','family-community','prayer'],array['family-worship','limit-phones','healthy-eating']);

select pg_temp.seed_profile('seed.ben.c@found.local','seed.ben_c','Ben Cole','Dad. Boys are 1 and 3. Sundays = church then beach.','married-babies','public','quality-time','CrossPoint Church','Watersound','FL',true,true,
  array['sports','beach','playgrounds','fitness'],array['couple-friends','family-community'],array['family-worship','limit-phones']);

select pg_temp.seed_profile('seed.rachel.d@found.local','seed.rachel_d','Rachel Davies','Kids 6 and 9. Trying to raise them without screens in their faces.','married-young','christian','acts-of-service','Bayside Church','Santa Rosa Beach','FL',false,false,
  array['beach','playgrounds','hiking','dining'],array['family-community','prayer','mom-friends'],array['family-worship','limit-phones','no-cussing']);

select pg_temp.seed_profile('seed.mark.d@found.local','seed.mark_d','Mark Davies','Husband, two kids, run my own contracting biz on 30A.','married-young','christian','physical-touch','Bayside Church','Santa Rosa Beach','FL',true,false,
  array['hiking','fitness','beach','hunting'],array['family-community','accountability','mentorship'],array['family-worship','no-cussing']);

select pg_temp.seed_profile('seed.ethan.h@found.local','seed.ethan_h','Ethan Hill','Teens at home. Mostly just trying to not screw it up.','married-teens','public','words','Bayside Church','Inlet Beach','FL',false,false,
  array['fitness','hiking','hunting','dining'],array['family-community','mentorship','accountability'],array['no-cussing','family-worship']);

-- ─── Destin / Niceville ──────────────────────────────────────────────────
select pg_temp.seed_profile('seed.megan.t@found.local','seed.megan_t','Megan Tate','PT, ultra runner, future missionary. Looking for accountability + community.','single',null,'quality-time','Calvary Chapel','Destin','FL',true,false,
  array['hiking','fitness','dining','camping'],array['accountability','bible-study','mentorship'],array['no-alcohol','healthy-eating']);

select pg_temp.seed_profile('seed.caleb.r@found.local','seed.caleb_r','Caleb Reed','Mid-20s, music & water. Plays at our Sunday night service sometimes.','single',null,'physical-touch','Calvary Chapel','Destin','FL',true,true,
  array['surfing','music','beach','concerts'],array['young-adult','bible-study','activity-partners'],array['no-smoking']);

select pg_temp.seed_profile('seed.jamie.p@found.local','seed.jamie_p','Jamie Park','Mom of 2 elementary kids. Homeschool curious.','married-young','homeschool','acts-of-service','CrossPoint Church','Niceville','FL',false,true,
  array['playgrounds','beach','dining','music'],array['mom-friends','family-community'],array['family-worship','limit-phones']);

select pg_temp.seed_profile('seed.daniel.p@found.local','seed.daniel_p','Daniel Pham','Eng manager remote. Anna and I love hosting + hiking.','married-no-kids',null,'quality-time','CrossPoint Church','Niceville','FL',false,false,
  array['hiking','dining','concerts','camping'],array['couple-friends','networking'],array['no-smoking','healthy-eating']);

-- ─── Pensacola ───────────────────────────────────────────────────────────
select pg_temp.seed_profile('seed.olivia.b@found.local','seed.olivia_b','Olivia Banks','Worship leader, marketing day job. Big on community.','single',null,'words',null,'Pensacola','FL',false,true,
  array['music','beach','dining','concerts'],array['bible-study','young-adult','prayer'],array['no-alcohol','no-cussing']);

select pg_temp.seed_profile('seed.trevor.n@found.local','seed.trevor_n','Trevor Nash','Surf instructor. Faith, fitness, fish tacos.','single',null,'acts-of-service',null,'Pensacola','FL',true,true,
  array['surfing','fitness','sports','beach'],array['activity-partners','young-adult','accountability'],array['no-smoking','healthy-eating']);

select pg_temp.seed_profile('seed.bethany.c@found.local','seed.bethany_c','Bethany Cole','Mom of 3 elementary. Music teacher. Coffee snob.','married-young','classical','words',null,'Pensacola','FL',false,true,
  array['music','playgrounds','beach','dining'],array['mom-friends','family-community','prayer'],array['family-worship','limit-phones','healthy-eating']);

-- ─── Nashville ───────────────────────────────────────────────────────────
select pg_temp.seed_profile('seed.mason.w@found.local','seed.mason_w','Mason Wright','Songwriter. Mid-20s. East Nash. Looking for actual friends, not industry contacts.','single',null,'quality-time',null,'Nashville','TN',true,false,
  array['music','concerts','dining','hiking'],array['young-adult','bible-study','networking'],array['no-smoking']);

select pg_temp.seed_profile('seed.emma.l@found.local','seed.emma_l','Emma Lin','PA student, hiker, hates small talk, loves real conversation.','single',null,'quality-time',null,'Nashville','TN',false,false,
  array['fitness','hiking','music','camping'],array['bible-study','accountability','young-adult'],array['no-alcohol','healthy-eating']);

select pg_temp.seed_profile('seed.cole.h@found.local','seed.cole_h','Cole Henley','New dad. Engineering team lead. Trying to keep weekends sacred.','married-babies','public','physical-touch',null,'Nashville','TN',false,false,
  array['dining','hiking','music','playgrounds'],array['couple-friends','family-community'],array['family-worship','limit-phones']);

select pg_temp.seed_profile('seed.sophia.r@found.local','seed.sophia_r','Sophia Reed','Mom of 2 kids 4 & 7. Piano teacher.','married-young','christian','words',null,'Nashville','TN',false,true,
  array['music','playgrounds','dining','concerts'],array['mom-friends','family-community'],array['family-worship','no-cussing']);

-- ─── Atlanta ─────────────────────────────────────────────────────────────
select pg_temp.seed_profile('seed.grace.b@found.local','seed.grace_b','Grace Bell','Kids are grown. Finally have time to read again.','empty-nester',null,'words',null,'Atlanta','GA',false,false,
  array['dining','hiking','concerts'],array['mentorship','bible-study','couple-friends'],array['family-worship']);

select pg_temp.seed_profile('seed.patrick.h@found.local','seed.patrick_h','Patrick Hayes','Retired Navy. Wife and I are looking for couple friends post-kids.','empty-nester',null,'acts-of-service',null,'Atlanta','GA',true,true,
  array['dining','hiking','fitness','concerts'],array['couple-friends','mentorship'],array['no-smoking','no-cussing']);

select pg_temp.seed_profile('seed.david.c@found.local','seed.david_c','David Cole','5 grandkids. Still teaching Sunday school.','grandparent',null,'acts-of-service',null,'Atlanta','GA',false,true,
  array['dining','hiking','fitness'],array['mentorship','bible-study'],array['family-worship']);

-- ─── Verify ──────────────────────────────────────────────────────────────
select
  (select count(*) from public.profiles where onboarding_complete = true) as completed_profiles,
  (select count(*) from public.profile_activities) as activity_rows,
  (select count(*) from public.profile_goals)      as goal_rows,
  (select count(*) from public.profile_values)     as value_rows,
  (select count(distinct email) from auth.users where email like 'seed.%@found.local') as seed_users;
