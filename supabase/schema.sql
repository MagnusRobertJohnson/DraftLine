-- ============================================================================
-- HockeyPool Database Schema (Supabase PostgreSQL)
-- Multi-Tenant Fantasy Hockey Draft Pool Platform
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. User Profiles & Subscriptions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL UNIQUE,
  display_name        TEXT,
  avatar_url          TEXT,
  subscription_tier   TEXT NOT NULL DEFAULT 'free'
                      CHECK (subscription_tier IN ('free', 'admin_basic', 'admin_top')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to create profile record when a new user signs up in Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 2. Seasons ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seasons (
  id          TEXT PRIMARY KEY, -- e.g. '20242025'
  name        TEXT NOT NULL,    -- e.g. '2024-2025'
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.seasons (id, name, is_current) VALUES
  ('20242025', '2024-2025', FALSE),
  ('20252026', '2025-2026', FALSE),
  ('20262027', '2026-2027', TRUE)
ON CONFLICT (id) DO UPDATE SET is_current = EXCLUDED.is_current;

-- ── 3. Drafts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  season_id             TEXT NOT NULL REFERENCES public.seasons(id),
  name                  TEXT NOT NULL,
  description           TEXT,
  season_type           TEXT NOT NULL DEFAULT 'regular'
                        CHECK (season_type IN ('regular', 'playoffs')),
  status                TEXT NOT NULL DEFAULT 'setup'
                        CHECK (status IN ('setup', 'active', 'confirmed', 'completed')),
  invite_code           TEXT NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  forwards_count        INTEGER NOT NULL DEFAULT 9 CHECK (forwards_count >= 0),
  defense_count         INTEGER NOT NULL DEFAULT 4 CHECK (defense_count >= 0),
  goalies_count         INTEGER NOT NULL DEFAULT 2 CHECK (goalies_count >= 0),
  injured_reserve_count INTEGER NOT NULL DEFAULT 2 CHECK (injured_reserve_count >= 0),
  salary_cap_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  salary_cap_amount     NUMERIC(6, 2) NOT NULL DEFAULT 88.00 CHECK (salary_cap_amount >= 0), -- in millions
  current_pick          INTEGER NOT NULL DEFAULT 1 CHECK (current_pick >= 1),
  max_teams             INTEGER NOT NULL DEFAULT 16 CHECK (max_teams >= 2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drafts_admin_idx ON public.drafts (admin_id);
CREATE INDEX IF NOT EXISTS drafts_invite_code_idx ON public.drafts (invite_code);
CREATE INDEX IF NOT EXISTS drafts_season_idx ON public.drafts (season_id);

-- Enforce Admin Draft Creation Quotas:
-- Basic Tier: max 3 drafts per season
-- Top Tier: max 15 drafts per season
CREATE OR REPLACE FUNCTION public.check_draft_tier_limit()
RETURNS TRIGGER AS $$
DECLARE
  tier TEXT;
  draft_count INTEGER;
  max_allowed INTEGER;
BEGIN
  SELECT subscription_tier INTO tier FROM public.profiles WHERE id = NEW.admin_id;
  
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

DROP TRIGGER IF EXISTS trigger_check_draft_tier_limit ON public.drafts;
CREATE TRIGGER trigger_check_draft_tier_limit
  BEFORE INSERT ON public.drafts
  FOR EACH ROW EXECUTE FUNCTION public.check_draft_tier_limit();

-- ── 4. Draft Scoring Weights ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draft_scoring_weights (
  draft_id    UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  stat        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  weight      NUMERIC NOT NULL DEFAULT 0,
  label       TEXT NOT NULL,
  PRIMARY KEY (draft_id, stat)
);

-- Seed default scoring weights whenever a new draft is created
CREATE OR REPLACE FUNCTION public.seed_draft_scoring_weights()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.draft_scoring_weights (draft_id, stat, enabled, weight, label) VALUES
    (NEW.id, 'goals',         TRUE,  1.0, 'Goals'),
    (NEW.id, 'assists',       TRUE,  1.0, 'Assists'),
    (NEW.id, 'points',        FALSE, 0.0, 'Points (G+A)'),
    (NEW.id, 'plus_minus',    FALSE, 0.0, '+/-'),
    (NEW.id, 'pim',           FALSE, 0.0, 'Penalty Minutes'),
    (NEW.id, 'blocked_shots', FALSE, 0.0, 'Blocked Shots'),
    (NEW.id, 'hits',          FALSE, 0.0, 'Hits'),
    (NEW.id, 'goalie_wins',   TRUE,  2.0, 'Goalie Wins'),
    (NEW.id, 'shutouts',      TRUE,  3.0, 'Shutouts'),
    (NEW.id, 'gaa',           FALSE, 0.0, 'Goals Against Avg'),
    (NEW.id, 'save_pct',      FALSE, 0.0, 'Save Percentage'),
    (NEW.id, 'ot_goals',      FALSE, 0.0, 'Overtime Goals'),
    (NEW.id, 'ot_losses',     FALSE, 0.0, 'Overtime Losses')
  ON CONFLICT (draft_id, stat) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_seed_draft_scoring_weights ON public.drafts;
CREATE TRIGGER trigger_seed_draft_scoring_weights
  AFTER INSERT ON public.drafts
  FOR EACH ROW EXECUTE FUNCTION public.seed_draft_scoring_weights();

-- ── 5. Draft Teams ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draft_teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id      UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  team_name     TEXT NOT NULL,
  draft_order   INTEGER NOT NULL DEFAULT 1 CHECK (draft_order >= 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, draft_order),
  UNIQUE (draft_id, user_id)
);

CREATE INDEX IF NOT EXISTS draft_teams_draft_idx ON public.draft_teams (draft_id);
CREATE INDEX IF NOT EXISTS draft_teams_user_idx ON public.draft_teams (user_id);

-- ── 6. Draft Picks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draft_picks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id                    UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  draft_team_id               UUID NOT NULL REFERENCES public.draft_teams(id) ON DELETE CASCADE,
  pick_number                 INTEGER NOT NULL CHECK (pick_number >= 1),
  nhl_player_id               INTEGER NOT NULL,
  player_name                 TEXT NOT NULL,
  player_position             TEXT NOT NULL CHECK (player_position IN ('C', 'L', 'R', 'D', 'G', 'F')),
  player_team                 TEXT NOT NULL,
  roster_status               TEXT NOT NULL DEFAULT 'active' CHECK (roster_status IN ('active', 'ir')),
  score_before_current_status NUMERIC NOT NULL DEFAULT 0,
  score_snapshot              JSONB NOT NULL DEFAULT '{}'::jsonb,
  cap_hit                     NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, pick_number),
  UNIQUE (draft_id, nhl_player_id)
);

CREATE INDEX IF NOT EXISTS draft_picks_draft_team_idx ON public.draft_picks (draft_id, draft_team_id);
CREATE INDEX IF NOT EXISTS draft_picks_nhl_player_idx ON public.draft_picks (nhl_player_id);

-- ── 7. Roster Transactions (IR Swaps & Future Trades) ────────────────────────
CREATE TABLE IF NOT EXISTS public.roster_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  draft_team_id     UUID NOT NULL REFERENCES public.draft_teams(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  transaction_type  TEXT NOT NULL DEFAULT 'ir_swap'
                    CHECK (transaction_type IN ('ir_swap', 'trade', 'waiver')),
  effective_at      TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'applied', 'cancelled')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.roster_transaction_players (
  transaction_id    UUID NOT NULL REFERENCES public.roster_transactions(id) ON DELETE CASCADE,
  draft_pick_id     UUID NOT NULL REFERENCES public.draft_picks(id) ON DELETE CASCADE,
  from_status       TEXT NOT NULL CHECK (from_status IN ('active', 'ir')),
  to_status         TEXT NOT NULL CHECK (to_status IN ('active', 'ir')),
  PRIMARY KEY (transaction_id, draft_pick_id)
);

CREATE INDEX IF NOT EXISTS roster_transactions_pending_idx
  ON public.roster_transactions (effective_at) WHERE status = 'pending';

-- ── 8. Master Salary Registry ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.player_salaries (
  season_id     TEXT NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  nhl_player_id INTEGER NOT NULL,
  player_name   TEXT NOT NULL,
  team_abbrev   TEXT,
  position      TEXT,
  cap_hit       NUMERIC(6, 2) NOT NULL DEFAULT 0.00, -- Millions
  source        TEXT NOT NULL DEFAULT 'spotrac' CHECK (source IN ('spotrac', 'manual', 'csv', 'nhl')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season_id, nhl_player_id)
);

CREATE INDEX IF NOT EXISTS player_salaries_season_player_idx ON public.player_salaries (season_id, nhl_player_id);

-- Shared snapshot of NHL player stats (written/read by the server only)
CREATE TABLE IF NOT EXISTS public.player_stats_cache (
  season_id   TEXT NOT NULL,
  game_type   TEXT NOT NULL,
  skaters     JSONB NOT NULL DEFAULT '[]',
  goalies     JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, game_type)
);
ALTER TABLE public.player_stats_cache ENABLE ROW LEVEL SECURITY;

-- Per-admin salary overrides and per-draft locked salaries (server-only tables)
CREATE TABLE IF NOT EXISTS public.admin_salary_overrides (
  admin_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_id     TEXT NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  nhl_player_id INTEGER NOT NULL,
  player_name   TEXT NOT NULL,
  cap_hit       NUMERIC(6, 2) NOT NULL CHECK (cap_hit >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_id, season_id, nhl_player_id)
);
CREATE TABLE IF NOT EXISTS public.draft_salaries (
  draft_id      UUID NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  nhl_player_id INTEGER NOT NULL,
  cap_hit       NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (draft_id, nhl_player_id)
);
ALTER TABLE public.admin_salary_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_salaries ENABLE ROW LEVEL SECURITY;

-- ── 9. Realtime Publication ──────────────────────────────────────────────────
-- Enable Realtime for live updates on web and mobile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'drafts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.drafts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'draft_teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_teams;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'draft_picks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_picks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'roster_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.roster_transactions;
  END IF;
END $$;

-- ── 10. Row Level Security (RLS) ─────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_scoring_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_transaction_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_salaries ENABLE ROW LEVEL SECURITY;

-- Profiles: Anyone authenticated can read profiles; users can update their own
CREATE POLICY "Public profiles are readable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Seasons: Readable by everyone authenticated
CREATE POLICY "Seasons are readable by authenticated users"
  ON public.seasons FOR SELECT TO authenticated USING (true);

-- Drafts: Readable if public/shared code or user is participant or admin
CREATE POLICY "Drafts readable by authenticated users"
  ON public.drafts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert drafts"
  ON public.drafts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = admin_id);

CREATE POLICY "Admins can update their drafts"
  ON public.drafts FOR UPDATE TO authenticated
  USING (auth.uid() = admin_id);

CREATE POLICY "Admins can delete their drafts"
  ON public.drafts FOR DELETE TO authenticated
  USING (auth.uid() = admin_id);

-- Scoring weights: readable by all, editable by draft admin
CREATE POLICY "Weights readable by authenticated"
  ON public.draft_scoring_weights FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can update scoring weights"
  ON public.draft_scoring_weights FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drafts
      WHERE public.drafts.id = draft_scoring_weights.draft_id
        AND public.drafts.admin_id = auth.uid()
    )
  );

-- Draft teams: readable by all participants, creatable by joining users or admin
CREATE POLICY "Draft teams are readable by authenticated"
  ON public.draft_teams FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create their own team or admin can create teams"
  ON public.draft_teams FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.drafts
      WHERE public.drafts.id = draft_teams.draft_id
        AND public.drafts.admin_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own team or admin can manage"
  ON public.draft_teams FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.drafts
      WHERE public.drafts.id = draft_teams.draft_id
        AND public.drafts.admin_id = auth.uid()
    )
  );

-- Draft picks: readable by all, managed by draft admin
CREATE POLICY "Picks readable by all authenticated"
  ON public.draft_picks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can manage draft picks"
  ON public.draft_picks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drafts
      WHERE public.drafts.id = draft_picks.draft_id
        AND public.drafts.admin_id = auth.uid()
    )
  );

-- Transactions: team owners or admin can create/read
CREATE POLICY "Roster transactions readable by authenticated"
  ON public.roster_transactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Team owners can create roster transactions"
  ON public.roster_transactions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.draft_teams
      WHERE public.draft_teams.id = roster_transactions.draft_team_id
        AND (public.draft_teams.user_id = auth.uid() OR
             EXISTS (
               SELECT 1 FROM public.drafts
               WHERE public.drafts.id = roster_transactions.draft_id
                 AND public.drafts.admin_id = auth.uid()
             ))
    )
  );

CREATE POLICY "Team owners or admin can update roster transactions"
  ON public.roster_transactions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.draft_teams
      WHERE public.draft_teams.id = roster_transactions.draft_team_id
        AND (public.draft_teams.user_id = auth.uid() OR
             EXISTS (
               SELECT 1 FROM public.drafts
               WHERE public.drafts.id = roster_transactions.draft_id
                 AND public.drafts.admin_id = auth.uid()
             ))
    )
  );

CREATE POLICY "Transaction players readable by authenticated"
  ON public.roster_transaction_players FOR SELECT TO authenticated USING (true);

CREATE POLICY "Transaction players creatable with transaction"
  ON public.roster_transaction_players FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roster_transactions t
      JOIN public.draft_teams dt ON dt.id = t.draft_team_id
      WHERE t.id = roster_transaction_players.transaction_id
        AND (dt.user_id = auth.uid() OR
             EXISTS (
               SELECT 1 FROM public.drafts d
               WHERE d.id = t.draft_id AND d.admin_id = auth.uid()
             ))
    )
  );

-- Salaries: readable by all; written only by the server (sync job)
CREATE POLICY "Salaries readable by all authenticated"
  ON public.player_salaries FOR SELECT TO authenticated USING (true);
