// NHL Official REST API Client (HockeyPool)
// Provides skater and goalie statistics for Regular Season and Playoffs

import type { NHLSkater, NHLGoalie } from './types';

// The NHL season starts in the fall: from September on it is YYYY/YYYY+1, otherwise (YYYY-1)/YYYY.
export function currentSeasonStartYear(now = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

export const CURRENT_SEASON = `${currentSeasonStartYear()}${currentSeasonStartYear() + 1}`;

const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD',
  'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
];

export interface RosterPlayer {
  playerId: number;
  fullName: string;
  positionCode: string;
  teamAbbrev: string;
}

// Current team rosters, so players with no games played yet (rookies, call-ups, scratches)
// can still be listed. Teams that fail to load are skipped.
export async function getRosterPlayers(): Promise<RosterPlayer[]> {
  const results = await Promise.all(
    NHL_TEAMS.map(async (team) => {
      try {
        const res = await fetch(`https://api-web.nhle.com/v1/roster/${team}/current`, { cache: 'no-store' });
        if (!res.ok) return [];
        const json = await res.json();
        const rows = [...(json.forwards ?? []), ...(json.defensemen ?? []), ...(json.goalies ?? [])];
        return rows.map((p: any) => ({
          playerId: Number(p.id),
          fullName: `${p.firstName?.default ?? ''} ${p.lastName?.default ?? ''}`.trim(),
          positionCode: String(p.positionCode ?? 'F'),
          teamAbbrev: team,
        })) as RosterPlayer[];
      } catch {
        return [];
      }
    })
  );
  return results.flat().filter((p) => p.playerId && p.fullName);
}

// Game Types: 2 = Regular Season, 3 = Playoffs
export type GameTypeId = '2' | '3';

function buildSeasonFilter(season: string) {
  return `seasonId%3E=${season}%20and%20seasonId%3C=${season}%20and%20gamesPlayed%3E=0`;
}

function buildSkaterSummaryUrl(gameTypeId: GameTypeId, season: string) {
  const filter = `gameTypeId=${gameTypeId}%20and%20${buildSeasonFilter(season)}`;
  return `https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22:%22points%22,%22direction%22:%22DESC%22%7D,%7B%22property%22:%22goals%22,%22direction%22:%22DESC%22%7D%5D&cayenneExp=${filter}`;
}

function buildSkaterRealtimeUrl(gameTypeId: GameTypeId, season: string) {
  const filter = `gameTypeId=${gameTypeId}%20and%20${buildSeasonFilter(season)}`;
  return `https://api.nhle.com/stats/rest/en/skater/realtime?isAggregate=false&isGame=false&sort=%5B%7B%22property%22:%22hits%22,%22direction%22:%22DESC%22%7D%5D&cayenneExp=${filter}`;
}

function buildGoalieSummaryUrl(gameTypeId: GameTypeId, season: string) {
  const filter = `gameTypeId=${gameTypeId}%20and%20${buildSeasonFilter(season)}`;
  return `https://api.nhle.com/stats/rest/en/goalie/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22:%22wins%22,%22direction%22:%22DESC%22%7D%5D&cayenneExp=${filter}`;
}

export class NhlRateLimitError extends Error {
  constructor() {
    super('The NHL stats service is rate limiting requests. Please wait a few minutes and try again.');
    this.name = 'NhlRateLimitError';
  }
}

async function fetchStatsPage(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const startedAt = Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status !== 429) return res;
    const header = res.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    const date = header === null ? NaN : Date.parse(header);
    const requestUrl = new URL(url);
    const pageStart = requestUrl.searchParams.get('start');
    console.warn('NHL stats rate limit', {
      endpoint: requestUrl.pathname,
      pageStart: pageStart !== null && /^\d+$/.test(pageStart) ? Number(pageStart) : null,
      status: res.status,
      attempt: attempt + 1,
      durationMs: Date.now() - startedAt,
      retryAfter: header === null ? null : Number.isFinite(seconds) ? seconds
        : Number.isFinite(date) ? new Date(date).toUTCString() : 'invalid',
    });
    if (attempt === 2) throw new NhlRateLimitError();
    const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
      : Number.isFinite(date) ? Math.max(0, date - Date.now())
      : 1000 * (attempt + 1);
    if (delay > 5000) throw new NhlRateLimitError();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new NhlRateLimitError();
}

async function fetchAllPages(baseUrl: string, pageSize = 100): Promise<Record<string, any>[]> {
  let start = 0;
  const all: Record<string, any>[] = [];

  while (true) {
    const res = await fetchStatsPage(`${baseUrl}&start=${start}&limit=${pageSize}`);
    if (!res.ok) {
      throw new Error(`NHL API error: ${res.status} from ${baseUrl}`);
    }
    const json = await res.json();
    const page = (json.data ?? []) as Record<string, any>[];
    all.push(...page);

    if (page.length === 0 || all.length >= (json.total ?? all.length)) {
      break;
    }
    start += pageSize;
  }

  return all;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  key: string;
}

let skaterCache: CacheEntry<NHLSkater[]> | null = null;
let goalieCache: CacheEntry<NHLGoalie[]> | null = null;

function isFresh<T>(entry: CacheEntry<T> | null, key: string): entry is CacheEntry<T> {
  return entry !== null && entry.key === key && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

export async function getSkaters(
  gameTypeId: GameTypeId = '2',
  season = CURRENT_SEASON
): Promise<NHLSkater[]> {
  const key = `${season}:${gameTypeId}`;
  if (isFresh(skaterCache, key)) {
    return skaterCache.data;
  }

  const [summaryRows, realtimeRows] = await Promise.all([
    fetchAllPages(buildSkaterSummaryUrl(gameTypeId, season)),
    fetchAllPages(buildSkaterRealtimeUrl(gameTypeId, season)),
  ]);

  const realtimeMap = new Map<number, { hits?: number; blockedShots?: number }>();
  for (const r of realtimeRows) {
    realtimeMap.set(Number(r.playerId), {
      hits: Number(r.hits ?? 0),
      blockedShots: Number(r.blockedShots ?? 0),
    });
  }

  const rawSkaters: NHLSkater[] = summaryRows.map((row) => {
    const pId = Number(row.playerId);
    const rt = realtimeMap.get(pId) ?? {};

    return {
      playerId: pId,
      skaterFullName: String(row.skaterFullName ?? ''),
      positionCode: String(row.positionCode ?? 'F'),
      teamAbbrevs: String(row.teamAbbrevs ?? ''),
      gamesPlayed: Number(row.gamesPlayed ?? 0),
      goals: Number(row.goals ?? 0),
      assists: Number(row.assists ?? 0),
      points: Number(row.points ?? 0),
      plusMinus: Number(row.plusMinus ?? 0),
      penaltyMinutes: Number(row.penaltyMinutes ?? 0),
      blockedShots: rt.blockedShots ?? 0,
      hits: rt.hits ?? 0,
      shots: Number(row.shots ?? 0),
      otGoals: Number(row.otGoals ?? 0),
    };
  });

  // Deduplicate by playerId (traded players appear multiple times — keep entry with higher games played)
  const seenSkaters = new Map<number, NHLSkater>();
  for (const s of rawSkaters) {
    const existing = seenSkaters.get(s.playerId);
    if (!existing || s.gamesPlayed > existing.gamesPlayed) {
      seenSkaters.set(s.playerId, s);
    }
  }
  const skaters = Array.from(seenSkaters.values());

  skaterCache = { data: skaters, fetchedAt: Date.now(), key };
  return skaters;
}

export async function getGoalies(
  gameTypeId: GameTypeId = '2',
  season = CURRENT_SEASON
): Promise<NHLGoalie[]> {
  const key = `${season}:${gameTypeId}`;
  if (isFresh(goalieCache, key)) {
    return goalieCache.data;
  }

  const rows = await fetchAllPages(buildGoalieSummaryUrl(gameTypeId, season));

  const rawGoalies: NHLGoalie[] = rows.map((row) => ({
    playerId: Number(row.playerId),
    goalieFullName: String(row.goalieFullName ?? ''),
    teamAbbrevs: String(row.teamAbbrevs ?? ''),
    gamesPlayed: Number(row.gamesPlayed ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    otLosses: Number(row.otLosses ?? 0),
    shutouts: Number(row.shutouts ?? 0),
    shotsAgainst: Number(row.shotsAgainst ?? 0),
    goalsAgainst: Number(row.goalsAgainst ?? 0),
    goalsAgainstAverage: Number(row.goalsAgainstAverage ?? 0),
    savePct: Number(row.savePct ?? 0),
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    points: Number(row.points ?? 0),
  }));

  // Deduplicate by playerId (traded goalies appear multiple times — keep entry with higher games played)
  const seenGoalies = new Map<number, NHLGoalie>();
  for (const g of rawGoalies) {
    const existing = seenGoalies.get(g.playerId);
    if (!existing || g.gamesPlayed > existing.gamesPlayed) {
      seenGoalies.set(g.playerId, g);
    }
  }
  const goalies = Array.from(seenGoalies.values());

  goalieCache = { data: goalies, fetchedAt: Date.now(), key };
  return goalies;
}
