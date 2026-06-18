-- ─────────────────────────────────────────────────────────────────────────────
-- 0103_church_followers_list.sql
--
-- Exposes the full follower list to church admins on the dashboard.
-- A "follower" is anyone who called toggle_church_follow() on this church.
-- Each row includes enough profile context so the dashboard can bucket them
-- into: Member | Looking | Has Another Church | Just Following.
--
-- RPCs:    church_followers_list(p_church_id, p_limit, p_offset)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.church_followers_list(
  p_church_id uuid,
  p_limit     int  DEFAULT 1000,
  p_offset    int  DEFAULT 0
)
RETURNS TABLE (
  id                uuid,
  full_name         text,
  city              text,
  state             text,
  life_stage_id     text,
  followed_at       timestamptz,
  is_member         boolean,   -- they set this church as their home church
  looking_for_church boolean,  -- actively looking, no home church
  has_other_church  boolean    -- they have a different home church
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.city,
    p.state,
    p.life_stage_id,
    cf.created_at                         AS followed_at,
    (p.church_id = p_church_id)           AS is_member,
    (
      COALESCE(p.looking_for_church, false) = true
      AND p.church_id IS NULL
    )                                     AS looking_for_church,
    (
      p.church_id IS NOT NULL
      AND p.church_id <> p_church_id
    )                                     AS has_other_church
  FROM church_follows cf
  JOIN profiles p ON p.id = cf.profile_id
  WHERE cf.church_id = p_church_id
    AND public.is_church_admin(p_church_id)
  ORDER BY cf.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.church_followers_list(uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.church_followers_list IS
  'Returns all followers of a church with membership/church-search context. Auth-gated to church admins.';
