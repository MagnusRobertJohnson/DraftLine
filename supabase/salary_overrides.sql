-- Shared salaries are written only by the server; remove direct admin write access
DROP POLICY IF EXISTS "Salaries editable by authenticated admins" ON public.player_salaries;

-- Per-admin salary overrides: apply to all drafts the admin runs (until a draft locks its salaries)
CREATE TABLE IF NOT EXISTS public.admin_salary_overrides (
  admin_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id     TEXT NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  nhl_player_id INTEGER NOT NULL,
  player_name   TEXT NOT NULL,
  cap_hit       NUMERIC(6, 2) NOT NULL CHECK (cap_hit >= 0), -- Millions
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_id, season_id, nhl_player_id)
);

-- Salaries locked in for a draft when its first pick is made
CREATE TABLE IF NOT EXISTS public.draft_salaries (
  draft_id      UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  nhl_player_id INTEGER NOT NULL,
  cap_hit       NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (draft_id, nhl_player_id)
);

-- Server-only tables (accessed with the service role key)
ALTER TABLE public.admin_salary_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_salaries ENABLE ROW LEVEL SECURITY;
