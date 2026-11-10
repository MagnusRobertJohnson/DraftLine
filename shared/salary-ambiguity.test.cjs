const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchSalariesWithNHL } = require('./salary.ts');
const { buildSalaryReviewChoices } = require('./salary-review.ts');

test('does not automatically assign same-name contracts to either player', () => {
  const result = matchSalariesWithNHL(
    [{ name: 'Alex Example', capHit: 1 }, { name: 'Alex Example', capHit: 4 }],
    [{ id: 1, fullName: 'Alex Example', teamAbbrev: 'AAA' }, { id: 2, fullName: 'Alex Example', teamAbbrev: 'BBB' }]
  );
  assert.deepEqual(result.matched, []);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(result.ambiguous[0].players.map((player) => player.id), [1, 2]);
  assert.deepEqual(result.ambiguous[0].salaries.map((salary) => salary.capHit), [1, 4]);
});

test('does not assign multiple source records to the same player', () => {
  const result = matchSalariesWithNHL(
    [{ name: 'Sam Example', capHit: 1 }, { name: 'Samuel Example', capHit: 2 }],
    [{ id: 3, fullName: 'Samuel Example' }]
  );
  assert.deepEqual(result.matched, []);
  assert.equal(result.ambiguous.length, 1);
});

test('preserves unambiguous exact and fuzzy matches', () => {
  const result = matchSalariesWithNHL(
    [{ name: 'Connor Example', capHit: 4 }, { name: 'J. Unique', capHit: 2 }],
    [{ id: 1, fullName: 'Connor Example' }, { id: 2, fullName: 'John Unique' }]
  );
  assert.deepEqual(result.matched.map((entry) => entry.playerId), [1, 2]);
  assert.deepEqual(result.ambiguous, []);
});

test('normalized nicknames and accents do not hide ambiguous players', () => {
  const result = matchSalariesWithNHL(
    [{ name: 'Matt Stutzle', capHit: 4 }],
    [{ id: 1, fullName: 'Matthew Stützle', teamAbbrev: 'AAA' }, { id: 2, fullName: 'Matt Stutzle', teamAbbrev: 'AAA' }]
  );
  assert.equal(result.ambiguous[0].players.length, 2);
  assert.equal(result.matched.length, 0);
});

test('initial matches with multiple possible players are ambiguous', () => {
  const result = matchSalariesWithNHL(
    [{ name: 'J. Example', capHit: 4 }],
    [{ id: 1, fullName: 'John Example' }, { id: 2, fullName: 'James Example' }]
  );
  assert.deepEqual(result.ambiguous[0].players.map((player) => player.id), [1, 2]);
});

test('identical source rows remain ambiguous rather than being silently deduplicated', () => {
  const result = matchSalariesWithNHL(
    [{ name: 'Unique Example', capHit: 4 }, { name: 'Unique Example', capHit: 4 }],
    [{ id: 1, fullName: 'Unique Example' }]
  );
  assert.equal(result.ambiguous.length, 1);
});

test('review requires an explicit valid choice for every player', () => {
  const review = {
    key: 'key', fingerprint: 'version',
    details: { players: [{ id: 1, fullName: 'Same Name' }, { id: 2, fullName: 'Same Name' }],
      salaries: [{ name: 'Same Name', capHit: 2.5 }], previousSalaries: { 1: 4 } },
  };
  assert.throws(() => buildSalaryReviewChoices(review, {}), /NHL ID 1/);
  assert.throws(() => buildSalaryReviewChoices(review, {
    1: { selection: 'source:1', manual: '' }, 2: { selection: 'unknown', manual: '' },
  }), /NHL ID 1/);
  assert.throws(() => buildSalaryReviewChoices(review, {
    1: { selection: 'manual', manual: '1.999' }, 2: { selection: 'unknown', manual: '' },
  }), /two decimals/);
  assert.deepEqual(buildSalaryReviewChoices(review, {
    1: { selection: 'source:0', manual: '' }, 2: { selection: 'unknown', manual: '' },
  }), [{ playerId: 1, kind: 'source', index: 0 }, { playerId: 2, kind: 'unknown' }]);
  assert.deepEqual(buildSalaryReviewChoices(review, {
    1: { selection: 'manual', manual: '4.25' }, 2: { selection: 'unknown', manual: '' },
  })[0], { playerId: 1, kind: 'manual', capHit: 4.25 });
  assert.deepEqual(buildSalaryReviewChoices(review, {
    1: { selection: 'previous', manual: '' }, 2: { selection: 'unknown', manual: '' },
  })[0], { playerId: 1, kind: 'previous' });
  assert.throws(() => buildSalaryReviewChoices(review, {
    1: { selection: 'unknown', manual: '' }, 2: { selection: 'previous', manual: '' },
  }), /NHL ID 2/);
});
