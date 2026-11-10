const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previousSeason, seasonHasGames, reviewPlayerInfo, formatReviewPlayerStats } = require('./salary-review-stats.ts');

const skater = (playerId, positionCode, gamesPlayed, goals, assists) =>
  ({ playerId, positionCode, gamesPlayed, goals, assists, points: goals + assists });
const goalie = (playerId, gamesPlayed) =>
  ({ playerId, gamesPlayed, wins: 10, losses: 4, otLosses: 1, goalsAgainstAverage: 2.45, savePct: 0.912 });
const snapshot = (season, skaters, goalies = []) =>
  ({ season, skaters, goalies, updatedAt: '2026-10-20T00:00:00Z' });

test('identifies same-team names by ID, position and current-season stats', () => {
  const current = snapshot('20262027', [skater(1, 'C', 10, 5, 6), skater(2, 'D', 8, 1, 3)]);
  assert.equal(reviewPlayerInfo(1, current, null).position, 'C');
  assert.equal(reviewPlayerInfo(1, current, null).stats, '10 GP · 5 G · 6 A · 11 P');
  assert.equal(reviewPlayerInfo(2, current, null).position, 'D');
  assert.equal(reviewPlayerInfo(2, current, null).stats, '8 GP · 1 G · 3 A · 4 P');
  assert.match(formatReviewPlayerStats(reviewPlayerInfo(1, current, null)), /2026–2027 regular season/);
});

test('before the new season starts, displays the previous season with current position', () => {
  const current = snapshot('20262027', [skater(1, 'D', 0, 0, 0)]);
  const previous = snapshot('20252026', [skater(1, 'C', 60, 12, 20)]);
  assert.equal(previousSeason('20262027'), '20252026');
  assert.equal(seasonHasGames(current), false);
  const result = reviewPlayerInfo(1, current, previous);
  assert.equal(result.position, 'D');
  assert.equal(result.season, '20252026');
  assert.equal(result.stats, '60 GP · 12 G · 20 A · 32 P');
});

test('uses current-season zero-game stats when the season has started', () => {
  const current = snapshot('20262027', [skater(1, 'C', 0, 0, 0), skater(2, 'D', 1, 0, 0)]);
  const previous = snapshot('20252026', [skater(1, 'C', 60, 12, 20)]);
  assert.equal(reviewPlayerInfo(1, current, previous).stats, '0 GP · 0 G · 0 A · 0 P');
});

test('displays goalie stats and clearly labels missing data', () => {
  const current = snapshot('20262027', [], [goalie(3, 15)]);
  assert.equal(reviewPlayerInfo(3, current, null).position, 'G');
  assert.equal(reviewPlayerInfo(3, current, null).stats, '15 GP · 10 W · 4 L · 1 OTL · 2.45 GAA · 0.912 SV%');
  assert.equal(formatReviewPlayerStats(reviewPlayerInfo(4, current, null)), 'Stats unavailable');
  assert.equal(formatReviewPlayerStats(reviewPlayerInfo(4, null, null)), 'Stats unavailable');
});
