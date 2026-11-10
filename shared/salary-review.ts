import type { SalaryReview, SalaryReviewChoice } from './salary';

export type SalaryReviewInputs = Record<number, { selection: string; manual: string }>;

export function buildSalaryReviewChoices(review: SalaryReview, inputs: SalaryReviewInputs): SalaryReviewChoice[] {
  return review.details.players.map((player) => {
    const input = inputs[player.id];
    if (!input) throw new Error(`Choose a salary or unknown for ${player.fullName} (NHL ID ${player.id}).`);
    if (input.selection === 'unknown') return { playerId: player.id, kind: 'unknown' };
    if (input.selection === 'previous' && Number(review.details.previousSalaries?.[player.id]) > 0) {
      return { playerId: player.id, kind: 'previous' };
    }
    if (input.selection === 'manual') {
      const value = input.manual.trim();
      const capHit = Number(value);
      if (!/^\d+(?:\.\d{1,2})?$/.test(value) || capHit < 0.01 || capHit >= 10000) {
        throw new Error(`Enter a salary from 0.01 to 9999.99 with at most two decimals for ${player.fullName}.`);
      }
      return { playerId: player.id, kind: 'manual', capHit };
    }
    const match = /^source:(\d+)$/.exec(input.selection);
    if (match && Number(match[1]) < review.details.salaries.length) {
      return { playerId: player.id, kind: 'source', index: Number(match[1]) };
    }
    throw new Error(`Choose a salary or unknown for ${player.fullName} (NHL ID ${player.id}).`);
  });
}
