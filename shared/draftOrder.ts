export type PickOrderType = 'snake' | 'linear';

// Returns the 0-based index into the teams list (sorted by draft_order) that picks at pickNumber (1-based).
export function teamIndexForPick(numTeams: number, pickNumber: number, type: PickOrderType = 'snake'): number {
  if (numTeams <= 0) return -1;
  const round = Math.floor((pickNumber - 1) / numTeams) + 1;
  const pickInRound = (pickNumber - 1) % numTeams;
  return type === 'snake' && round % 2 === 0 ? numTeams - 1 - pickInRound : pickInRound;
}

export function roundForPick(numTeams: number, pickNumber: number): number {
  return numTeams > 0 ? Math.floor((pickNumber - 1) / numTeams) + 1 : 1;
}
