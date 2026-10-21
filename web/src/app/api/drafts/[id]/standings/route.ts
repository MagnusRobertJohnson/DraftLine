import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSkaters, getGoalies } from '@shared/nhl';
import { computeDraftStandings, getPickScore } from '@shared/scoring';
import type { DraftTeam, DraftPick, ScoringWeight, NHLSkater, NHLGoalie } from '@shared/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;

    // Load draft
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('drafts')
      .select('*')
      .eq('id', draftId)
      .single();

    if (draftErr || !draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    // Load scoring weights
    const { data: weights } = await supabaseAdmin
      .from('draft_scoring_weights')
      .select('*')
      .eq('draft_id', draftId);

    // Load teams
    const { data: teams } = await supabaseAdmin
      .from('draft_teams')
      .select('*, profiles(display_name, email)')
      .eq('draft_id', draftId)
      .order('draft_order', { ascending: true });

    // Load picks
    const { data: picks } = await supabaseAdmin
      .from('draft_picks')
      .select('*')
      .eq('draft_id', draftId);

    // Format teams with owner names
    const formattedTeams: DraftTeam[] = (teams || []).map((t: any) => ({
      id: t.id,
      draft_id: t.draft_id,
      user_id: t.user_id,
      team_name: t.team_name,
      draft_order: t.draft_order,
      owner_name: t.profiles?.display_name || t.profiles?.email || 'Unassigned',
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    // Fetch live NHL stats
    const gameType = draft.season_type === 'playoffs' ? '3' : '2';
    const [skaters, goalies] = await Promise.all([
      getSkaters(gameType, draft.season_id).catch(() => []),
      getGoalies(gameType, draft.season_id).catch(() => []),
    ]);

    const playerMap = new Map<number, NHLSkater | NHLGoalie>();
    for (const s of skaters) playerMap.set(s.playerId, s);
    for (const g of goalies) playerMap.set(g.playerId, g);

    // Compute team standings
    const standings = computeDraftStandings(
      formattedTeams,
      (picks || []) as DraftPick[],
      playerMap,
      (weights || []) as ScoringWeight[]
    );

    // Attach individual player scores for roster breakdowns
    const picksWithScores = (picks || []).map((p: any) => {
      const liveScore = getPickScore(p, playerMap, (weights || []) as ScoringWeight[]);
      const nhlPlayer = playerMap.get(p.nhl_player_id);
      return {
        ...p,
        liveScore,
        stats: nhlPlayer || null,
      };
    });

    const teamStyles: Record<string, { color: string | null; icon: string | null }> = {};
    for (const t of teams || []) teamStyles[(t as any).id] = { color: (t as any).team_color, icon: (t as any).team_icon };

    return NextResponse.json({
      draft,
      standings,
      picks: picksWithScores,
      weights,
      teamStyles,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to compute standings' }, { status: 500 });
  }
}
