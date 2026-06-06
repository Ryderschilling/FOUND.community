-- =============================================================================
-- 0075_normalize_city_international.sql
--
-- Updates normalize_city() to strip everything after the last comma, not just
-- 2-letter state codes. This means "Lima, Peru", "Lima, IN", "Lima" all
-- normalize to "lima" and correctly match each other.
--
-- Old:  regexp_replace(raw, ',\s*[A-Za-z]{2}$', '')   ← only strips ", XX"
-- New:  regexp_replace(raw, ',.*$', '')                ← strips ", anything"
-- =============================================================================

create or replace function public.normalize_city(raw text)
returns text language sql immutable as $$
  select lower(trim(regexp_replace(coalesce(raw, ''), ',.*$', '')));
$$;

-- =============================================================================
-- VERIFY:
--   select public.normalize_city('Lima, Peru');    -- → 'lima'
--   select public.normalize_city('Lima, IN');      -- → 'lima'
--   select public.normalize_city('Lima');          -- → 'lima'
--   select public.normalize_city('Charleston, SC'); -- → 'charleston'
-- =============================================================================
