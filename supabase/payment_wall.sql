-- Retired: the former five-draft limit no longer matches the current plans.
-- Use admin_tier_limits.sql instead; see the database setup instructions.
DO $$
BEGIN
  RAISE EXCEPTION 'This migration is retired. Use admin_tier_limits.sql instead.';
END;
$$;
