-- Apply to an existing project in the Supabase SQL Editor.
-- The existing subscription_tier values remain unchanged.
BEGIN;

-- Replace this placeholder with the verified owner's sign-in email before running.
SELECT set_config('draftline.owner_email', 'REPLACE_WITH_OWNER_EMAIL', true);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.app_owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT
);
ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_owner FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  existing_owner uuid;
  owners integer;
BEGIN
  SELECT count(*) INTO owners FROM public.profiles WHERE is_super_admin;
  IF owners <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one existing super admin; verify the owner before applying this migration.';
  END IF;
  SELECT id INTO existing_owner FROM public.profiles WHERE is_super_admin;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = existing_owner
      AND lower(email) = lower(current_setting('draftline.owner_email'))
      AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The confirmed owner email must match the existing super-admin account.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_owner WHERE user_id <> existing_owner) THEN
    RAISE EXCEPTION 'The existing owner does not match the super-admin profile.';
  END IF;
  INSERT INTO public.app_owner (singleton, user_id) VALUES (true, existing_owner)
  ON CONFLICT (singleton) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM public.app_owner WHERE singleton;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'App owner is not configured.'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = owner_id THEN RAISE EXCEPTION 'The owner profile cannot be deleted.'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM (NEW.id = owner_id) THEN
    RAISE EXCEPTION 'Super-admin status is reserved for the app owner.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND NEW.subscription_tier <> 'free' THEN
      RAISE EXCEPTION 'Only the server can grant paid access.';
    END IF;
  ELSIF auth.uid() IS NOT NULL AND (
       NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
    OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
  ) THEN
    RAISE EXCEPTION 'Only the server can change administrator access.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trigger_protect_profile_privileges
BEFORE INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

CREATE OR REPLACE FUNCTION public.check_draft_tier_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tier text;
  super_admin boolean;
  draft_count integer;
  max_allowed integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.admin_id = OLD.admin_id AND NEW.season_id = OLD.season_id THEN
    RETURN NEW;
  END IF;

  SELECT subscription_tier, is_super_admin INTO tier, super_admin
  FROM public.profiles WHERE id = NEW.admin_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator profile not found.'; END IF;
  IF super_admin THEN RETURN NEW; END IF;
  IF tier = 'admin_basic' THEN
    max_allowed := 3;
  ELSIF tier = 'admin_top' THEN
    max_allowed := 15;
  ELSE
    RAISE EXCEPTION 'Only paid administrators can create drafts.';
  END IF;

  SELECT count(*) INTO draft_count FROM public.drafts
  WHERE admin_id = NEW.admin_id AND season_id = NEW.season_id
    AND (TG_OP = 'INSERT' OR id <> OLD.id);
  IF draft_count >= max_allowed THEN
    RAISE EXCEPTION 'Season draft limit reached (% allowed).', max_allowed;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_check_draft_tier_limit ON public.drafts;
CREATE TRIGGER trigger_check_draft_tier_limit
BEFORE INSERT OR UPDATE OF admin_id, season_id ON public.drafts
FOR EACH ROW EXECUTE FUNCTION public.check_draft_tier_limit();

COMMIT;
