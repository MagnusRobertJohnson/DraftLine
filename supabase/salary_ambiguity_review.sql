-- Apply once in the Supabase SQL editor before deploying the salary review API.
CREATE TABLE IF NOT EXISTS public.salary_sync_state (
  season_id text PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.salary_match_reviews (
  season_id text NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  fingerprint text NOT NULL,
  details jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  PRIMARY KEY (season_id, group_key)
);

ALTER TABLE public.salary_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_match_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salary_sync_state, public.salary_match_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.salary_sync_state, public.salary_match_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.apply_salary_sync(
  p_season text, p_started_at timestamptz, p_matches jsonb, p_groups jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  g jsonb;
  p jsonb;
  previous public.salary_match_reviews%ROWTYPE;
  prior_salaries jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('salary_sync'), hashtext(p_season));
  IF EXISTS (SELECT 1 FROM public.salary_sync_state WHERE season_id = p_season AND started_at > p_started_at) THEN
    RETURN false;
  END IF;
  INSERT INTO public.salary_sync_state VALUES (p_season, p_started_at)
  ON CONFLICT (season_id) DO UPDATE SET started_at = EXCLUDED.started_at;

  IF EXISTS (
    SELECT 1 FROM public.salary_match_reviews r
    CROSS JOIN jsonb_array_elements(p_groups) AS incoming(value)
    WHERE r.season_id = p_season AND r.status = 'pending'
      AND r.group_key <> incoming.value->>'key'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(r.details->'players') AS old_player(value)
        JOIN jsonb_array_elements(incoming.value->'details'->'players') AS new_player(value)
          ON old_player.value->>'id' = new_player.value->>'id'
      )
  ) THEN
    RAISE EXCEPTION 'A pending review overlaps a changed match. Resolve the existing review before syncing again.';
  END IF;

  INSERT INTO public.player_salaries (season_id, nhl_player_id, player_name, cap_hit, source, updated_at)
  SELECT p_season, (m->>'playerId')::integer, m->>'playerName', (m->>'capHit')::numeric, 'spotrac', now()
  FROM jsonb_array_elements(p_matches) AS m
  WHERE NOT EXISTS (
    SELECT 1 FROM public.salary_match_reviews r
    CROSS JOIN jsonb_array_elements(r.details->'players') AS pending_player(value)
    WHERE r.season_id = p_season AND r.status = 'pending'
      AND pending_player.value->>'id' = m->>'playerId'
  )
  ON CONFLICT (season_id, nhl_player_id) DO UPDATE
  SET player_name = EXCLUDED.player_name, cap_hit = EXCLUDED.cap_hit, source = 'spotrac', updated_at = now()
  WHERE public.player_salaries.source <> 'manual';

  FOR g IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    SELECT * INTO previous FROM public.salary_match_reviews
    WHERE season_id = p_season AND group_key = g->>'key';
    IF NOT FOUND OR previous.fingerprint <> g->>'fingerprint' THEN
      SELECT COALESCE(jsonb_object_agg(s.nhl_player_id::text, s.cap_hit), '{}'::jsonb)
      INTO prior_salaries
      FROM public.player_salaries s
      WHERE s.season_id = p_season AND s.cap_hit > 0
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(g->'details'->'players') AS candidate(value)
                    WHERE (candidate.value->>'id')::integer = s.nhl_player_id);
      IF previous.status = 'pending' THEN
        prior_salaries := COALESCE(previous.details->'previousSalaries', '{}'::jsonb) || prior_salaries;
      END IF;
      INSERT INTO public.salary_match_reviews (season_id, group_key, fingerprint, details, status)
      VALUES (p_season, g->>'key', g->>'fingerprint',
              (g->'details') || jsonb_build_object('previousSalaries', prior_salaries), 'pending')
      ON CONFLICT (season_id, group_key) DO UPDATE
      SET fingerprint = EXCLUDED.fingerprint, details = EXCLUDED.details, status = 'pending',
          reviewed_by = NULL, reviewed_at = NULL;
      FOR p IN SELECT value FROM jsonb_array_elements(g->'details'->'players') LOOP
        INSERT INTO public.player_salaries (season_id, nhl_player_id, player_name, cap_hit, source, updated_at)
        VALUES (p_season, (p->>'id')::integer, p->>'fullName', 0, 'spotrac', now())
        ON CONFLICT (season_id, nhl_player_id) DO UPDATE
        SET player_name = EXCLUDED.player_name, cap_hit = 0, source = 'spotrac', updated_at = now();
      END LOOP;
    END IF;
  END LOOP;
  DELETE FROM public.salary_match_reviews r
  WHERE r.season_id = p_season AND r.status = 'resolved'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_groups) AS incoming(value)
                    WHERE incoming.value->>'key' = r.group_key);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_salary_match(
  p_season text, p_key text, p_fingerprint text, p_actor uuid, p_choices jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  review public.salary_match_reviews%ROWTYPE;
  player jsonb;
  choice jsonb;
  cap numeric;
  salary_index integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('salary_sync'), hashtext(p_season));
  SELECT * INTO review FROM public.salary_match_reviews
  WHERE season_id = p_season AND group_key = p_key FOR UPDATE;
  IF NOT FOUND OR review.status <> 'pending' OR review.fingerprint <> p_fingerprint THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_choices) <> 'array'
     OR jsonb_array_length(p_choices) <> jsonb_array_length(review.details->'players')
     OR (SELECT count(DISTINCT value->>'playerId') FROM jsonb_array_elements(p_choices))
       <> jsonb_array_length(review.details->'players') THEN
    RAISE EXCEPTION 'A choice is required for every player';
  END IF;
  FOR player IN SELECT value FROM jsonb_array_elements(review.details->'players') LOOP
    SELECT value INTO choice FROM jsonb_array_elements(p_choices)
    WHERE value->>'playerId' = player->>'id';
    IF choice IS NULL THEN RAISE EXCEPTION 'Missing player choice'; END IF;
    IF choice->>'kind' = 'unknown' THEN
      cap := 0;
    ELSIF choice->>'kind' = 'previous' THEN
      cap := (review.details->'previousSalaries'->>(player->>'id'))::numeric;
      IF cap IS NULL OR cap <= 0 THEN RAISE EXCEPTION 'No previous salary available'; END IF;
    ELSIF choice->>'kind' = 'manual' AND jsonb_typeof(choice->'capHit') = 'number' THEN
      cap := (choice->>'capHit')::numeric;
      IF cap <= 0 OR cap >= 10000 THEN RAISE EXCEPTION 'Invalid salary'; END IF;
    ELSIF choice->>'kind' = 'source' AND jsonb_typeof(choice->'index') = 'number' THEN
      IF (choice->>'index') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid source salary'; END IF;
      salary_index := (choice->>'index')::integer;
      IF salary_index >= jsonb_array_length(review.details->'salaries') THEN
        RAISE EXCEPTION 'Invalid source salary';
      END IF;
      cap := (review.details->'salaries'->salary_index->>'capHit')::numeric;
    ELSE
      RAISE EXCEPTION 'Invalid salary choice';
    END IF;
    INSERT INTO public.player_salaries (season_id, nhl_player_id, player_name, cap_hit, source, updated_at)
    VALUES (p_season, (player->>'id')::integer, player->>'fullName', cap, 'manual', now())
    ON CONFLICT (season_id, nhl_player_id) DO UPDATE
    SET player_name = EXCLUDED.player_name, cap_hit = EXCLUDED.cap_hit, source = 'manual', updated_at = now();
  END LOOP;
  UPDATE public.salary_match_reviews SET status = 'resolved', reviewed_by = p_actor, reviewed_at = now()
  WHERE season_id = p_season AND group_key = p_key;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_salary_sync(text, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_salary_match(text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_salary_sync(text, timestamptz, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_salary_match(text, text, text, uuid, jsonb) TO service_role;
