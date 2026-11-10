import { NextRequest, NextResponse } from 'next/server';
import { CURRENT_SEASON, getGoalies, getSkaters } from '@shared/nhl';
import { previousSeason, reviewPlayerInfo, seasonHasGames, type SalaryReviewStatsSnapshot } from '@shared/salary-review-stats';
import type { SalaryReview } from '@shared/salary';
import { authenticateAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = await authenticateAdmin(request);
  if (auth.error) return auth.error;
  const { data, error } = await supabaseAdmin.from('salary_match_reviews')
    .select('group_key, fingerprint, details')
    .eq('season_id', CURRENT_SEASON).eq('status', 'pending').order('group_key');
  if (error) {
    console.error('Salary review load failed:', error);
    return NextResponse.json({ error: 'Could not load salary reviews. Check that the salary review migration has been applied.' }, { status: 500 });
  }
  const reviews: SalaryReview[] = (data ?? []).map((r) => ({ key: r.group_key, fingerprint: r.fingerprint, details: r.details }));
  if (reviews.length === 0) return NextResponse.json({ reviews, playerInfo: {}, statsWarning: null });
  let current: SalaryReviewStatsSnapshot | null = null;
  let previous: SalaryReviewStatsSnapshot | null = null;
  let statsWarning: string | null = null;
  const { data: cached, error: cacheError } = await supabaseAdmin.from('player_stats_cache')
    .select('season_id, skaters, goalies, updated_at')
    .in('season_id', [CURRENT_SEASON, previousSeason(CURRENT_SEASON)]).eq('game_type', '2');
  if (cacheError) {
    console.error('Salary review stats cache read failed:', cacheError);
    statsWarning = 'Player stats could not be loaded. You can still review salaries.';
  } else {
    for (const row of cached ?? []) {
      const snapshot: SalaryReviewStatsSnapshot = {
        season: row.season_id, updatedAt: row.updated_at, skaters: row.skaters, goalies: row.goalies,
      };
      if (row.season_id === CURRENT_SEASON) current = snapshot;
      else previous = snapshot;
    }
    if (!current) {
      statsWarning = 'Current player stats are unavailable. You can still review salaries.';
    } else if (!seasonHasGames(current) && !previous) {
      try {
        const skaters = await getSkaters('2', previousSeason(CURRENT_SEASON));
        const goalies = await getGoalies('2', previousSeason(CURRENT_SEASON));
        previous = { season: previousSeason(CURRENT_SEASON), updatedAt: new Date().toISOString(), skaters, goalies };
      } catch (statsError) {
        console.error('Salary review previous-season stats fetch failed:', statsError);
        statsWarning = 'Last season’s stats could not be loaded. You can still review salaries.';
      }
    }
  }
  const playerInfo = Object.fromEntries(reviews.flatMap((review) =>
    review.details.players.map((player) => [player.id, reviewPlayerInfo(player.id, current, previous)])
  ));
  return NextResponse.json({
    reviews, playerInfo, statsWarning,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateAdmin(request);
  if (auth.error || !auth.userId) return auth.error!;
  try {
    const body = await request.json();
    if (typeof body.key !== 'string' || typeof body.fingerprint !== 'string' ||
        !Array.isArray(body.choices) || !body.choices.every((choice: unknown) => {
          if (!choice || typeof choice !== 'object') return false;
          const c = choice as Record<string, unknown>;
          if (!Number.isSafeInteger(c.playerId) || Number(c.playerId) <= 0) return false;
          if (c.kind === 'unknown' || c.kind === 'previous') return true;
          if (c.kind === 'source') return Number.isSafeInteger(c.index) && Number(c.index) >= 0;
          return c.kind === 'manual' && typeof c.capHit === 'number' &&
            Number.isFinite(c.capHit) && c.capHit >= 0.01 && c.capHit <= 9999.99 &&
            Math.abs(c.capHit * 100 - Math.round(c.capHit * 100)) < 0.000001;
        })) {
      return NextResponse.json({ error: 'Choose a valid salary or unknown for every player.' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc('resolve_salary_match', {
      p_season: CURRENT_SEASON,
      p_key: body.key,
      p_fingerprint: body.fingerprint,
      p_actor: auth.userId,
      p_choices: body.choices,
    });
    if (error) {
      console.error('Salary review save failed:', error);
      return NextResponse.json({ error: 'Could not save this review. Check your choices and try again.' }, { status: 400 });
    }
    if (!data) return NextResponse.json({ error: 'This review has changed or was already resolved. Reload the reviews.' }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Salary review request failed:', error);
    return NextResponse.json({ error: 'Could not process the salary review.' }, { status: 400 });
  }
}
