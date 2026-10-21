import type { Draft, DraftPick } from './types';

export interface SwapValidationResult {
  valid: boolean;
  error?: string;
  projectedActiveCapHit?: number;
}

/**
 * Normalizes positions into category groups:
 * Forwards ('C', 'L', 'R', 'F') -> 'F'
 * Defense ('D') -> 'D'
 * Goalies ('G') -> 'G'
 */
export function normalizePositionGroup(pos: string): 'F' | 'D' | 'G' {
  const p = (pos || '').toUpperCase();
  if (['C', 'L', 'R', 'F'].includes(p)) return 'F';
  if (p === 'D') return 'D';
  if (p === 'G') return 'G';
  return 'F';
}

/**
 * Validates a multi-player IR swap:
 * 1. Must select at least one player in and one player out (non-empty).
 * 2. outgoingActivePicks (moving to IR) count must equal incomingIrPicks (moving to Active) count.
 * 3. Position group parity must match:
 *    Number of Fs out == Number of Fs in
 *    Number of Ds out == Number of Ds in
 *    Number of Gs out == Number of Gs in
 * 4. No player can be in both lists.
 * 5. If salary cap is enabled, active roster cap hit after the swap must be <= draft.salary_cap_amount.
 */
export function validateRosterSwap(
  draft: Draft,
  currentRoster: DraftPick[],
  outgoingActivePickIds: string[],
  incomingIrPickIds: string[]
): SwapValidationResult {
  if (outgoingActivePickIds.length === 0 || incomingIrPickIds.length === 0) {
    return { valid: false, error: 'Must select at least one active player and one IR player to swap.' };
  }

  if (outgoingActivePickIds.length !== incomingIrPickIds.length) {
    return {
      valid: false,
      error: `Number of outgoing players (${outgoingActivePickIds.length}) must match incoming players (${incomingIrPickIds.length}).`,
    };
  }

  const pickMap = new Map<string, DraftPick>(currentRoster.map((p) => [p.id, p]));

  // Check outgoing players are currently active
  const outgoingPicks: DraftPick[] = [];
  for (const id of outgoingActivePickIds) {
    const pick = pickMap.get(id);
    if (!pick) {
      return { valid: false, error: `Selected active player not found in roster.` };
    }
    if (pick.roster_status !== 'active') {
      return { valid: false, error: `${pick.player_name} is not on the active roster.` };
    }
    outgoingPicks.push(pick);
  }

  // Check incoming players are currently IR
  const incomingPicks: DraftPick[] = [];
  for (const id of incomingIrPickIds) {
    const pick = pickMap.get(id);
    if (!pick) {
      return { valid: false, error: `Selected IR player not found in roster.` };
    }
    if (pick.roster_status !== 'ir') {
      return { valid: false, error: `${pick.player_name} is not on Injured Reserve.` };
    }
    incomingPicks.push(pick);
  }

  // Check for duplicate picks
  const allIds = new Set([...outgoingActivePickIds, ...incomingIrPickIds]);
  if (allIds.size !== outgoingActivePickIds.length + incomingIrPickIds.length) {
    return { valid: false, error: 'A player cannot be selected on both sides of the swap.' };
  }

  // Check position balance
  const outgoingCounts = { F: 0, D: 0, G: 0 };
  const incomingCounts = { F: 0, D: 0, G: 0 };

  for (const p of outgoingPicks) {
    outgoingCounts[normalizePositionGroup(p.player_position)]++;
  }
  for (const p of incomingPicks) {
    incomingCounts[normalizePositionGroup(p.player_position)]++;
  }

  if (
    outgoingCounts.F !== incomingCounts.F ||
    outgoingCounts.D !== incomingCounts.D ||
    outgoingCounts.G !== incomingCounts.G
  ) {
    return {
      valid: false,
      error: `Position mismatch: Swapping out (${outgoingCounts.F}F, ${outgoingCounts.D}D, ${outgoingCounts.G}G) must match incoming (${incomingCounts.F}F, ${incomingCounts.D}D, ${incomingCounts.G}G).`,
    };
  }

  // Calculate projected active salary cap
  const outgoingIdSet = new Set(outgoingActivePickIds);
  const remainingActivePicks = currentRoster.filter(
    (p) => p.roster_status === 'active' && !outgoingIdSet.has(p.id)
  );

  const projectedActivePicks = [...remainingActivePicks, ...incomingPicks];
  const projectedCapHit = projectedActivePicks.reduce((acc, p) => acc + Number(p.cap_hit || 0), 0);
  const roundedCapHit = Math.round(projectedCapHit * 100) / 100;

  if (draft.salary_cap_enabled) {
    if (roundedCapHit > draft.salary_cap_amount + 0.0001) {
      return {
        valid: false,
        error: `Projected cap hit of $${roundedCapHit.toFixed(2)}M exceeds the salary cap limit of $${draft.salary_cap_amount.toFixed(2)}M.`,
        projectedActiveCapHit: roundedCapHit,
      };
    }
  }

  return {
    valid: true,
    projectedActiveCapHit: roundedCapHit,
  };
}

/**
 * Calculates next Eastern Time midnight for transaction scheduling
 */
export function getNextEasternMidnight(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value);
  const nextDate = new Date(Date.UTC(value('year'), value('month') - 1, value('day') + 1, 5));

  const easternHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(nextDate)
  );

  return new Date(nextDate.getTime() - easternHour * 60 * 60 * 1000);
}
