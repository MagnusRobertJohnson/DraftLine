import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSkaters, getGoalies, getRosterPlayers, CURRENT_SEASON, NhlRateLimitError } from '@shared/nhl';
import { fetchSpotracSalaries, matchSalariesWithNHL } from '@shared/salary';
import { authenticateAdmin, getOptionalUserId } from '@/lib/requireAdmin';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STATS_MAX_AGE_MS = 60 * 60 * 1000; // refresh stats at most once an hour

async function refreshStatsCache(season: string, gameType: '2' | '3') {
  const statSkaters = await getSkaters(gameType, season);
  const statGoalies = await getGoalies(gameType, season);
  const roster = season === CURRENT_SEASON ? await getRosterPlayers() : [];
  const skaters = [...statSkaters];
  const goalies = [...statGoalies];

  // Add rostered players who haven't played yet so they can still be found and priced
  const known = new Set<number>([...skaters.map((s) => s.playerId), ...goalies.map((g) => g.playerId)]);
  for (const p of roster) {
    if (known.has(p.playerId)) continue;
    known.add(p.playerId);
    if (p.positionCode === 'G') {
      goalies.push({
        playerId: p.playerId, goalieFullName: p.fullName, teamAbbrevs: p.teamAbbrev, gamesPlayed: 0,
        wins: 0, losses: 0, otLosses: 0, shutouts: 0, shotsAgainst: 0, goalsAgainst: 0,
        goalsAgainstAverage: 0, savePct: 0, goals: 0, assists: 0, points: 0,
      });
    } else {
      skaters.push({
        playerId: p.playerId, skaterFullName: p.fullName, positionCode: p.positionCode, teamAbbrevs: p.teamAbbrev,
        gamesPlayed: 0, goals: 0, assists: 0, points: 0, plusMinus: 0, penaltyMinutes: 0,
        blockedShots: 0, hits: 0, shots: 0, otGoals: 0,
      });
    }
  }

  const updatedAt = new Date().toISOString();
  const { error } = await supabaseAdmin.from('player_stats_cache').upsert(
    { season_id: season, game_type: gameType, skaters, goalies, updated_at: updatedAt },
    { onConflict: 'season_id,game_type' }
  );
  if (error) console.error('Stats cache write failed:', error.message);
  return { skaters, goalies, updatedAt };
}

// GET: Return the shared saved snapshot of stats plus salary cap hits
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season') || CURRENT_SEASON;
    const gameType = (searchParams.get('gameType') || '2') as '2' | '3';

    const [cacheRes, salariesRes] = await Promise.all([
      supabaseAdmin
        .from('player_stats_cache')
        .select('skaters, goalies, updated_at')
        .eq('season_id', season)
        .eq('game_type', gameType)
        .maybeSingle(),
      supabaseAdmin
        .from('player_salaries')
        .select('nhl_player_id, cap_hit, updated_at')
        .eq('season_id', season)
        .range(0, 4999),
    ]);
    if (cacheRes.error) throw cacheRes.error;
    if (salariesRes.error) throw salariesRes.error;

    let stats: { skaters: any[]; goalies: any[]; updatedAt: string } | null = cacheRes.data
      ? {
          skaters: cacheRes.data.skaters,
          goalies: cacheRes.data.goalies,
          updatedAt: cacheRes.data.updated_at,
        }
      : null;

    let statsWarning: string | null = null;
    const stale = !stats || Date.now() - new Date(stats.updatedAt).getTime() > STATS_MAX_AGE_MS;
    if (stale) {
      try {
        stats = await refreshStatsCache(season, gameType);
      } catch (err) {
        console.error('Stats refresh failed, serving saved snapshot if any:', err);
        statsWarning = err instanceof NhlRateLimitError
          ? 'The NHL stats service is rate limiting requests, so these numbers may be out of date. Try again later.'
          : 'The NHL stats service could not be reached, so these numbers may be out of date.';
      }
    }
    if (!stats) throw new Error(`Player stats are unavailable right now. ${statsWarning || 'Please try again in a few minutes.'}`);

    const salaryMap = new Map<number, number>();
    let salariesUpdatedAt: string | null = null;
    for (const row of salariesRes.data ?? []) {
      salaryMap.set(row.nhl_player_id, Number(row.cap_hit));
      if (row.updated_at && (!salariesUpdatedAt || row.updated_at > salariesUpdatedAt)) {
        salariesUpdatedAt = row.updated_at;
      }
    }

    // Admins also see their own overrides on top of the shared values
    const overrideIds: number[] = [];
    const userId = await getOptionalUserId(request);
    if (userId) {
      const { data: own } = await supabaseAdmin
        .from('admin_salary_overrides')
        .select('nhl_player_id, cap_hit')
        .eq('admin_id', userId)
        .eq('season_id', season);
      for (const row of own ?? []) {
        salaryMap.set(row.nhl_player_id, Number(row.cap_hit));
        overrideIds.push(row.nhl_player_id);
      }
    }

    return NextResponse.json({
      season,
      gameType,
      skaters: stats.skaters.map((s) => ({ ...s, capHit: salaryMap.get(s.playerId) ?? 0 })),
      goalies: stats.goalies.map((g) => ({ ...g, capHit: salaryMap.get(g.playerId) ?? 0 })),
      salariesCount: salaryMap.size,
      overrideIds,
      updatedAt: stats.updatedAt,
      salariesUpdatedAt,
      statsWarning,
    });
  } catch (err: any) {
    console.error('Players API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch players' }, { status: 500 });
  }
}

// POST: Trigger automated salary sync from online sources (Spotrac) or manual override
export async function POST(request: NextRequest) {
  const auth = await authenticateAdmin(request, { allowCron: true });
  if (auth.error) return auth.error;
  try {
    const startedAt = new Date().toISOString();
    const body = await request.json().catch(() => ({}));
    const seasonId = body.seasonId || CURRENT_SEASON;

    // 1. Fetch live salary entries directly from Spotrac across pages
    const salaryEntries = await fetchSpotracSalaries(String(Number(seasonId.slice(0, 4))));
    if (salaryEntries.length === 0) {
      return NextResponse.json(
        { error: 'No contract records came back from Spotrac (it may be down, blocking requests, or have changed its page layout). Existing salaries were left unchanged. You can still set salaries by hand by clicking a player\'s cap hit.' },
        { status: 502 }
      );
    }

    // 2. Refresh the shared stats snapshot and use it to match names with official IDs
    const { skaters, goalies } = await refreshStatsCache(seasonId, '2');

    const nhlPlayers = [
      ...skaters.map((s) => ({ id: s.playerId, fullName: s.skaterFullName, teamAbbrev: s.teamAbbrevs })),
      ...goalies.map((g) => ({ id: g.playerId, fullName: g.goalieFullName, teamAbbrev: g.teamAbbrevs })),
    ];

    // 3. Match salaries to players using exact and fuzzy matching
    const matchResult = matchSalariesWithNHL(salaryEntries, nhlPlayers);
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const groups = matchResult.ambiguous.map((group) => {
      const details = {
        players: [...group.players].sort((a, b) => a.id - b.id),
        salaries: [...group.salaries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
      return {
        key: hash(details.players.map((p) => p.id).join(',')),
        fingerprint: hash(JSON.stringify(details)),
        details,
      };
    });
    const { data: applied, error: syncError } = await supabaseAdmin.rpc('apply_salary_sync', {
      p_season: seasonId, p_started_at: startedAt, p_matches: matchResult.matched, p_groups: groups,
    });
    if (syncError) throw syncError;
    if (!applied) {
      return NextResponse.json({ error: 'A newer salary sync has already finished. Reload the player list.' }, { status: 409 });
    }

    const [reviewResult, salariesResult] = await Promise.all([
      supabaseAdmin.from('salary_match_reviews').select('*', { count: 'exact', head: true })
        .eq('season_id', seasonId).eq('status', 'pending'),
      supabaseAdmin.from('player_salaries').select('nhl_player_id, cap_hit')
        .eq('season_id', seasonId).range(0, 4999),
    ]);
    if (reviewResult.error || salariesResult.error) {
      console.error('Salary sync committed but report could not be loaded:', reviewResult.error || salariesResult.error);
      return NextResponse.json({ error: 'Salaries were updated, but the sync report could not be loaded. Reload the player list.' }, { status: 500 });
    }

    const coveredIds = new Set((salariesResult.data ?? [])
      .filter((row) => Number(row.cap_hit) > 0).map((row) => Number(row.nhl_player_id)));
    const missingPlayers = nhlPlayers.filter((p) => !coveredIds.has(p.id)).map((p) => p.fullName);
    const unmatched = matchResult.unmatched.map((u) => ({
      name: u.sourceName,
      capHit: u.capHit,
      suggestion: u.bestMatch?.playerName,
    }));

    return NextResponse.json({
      success: true,
      totalSourceEntries: salaryEntries.length,
      matchedCount: matchResult.matched.length,
      pendingReviewCount: reviewResult.count ?? 0,
      unmatchedCount: matchResult.unmatched.length,
      missingPlayers,
      unmatched,
    });
  } catch (err: any) {
    console.error('Salary sync error:', err);
    return NextResponse.json(
      { error: err instanceof NhlRateLimitError
        ? `${err.message} No salaries were updated.`
        : err.message || 'Failed to sync salaries' },
      { status: err instanceof NhlRateLimitError ? 503 : 500 }
    );
  }
}

// PUT: Manually set a player's cap hit (protected from automated sync overwrites)
export async function PUT(request: NextRequest) {
  const auth = await authenticateAdmin(request);
  if (auth.error || !auth.userId) return auth.error!;
  try {
    const body = await request.json();
    const playerId = Number(body.playerId);
    const capHit = Number(body.capHit);
    if (!playerId || !Number.isFinite(capHit) || capHit < 0 || capHit >= 10000) {
      return NextResponse.json({ error: 'playerId and a valid capHit are required' }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from('admin_salary_overrides').upsert(
      {
        admin_id: auth.userId,
        season_id: body.seasonId || CURRENT_SEASON,
        nhl_player_id: playerId,
        player_name: body.playerName || String(playerId),
        cap_hit: capHit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'admin_id,season_id,nhl_player_id' }
    );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save salary' }, { status: 500 });
  }
}

// DELETE: Remove the admin's own override so the shared value applies again
export async function DELETE(request: NextRequest) {
  const auth = await authenticateAdmin(request);
  if (auth.error || !auth.userId) return auth.error!;
  try {
    const body = await request.json();
    const { error } = await supabaseAdmin
      .from('admin_salary_overrides')
      .delete()
      .eq('admin_id', auth.userId)
      .eq('season_id', body.seasonId || CURRENT_SEASON)
      .eq('nhl_player_id', Number(body.playerId));
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to reset salary' }, { status: 500 });
  }
}
