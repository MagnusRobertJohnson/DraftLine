const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeDrafts } = require('./drafts.ts');

test('shows a managed and joined draft only once, keeping the managed version', () => {
  const managed = { id: 'one', name: 'Managed' };
  const joined = { id: 'one', name: 'Joined' };
  assert.deepEqual(mergeDrafts([managed], [joined]), [managed]);
});

test('deduplicates multiple memberships and retains distinct drafts in order', () => {
  const managed = { id: 'one' };
  const joined = { id: 'two' };
  const another = { id: 'three' };
  assert.deepEqual(mergeDrafts([managed], [joined, joined, another]), [managed, joined, another]);
  assert.deepEqual(mergeDrafts([], []), []);
});
