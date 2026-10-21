CREATE TABLE IF NOT EXISTS public.player_stats_cache (
  season_id   TEXT NOT NULL,
  game_type   TEXT NOT NULL,
  skaters     JSONB NOT NULL DEFAULT '[]',
  goalies     JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, game_type)
);
ALTER TABLE public.player_stats_cache ENABLE ROW LEVEL SECURITY;
