import type {
  DraftPick,
  DraftTeam,
  ScoringWeight,
  TeamStanding,
  NHLSkater,
  NHLGoalie,
} from './types';

export type PlayerStatsMap = Map<number, NHLSkater | NHLGoalie>;

/**
 * Calculates raw points scored by a player based on draft scoring weights
 */
export function scoreRawPlayer(
  player: NHLSkater | NHLGoalie,
  position: string,
  weights: ScoringWeight[]
): number {
  let score = 0;

  for (const w of weights) {
    if (!w.enabled || !w.weight) continue;
    const wn = Number(w.weight);

    if (position === 'G') {
      const g = player as NHLGoalie;
      switch (w.stat) {
        case 'goalie_wins':
          score += (g.wins || 0) * wn;
          break;
        case 'shutouts':
          score += (g.shutouts || 0) * wn;
          break;
        case 'gaa':
          score += (g.goalsAgainstAverage || 0) * wn;
          break;
        case 'save_pct':
          score += (g.savePct || 0) * wn;
          break;
        case 'ot_losses':
          score += (g.otLosses || 0) * wn;
          break;
        case 'goals':
          score += (g.goals || 0) * wn;
          break;
        case 'assists':
          score += (g.assists || 0) * wn;
          break;
        case 'points':
          score += (g.points || 0) * wn;
          break;
      }
    } else {
      const s = player as NHLSkater;
      switch (w.stat) {
        case 'goals':
          score += (s.goals || 0) * wn;
          break;
        case 'assists':
          score += (s.assists || 0) * wn;
          break;
        case 'points':
          score += (s.points || 0) * wn;
          break;
        case 'plus_minus':
          score += (s.plusMinus || 0) * wn;
          break;
        case 'pim':
          score += (s.penaltyMinutes || 0) * wn;
          break;
        case 'blocked_shots':
          score += (s.blockedShots || 0) * wn;
          break;
        case 'hits':
          score += (s.hits || 0) * wn;
          break;
        case 'ot_goals':
          score += (s.otGoals || 0) * wn;
          break;
      }
    }
  }

  return Math.round(score * 100) / 100;
}

/**
 * Computes the active points for a draft pick:
 * points = score_before_current_status + (current_raw_score - snapshot_at_activation)
 */
export function getPickScore(
  pick: DraftPick,
  playerStats: PlayerStatsMap,
  weights: ScoringWeight[]
): number {
  if (pick.roster_status !== 'active') {
    return Number(pick.score_before_current_status || 0);
  }

  const nhlPlayer = playerStats.get(pick.nhl_player_id);
  if (!nhlPlayer) {
    return Number(pick.score_before_current_status || 0);
  }

  const currentRaw = scoreRawPlayer(nhlPlayer, pick.player_position, weights);
  const baseline = Number(pick.score_snapshot?.score ?? 0);
  const currentStintScore = Math.max(0, currentRaw - baseline);
  const total = Number(pick.score_before_current_status || 0) + currentStintScore;

  return Math.round(total * 100) / 100;
}

/**
 * Computes sorted standings across all teams in a draft
 */
export function computeDraftStandings(
  teams: DraftTeam[],
  picks: DraftPick[],
  playerStats: PlayerStatsMap,
  weights: ScoringWeight[]
): TeamStanding[] {
  const standings: TeamStanding[] = teams.map((team) => {
    const teamPicks = picks.filter((p) => p.draft_team_id === team.id);
    const activePicks = teamPicks.filter((p) => p.roster_status === 'active');
    const irPicks = teamPicks.filter((p) => p.roster_status === 'ir');

    const totalPoints = activePicks.reduce((acc, pick) => {
      return acc + getPickScore(pick, playerStats, weights);
    }, 0);

    const totalCapHit = activePicks.reduce((acc, pick) => {
      return acc + Number(pick.cap_hit || 0);
    }, 0);

    return {
      teamId: team.id,
      teamName: team.team_name,
      ownerName: team.owner_name || 'Unassigned',
      totalPoints: Math.round(totalPoints * 100) / 100,
      activePlayersCount: activePicks.length,
      irPlayersCount: irPicks.length,
      totalCapHit: Math.round(totalCapHit * 100) / 100,
      rank: 0,
    };
  });

  // Sort descending by total points, tie-breaker: lower cap hit
  standings.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    return a.totalCapHit - b.totalCapHit;
  });

  // Assign ranks
  standings.forEach((st, idx) => {
    st.rank = idx + 1;
  });

  return standings;
}
