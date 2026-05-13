-- =============================================================================
-- Seed taxonomies. Run AFTER 0001_init.sql.
-- Mirrors src/data/mock.js so app UI keeps the exact same ids/labels/icons.
-- Idempotent via ON CONFLICT.
-- =============================================================================

-- ---- life_stages ------------------------------------------------------------
insert into public.life_stages (id, label, icon, icon_color, sort_order, has_kids) values
  ('student',         'Student',                       'school-outline',        '#4A6FA5',  1, false),
  ('single',          'Single',                        'person-outline',        '#4A6FA5',  2, false),
  ('married-no-kids', 'Married — No Kids',             'heart-outline',         '#C0795A',  3, false),
  ('married-babies',  'Married w/ Babies (0–2)',       'happy-outline',         '#7A5AA8',  4, true),
  ('married-young',   'Married w/ Young Kids (2–12)',  'people-outline',        '#5A7A4A',  5, true),
  ('married-teens',   'Married w/ Teens (14–18)',      'bicycle-outline',       '#A8793A',  6, true),
  ('married-mixed',   'Married w/ Mixed Ages',         'people-circle-outline', '#4A8A6A',  7, true),
  ('empty-nester',    'Empty Nester',                  'home-outline',          '#5A8A6A',  8, false),
  ('grandparent',     'Grandparent',                   'sunny-outline',         '#C0795A',  9, false)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color,
  sort_order = excluded.sort_order, has_kids = excluded.has_kids;

-- ---- activities -------------------------------------------------------------
insert into public.activities (id, label, icon, icon_color, sort_order) values
  ('surfing',     'Surfing',              'water-outline',         '#4A6FA5',  1),
  ('skating',     'Skating',              'body-outline',          '#7A5AA8',  2),
  ('beach',       'Beach / Lake / River', 'sunny-outline',         '#A8793A',  3),
  ('music',       'Playing Music',        'musical-notes-outline', '#7A5AA8',  4),
  ('sports',      'Sports',               'football-outline',      '#4A8A6A',  5),
  ('camping',     'Camping',              'bonfire-outline',       '#A8793A',  6),
  ('hiking',      'Hiking',               'leaf-outline',          '#5A8A6A',  7),
  ('fitness',     'Working Out',          'barbell-outline',       '#C0795A',  8),
  ('playgrounds', 'Playgrounds / MDO',    'happy-outline',         '#4A6FA5',  9),
  ('hunting',     'Hunting / Fishing',    'fish-outline',          '#5A7A4A', 10),
  ('dining',      'Dinner Out',           'restaurant-outline',    '#C0795A', 11),
  ('concerts',    'Concerts',             'musical-note-outline',  '#7A5AA8', 12),
  ('shopping',    'Mall / Shopping',      'bag-outline',           '#A8793A', 13)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- community_goals --------------------------------------------------------
insert into public.community_goals (id, label, icon, icon_color, sort_order) values
  ('couple-friends',   'Couple Friends',         'people-outline',          '#C0795A',  1),
  ('family-community', 'Family Community',       'home-outline',            '#5A7A4A',  2),
  ('mentorship',       'Mentorship',             'trending-up-outline',     '#4A6FA5',  3),
  ('bible-study',      'Bible Study',            'book-outline',            '#5A7A4A',  4),
  ('activity-partners','Activity Partners',      'bicycle-outline',         '#4A8A6A',  5),
  ('prayer',           'Prayer Community',       'heart-outline',           '#C0795A',  6),
  ('accountability',   'Accountability',         'shield-outline',          '#7A5AA8',  7),
  ('church-connect',   'Church Connections',     'business-outline',        '#A8793A',  8),
  ('mom-friends',      'Mom Friends',            'happy-outline',           '#4A6FA5',  9),
  ('networking',       'Business Networking',    'briefcase-outline',       '#A8793A', 10),
  ('young-adult',      'Young Adult Community',  'people-circle-outline',   '#5A8A6A', 11)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- family_values ----------------------------------------------------------
insert into public.family_values (id, label, icon, icon_color, sort_order) values
  ('no-alcohol',     'No Alcohol',            'wine-outline',          '#C0795A', 1),
  ('no-cussing',     'No Cussing',            'chatbubble-outline',    '#A8793A', 2),
  ('no-smoking',     'No Smoking',            'ban-outline',           '#4A6FA5', 3),
  ('healthy-eating', 'Eating Healthy',        'nutrition-outline',     '#5A7A4A', 4),
  ('family-worship', 'Family Worship',        'book-outline',          '#5A7A4A', 5),
  ('limit-phones',   'Limit Phones for Kids', 'phone-portrait-outline','#4A6FA5', 6)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- school_types -----------------------------------------------------------
insert into public.school_types (id, label, icon, icon_color, sort_order) values
  ('public',     'Public School',         'school-outline',   '#4A6FA5', 1),
  ('private',    'Private School',        'business-outline', '#A8793A', 2),
  ('christian',  'Christian School',      'book-outline',     '#5A7A4A', 3),
  ('classical',  'Classical Christian',   'library-outline',  '#7A5AA8', 4),
  ('homeschool', 'Homeschool',            'home-outline',     '#C0795A', 5)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- love_languages ---------------------------------------------------------
insert into public.love_languages (id, label, icon, icon_color, sort_order) values
  ('acts-of-service', 'Acts of Service',      'hammer-outline',               '#5A7A4A', 1),
  ('receiving-gifts', 'Receiving Gifts',      'gift-outline',                 '#A8793A', 2),
  ('quality-time',    'Quality Time',         'time-outline',                 '#4A6FA5', 3),
  ('words',           'Words of Affirmation', 'chatbubble-ellipses-outline',  '#7A5AA8', 4),
  ('physical-touch',  'Physical Touch',       'hand-left-outline',            '#C0795A', 5)
on conflict (id) do update set
  label = excluded.label, icon = excluded.icon, icon_color = excluded.icon_color, sort_order = excluded.sort_order;

-- ---- a handful of seed churches near 30A so the app isn't empty -------------
insert into public.churches (id, name, city, state, location, is_verified) values
  (gen_random_uuid(), 'Bayside Church',           'Santa Rosa Beach', 'FL', ST_SetSRID(ST_MakePoint(-86.205, 30.388), 4326)::geography, true),
  (gen_random_uuid(), 'Seacoast Community Church','Santa Rosa Beach', 'FL', ST_SetSRID(ST_MakePoint(-86.215, 30.378), 4326)::geography, true),
  (gen_random_uuid(), 'Calvary Chapel',           'Destin',           'FL', ST_SetSRID(ST_MakePoint(-86.495, 30.393), 4326)::geography, true),
  (gen_random_uuid(), 'CrossPoint Church',        'Niceville',        'FL', ST_SetSRID(ST_MakePoint(-86.481, 30.516), 4326)::geography, true)
on conflict do nothing;
