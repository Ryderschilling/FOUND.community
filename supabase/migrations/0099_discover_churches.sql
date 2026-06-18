-- ─────────────────────────────────────────────────────────────────────────────
-- 0099_discover_churches.sql
--
-- Adds a public-facing discover_churches() RPC used by the app's church
-- discovery feed.  Returns churches ordered by distance (nearest first) then
-- by member count.  Falls back gracefully when the caller has no location.
-- ─────────────────────────────────────────────────────────────────────────────

-- discover_churches
-- Callable by any authenticated user.
-- user_lat / user_lng  — caller's coordinates (from their stored profile location)
-- radius_miles         — max distance to include; ignored when lat/lng are null
-- p_limit              — max rows returned (default 60)
CREATE OR REPLACE FUNCTION discover_churches(
  user_lat    float8  DEFAULT NULL,
  user_lng    float8  DEFAULT NULL,
  radius_miles float8 DEFAULT 100,
  p_limit     int     DEFAULT 60
)
RETURNS TABLE (
  id            uuid,
  name          text,
  city          text,
  state         text,
  logo_url      text,
  description   text,
  denomination  text,
  member_count  bigint,
  distance_miles float8,
  is_verified   boolean,
  slug          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.city,
    c.state,
    c.logo_url,
    c.description,
    c.denomination,
    (SELECT COUNT(*)::bigint FROM profiles p WHERE p.church_id = c.id) AS member_count,

    -- Distance in miles, rounded to 1 decimal; NULL when no coords available
    CASE
      WHEN user_lat IS NOT NULL
       AND user_lng IS NOT NULL
       AND c.location IS NOT NULL
      THEN
        ROUND(
          (ST_Distance(
            c.location::geography,
            ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
          ) / 1609.344)::numeric,
          1
        )::float8
      ELSE NULL
    END AS distance_miles,

    c.is_verified,
    c.slug

  FROM churches c
  WHERE
    c.name IS NOT NULL
    AND TRIM(c.name) <> ''
    -- Radius filter only applied when the caller provided coordinates
    AND (
      user_lat IS NULL
      OR user_lng IS NULL
      OR c.location IS NULL
      OR ST_DWithin(
           c.location::geography,
           ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
           radius_miles * 1609.344
         )
    )

  ORDER BY
    -- Nearest first when coords are available
    CASE
      WHEN user_lat IS NOT NULL AND user_lng IS NOT NULL AND c.location IS NOT NULL
      THEN ST_Distance(
             c.location::geography,
             ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
           )
      ELSE 999999999
    END ASC,
    -- Break ties by community size
    (SELECT COUNT(*) FROM profiles p2 WHERE p2.church_id = c.id) DESC

  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION discover_churches(float8, float8, float8, int) TO authenticated;

COMMENT ON FUNCTION discover_churches IS
  'App church discovery feed. Returns churches sorted by distance then member count.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Patch get_church_profile to also return is_verified so the app-side
-- church profile screen can display the verified badge.
-- Must DROP first — Postgres won't allow changing a function's return type
-- in-place via CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_church_profile(uuid);

CREATE FUNCTION public.get_church_profile(p_church_id uuid)
RETURNS TABLE (
  id            uuid,
  name          text,
  description   text,
  city          text,
  state         text,
  address       text,
  website       text,
  denomination  text,
  service_times jsonb,
  logo_url      text,
  slug          text,
  is_verified   boolean,
  member_count  bigint,
  staff         jsonb,
  groups        jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    c.id,
    c.name,
    c.description,
    c.city,
    c.state,
    c.address,
    c.website,
    c.denomination,
    c.service_times,
    c.logo_url,
    c.slug,
    c.is_verified,
    -- live member count
    (SELECT COUNT(*) FROM public.profiles p WHERE p.church_id = c.id AND p.onboarding_complete = true),
    -- staff array
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id',         s.id,
          'name',       s.name,
          'title',      s.title,
          'bio',        s.bio,
          'avatar_url', s.avatar_url
        ) ORDER BY s.sort_order, s.created_at
      ), '[]'::jsonb)
      FROM public.church_staff s
      WHERE s.church_id = c.id
    ),
    -- groups array (active public groups only)
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id',            g.id,
          'name',          g.name,
          'description',   g.description,
          'schedule_text', g.schedule_text,
          'city',          g.city,
          'state',         g.state,
          'member_count',  g.member_count
        ) ORDER BY g.name
      ), '[]'::jsonb)
      FROM public.groups g
      WHERE g.church_id = c.id
        AND g.is_public = true
    )
  FROM public.churches c
  WHERE c.id = p_church_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_church_profile(uuid) TO authenticated, anon;
