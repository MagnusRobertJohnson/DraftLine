-- Engagement features: notifications, push, email invites, templates, chat, team style, theme.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Storage is kept small on purpose (text only, capped sizes, automatic purging).

-- ── Profile preferences ─────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_theme_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_theme_check CHECK (theme IN ('system', 'light', 'dark'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL
  DEFAULT '{"invites":true,"swaps":true,"draft_updates":true,"chat":false,"push":true,"email":false}';

-- ── Team style (colour + preset icon; no image uploads, so no file storage) ──
ALTER TABLE public.draft_teams ADD COLUMN IF NOT EXISTS team_color TEXT;
ALTER TABLE public.draft_teams ADD COLUMN IF NOT EXISTS team_icon TEXT;
ALTER TABLE public.draft_teams DROP CONSTRAINT IF EXISTS draft_teams_color_check;
ALTER TABLE public.draft_teams ADD CONSTRAINT draft_teams_color_check
  CHECK (team_color IS NULL OR team_color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE public.draft_teams DROP CONSTRAINT IF EXISTS draft_teams_icon_check;
ALTER TABLE public.draft_teams ADD CONSTRAINT draft_teams_icon_check
  CHECK (team_icon IS NULL OR char_length(team_icon) <= 8);

-- ── Helper: is the caller in this draft (member, its admin, or super admin)? ─
CREATE OR REPLACE FUNCTION public.is_draft_member(d UUID)
RETURNS BOOLEAN AS $$
  SELECT public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.drafts WHERE id = d AND admin_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.draft_teams WHERE draft_id = d AND user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── Notifications (rows are created by the server only) ─────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL CHECK (char_length(title) <= 120),
  body       TEXT CHECK (body IS NULL OR char_length(body) <= 300),
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own notifications" ON public.notifications;
CREATE POLICY "Read own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Update own notifications" ON public.notifications;
CREATE POLICY "Update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Delete own notifications" ON public.notifications;
CREATE POLICY "Delete own notifications" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── Mobile push tokens ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Manage own push tokens" ON public.push_tokens;
CREATE POLICY "Manage own push tokens" ON public.push_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Email invites (server only) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draft_invites (
  id         BIGSERIAL PRIMARY KEY,
  draft_id   UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  invited_by UUID NOT NULL,
  emailed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, email)
);
ALTER TABLE public.draft_invites ENABLE ROW LEVEL SECURITY;

-- ── Draft templates (an admin's reusable rules) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.draft_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  settings   JSONB NOT NULL,
  scoring    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS draft_templates_admin_idx ON public.draft_templates (admin_id);
ALTER TABLE public.draft_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Manage own templates" ON public.draft_templates;
CREATE POLICY "Manage own templates" ON public.draft_templates FOR ALL TO authenticated
  USING (admin_id = auth.uid()) WITH CHECK (admin_id = auth.uid());

-- Limit each admin to 20 templates
CREATE OR REPLACE FUNCTION public.limit_templates()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT count(*) FROM public.draft_templates WHERE admin_id = NEW.admin_id) >= 20 THEN
    RAISE EXCEPTION 'You can save up to 20 templates. Delete one first.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_limit_templates ON public.draft_templates;
CREATE TRIGGER trigger_limit_templates BEFORE INSERT ON public.draft_templates
  FOR EACH ROW EXECUTE FUNCTION public.limit_templates();

-- ── Draft chat (short text, old messages purged automatically) ──────────────
CREATE TABLE IF NOT EXISTS public.draft_messages (
  id         BIGSERIAL PRIMARY KEY,
  draft_id   UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS draft_messages_draft_idx ON public.draft_messages (draft_id, created_at DESC);
ALTER TABLE public.draft_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read chat" ON public.draft_messages;
CREATE POLICY "Members read chat" ON public.draft_messages FOR SELECT TO authenticated
  USING (public.is_draft_member(draft_id));
DROP POLICY IF EXISTS "Members post chat" ON public.draft_messages;
CREATE POLICY "Members post chat" ON public.draft_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_draft_member(draft_id));
DROP POLICY IF EXISTS "Delete chat" ON public.draft_messages;
CREATE POLICY "Delete chat" ON public.draft_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.drafts d WHERE d.id = draft_id AND d.admin_id = auth.uid()) OR public.is_super_admin());

-- ── Automatic cleanup, called daily by the app's cron job ───────────────────
CREATE OR REPLACE FUNCTION public.purge_old_engagement_data()
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '30 days';
  DELETE FROM public.draft_messages WHERE id IN (
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY draft_id ORDER BY created_at DESC) AS rn
      FROM public.draft_messages
    ) t WHERE rn > 200
  );
  DELETE FROM public.super_admin_audit_log WHERE created_at < NOW() - INTERVAL '1 year';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.purge_old_engagement_data() FROM PUBLIC, anon, authenticated;
