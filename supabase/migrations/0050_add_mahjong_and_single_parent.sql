-- =============================================================================
-- 0050_add_mahjong_and_single_parent.sql
--
-- 1) Add 'Mahjong' to activities (lifestyle/social section, sort_order 119)
-- 2) Add 'Single Parent' to life_stages (sort_order 10)
--
-- Idempotent via ON CONFLICT. Safe to re-run.
-- Run AFTER 0049_anywhere_mutual_sort.sql.
-- =============================================================================

-- ─── 1) Mahjong interest ─────────────────────────────────────────────────────
insert into public.activities (id, label, icon, icon_color, sort_order) values
  ('mahjong', 'Mahjong', 'dice-outline', '#1A1A1A', 119)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order;

-- ─── 2) Single Parent life stage ─────────────────────────────────────────────
insert into public.life_stages (id, label, icon, icon_color, sort_order, has_kids) values
  ('single-parent', 'Single Parent', 'people-outline', '#5A7A4A', 10, true)
on conflict (id) do update set
  label      = excluded.label,
  icon       = excluded.icon,
  icon_color = excluded.icon_color,
  sort_order = excluded.sort_order,
  has_kids   = excluded.has_kids;

-- =============================================================================
-- DONE.
-- Verify:
--   select id, label from public.activities where id = 'mahjong';
--   select id, label, has_kids from public.life_stages where id = 'single-parent';
-- =============================================================================
