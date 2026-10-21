-- ============================================================================
-- HockeyPool SQL Helper Functions (Supabase)
-- ============================================================================

-- Function: Apply Due Roster Transactions (called via cron or API worker)
CREATE OR REPLACE FUNCTION public.apply_due_roster_transactions()
RETURNS INTEGER AS $$
DECLARE
  v_transaction RECORD;
  v_player RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_transaction IN
    SELECT id, draft_id, draft_team_id
    FROM public.roster_transactions
    WHERE status = 'pending' AND effective_at <= NOW()
    ORDER BY effective_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Process each player in the transaction
    FOR v_player IN
      SELECT p.id, p.nhl_player_id, p.roster_status, tp.to_status
      FROM public.roster_transaction_players tp
      JOIN public.draft_picks p ON p.id = tp.draft_pick_id
      WHERE tp.transaction_id = v_transaction.id
    LOOP
      UPDATE public.draft_picks
      SET
        roster_status = v_player.to_status,
        -- When moving to IR, status changes to IR and score is preserved
        -- When moving to Active, status changes to Active
        created_at = created_at
      WHERE id = v_player.id;
    END LOOP;

    -- Mark transaction as applied
    UPDATE public.roster_transactions
    SET status = 'applied'
    WHERE id = v_transaction.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
