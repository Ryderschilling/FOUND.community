-- =============================================================================
-- 0035 — Add Coffee, Golf, Tennis/Pickleball to the activities taxonomy.
-- Keeps the activities table in sync with src/data/mock.js (ACTIVITIES).
-- Idempotent via ON CONFLICT. Run BEFORE deploying the app build that offers
-- these in onboarding — profile_activities.activity_id has an FK to this table,
-- so complete_onboarding will fail if a user picks an id that doesn't exist yet.
-- =============================================================================

insert into public.activities (id, label, icon, icon_color, sort_order) values
  ('coffee',            'Coffee',              'cafe-outline',       '#A8793A', 14),
  ('golf',              'Golf',                'golf-outline',       '#5A7A4A', 15),
  ('tennis-pickleball', 'Tennis / Pickleball', 'tennisball-outline', '#4A6FA5', 16)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon,
  icon_color = excluded.icon_color, sort_order = excluded.sort_order;
