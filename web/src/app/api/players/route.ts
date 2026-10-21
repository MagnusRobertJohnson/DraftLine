import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSkaters, getGoalies, CURRENT_SEASON } from '@shared/nhl';
import { fetchSpotracSalaries, matchSalariesWithNHL } from '@shared/salary';
import { authenticateAdmin, getOptionalUserId } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STATS_MAX_AGE_MS = 60 * 60 * 1000; // refresh stats at most once an hour

async function refreshStatsCache(season: string, gameType: '2' | '3') {
  const [skaters, goalies] = await Promise.all([
    getSkaters(gameType, season),
    getGoalies(gameType, season),
  ]);
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
        .select('nhl_player_id, cap_hit')
        .eq('season_id', season),
    ]);

    let stats: { skaters: any[]; goalies: any[]; updatedAt: string } | null = cacheRes.data
      ? {
          skaters: cacheRes.data.skaters,
          goalies: cacheRes.data.goalies,
          updatedAt: cacheRes.data.updated_at,
        }
      : null;

    const stale = !stats || Date.now() - new Date(stats.updatedAt).getTime() > STATS_MAX_AGE_MS;
    if (stale) {
      try {
        stats = await refreshStatsCache(season, gameType);
      } catch (err) {
        console.error('Stats refresh failed, serving saved snapshot if any:', err);
      }
    }
    if (!stats) throw new Error('Player stats are unavailable right now');

    const salaryMap = new Map<number, number>();
    for (const row of salariesRes.data ?? []) {
      salaryMap.set(row.nhl_player_id, Number(row.cap_hit));
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
    const body = await request.json().catch(() => ({}));
    const seasonId = body.seasonId || CURRENT_SEASON;

    // 1. Fetch live salary entries directly from Spotrac across pages
    const salaryEntries = await fetchSpotracSalaries();
    if (salaryEntries.length === 0) {
      return NextResponse.json(
        { error: 'No contract records returned from source. Spotrac may be temporarily unreachable.' },
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

    // 4. Upsert the shared automatic salaries (admin overrides live in their own table)
    const rows = matchResult.matched.map((m) => ({
      season_id: seasonId,
      nhl_player_id: m.playerId,
      player_name: m.playerName,
      cap_hit: m.capHit,
      source: 'spotrac',
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error: upsertErr } = await supabaseAdmin
          .from('player_salaries')
          .upsert(batch, { onConflict: 'season_id,nhl_player_id' });
        if (upsertErr) throw upsertErr;
      }
    }

    const coveredIds = new Set(matchResult.matched.map((m) => m.playerId));
    const missingPlayers = nhlPlayers.filter((p) => !coveredIds.has(p.id)).map((p) => p.fullName);

    return NextResponse.json({
      success: true,
      totalSourceEntries: salaryEntries.length,
      matchedCount: matchResult.matched.length,
      unmatchedCount: matchResult.unmatched.length,
      missingPlayers,
    });
  } catch (err: any) {
    console.error('Salary sync error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to sync salaries' },
      { status: 500 }
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
