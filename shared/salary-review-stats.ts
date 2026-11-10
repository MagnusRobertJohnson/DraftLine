import type { NHLGoalie, NHLSkater } from './types';

export interface SalaryReviewStatsSnapshot {
  season: string;
  updatedAt: string;
  skaters: NHLSkater[];
  goalies: NHLGoalie[];
}

export interface SalaryReviewPlayerInfo {
  position: string | null;
  stats: string | null;
  season: string | null;
  updatedAt: string | null;
}

export function previousSeason(season: string): string {
  const start = Number(season.slice(0, 4)) - 1;
  return `${start}${start + 1}`;
}

export function seasonHasGames(snapshot: SalaryReviewStatsSnapshot): boolean {
  return [...snapshot.skaters, ...snapshot.goalies].some((player) => player.gamesPlayed > 0);
}

export function reviewPlayerInfo(
  playerId: number,
  current: SalaryReviewStatsSnapshot | null,
  previous: SalaryReviewStatsSnapshot | null
): SalaryReviewPlayerInfo {
  const currentSkater = current?.skaters.find((player) => player.playerId === playerId);
  const currentGoalie = current?.goalies.find((player) => player.playerId === playerId);
  const snapshot = current && seasonHasGames(current) ? current : previous;
  const skater = snapshot?.skaters.find((player) => player.playerId === playerId);
  const goalie = snapshot?.goalies.find((player) => player.playerId === playerId);
  const position = currentSkater?.positionCode || (currentGoalie ? 'G' : null) ||
    skater?.positionCode || (goalie ? 'G' : null);
  if (skater) {
    return {
      position, season: snapshot!.season, updatedAt: snapshot!.updatedAt,
      stats: `${skater.gamesPlayed} GP · ${skater.goals} G · ${skater.assists} A · ${skater.points} P`,
    };
  }
  if (goalie) {
    return {
      position, season: snapshot!.season, updatedAt: snapshot!.updatedAt,
      stats: `${goalie.gamesPlayed} GP · ${goalie.wins} W · ${goalie.losses} L · ${goalie.otLosses} OTL · ${goalie.goalsAgainstAverage.toFixed(2)} GAA · ${goalie.savePct.toFixed(3)} SV%`,
    };
  }
  return { position, stats: null, season: null, updatedAt: null };
}

export function formatReviewPlayerStats(info: SalaryReviewPlayerInfo | undefined): string {
  if (!info?.stats || !info.season || !info.updatedAt) return 'Stats unavailable';
  return `${info.season.slice(0, 4)}–${info.season.slice(4)} regular season: ${info.stats} (updated ${new Date(info.updatedAt).toLocaleString()})`;
}
