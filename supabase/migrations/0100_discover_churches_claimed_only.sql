-- ─────────────────────────────────────────────────────────────────────────────
-- 0100_discover_churches_claimed_only.sql
--
-- Churches only appear in the Discover feed after a church admin has claimed
-- them. Unclaimed/user-suggested churches stay in the DB (so user profiles
-- stay linked) and trigger an email notification, but are invisible in the
-- directory until someone from that church actually claims it.
-- ─────────────────────────────────────────────────────────────────────────────

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
    -- Only show churches that have been claimed by a church admin
    AND c.claimed_by IS NOT NULL
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
  'App church discovery feed. Only returns claimed churches (claimed_by IS NOT NULL). Sorted by distance then member count.';
