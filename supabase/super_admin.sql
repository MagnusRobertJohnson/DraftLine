-- ── Meta-admin (super admin) support ────────────────────────────────────────
-- Run once in the Supabase SQL Editor. Then designate yourself (see bottom of file).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Signed-in users can no longer change their own tier or super-admin flag from the client.
-- Changes made with the service role (server API) or in the SQL Editor have no auth.uid() and pass.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
       NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
    OR NEW.is_super_admin    IS DISTINCT FROM OLD.is_super_admin
  ) THEN
    RAISE EXCEPTION 'Subscription tier and administrator status can only be changed by the app owner.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trigger_protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- Super admin is exempt from the per-season draft limit.
CREATE OR REPLACE FUNCTION public.check_draft_tier_limit()
RETURNS TRIGGER AS $$
DECLARE
  tier TEXT;
  super_admin BOOLEAN;
  draft_count INTEGER;
  max_allowed INTEGER;
BEGIN
  SELECT subscription_tier, is_super_admin INTO tier, super_admin
  FROM public.profiles WHERE id = NEW.admin_id;

  IF super_admin THEN
    RETURN NEW;
  END IF;

  IF tier = 'admin_basic' THEN
    max_allowed := 3;
  ELSIF tier = 'admin_top' THEN
    max_allowed := 15;
  ELSE
    RAISE EXCEPTION 'Only paid administrators can create drafts.';
  END IF;

  SELECT count(*) INTO draft_count
  FROM public.drafts
  WHERE admin_id = NEW.admin_id AND season_id = NEW.season_id;

  IF draft_count >= max_allowed THEN
    RAISE EXCEPTION 'Season draft limit reached for tier % (% allowed).', tier, max_allowed;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Super admin can read and change everything related to drafts.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'drafts', 'draft_scoring_weights', 'draft_teams', 'draft_picks',
    'roster_transactions', 'roster_transaction_players'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Super admin full access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Super admin full access" ON public.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
      t
    );
  END LOOP;
END $$;

-- Record of every action a super admin takes (server-only table)
CREATE TABLE IF NOT EXISTS public.super_admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID NOT NULL,
  action      TEXT NOT NULL,
  target_user UUID,
  target_draft UUID,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.super_admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ── Designate the meta-admin (edit the email, then run this line) ────────────
-- UPDATE public.profiles SET is_super_admin = TRUE WHERE email = 'you@example.com';
