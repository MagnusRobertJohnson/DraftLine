const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, planName } = require('./plans.ts');

test('the two admin tiers have the correct labels and seasonal limits', () => {
  assert.equal(planName('admin_basic'), 'Admin');
  assert.equal(planName('admin_top'), 'Admin Pro');
  assert.match(PLANS.find((plan) => plan.tier === 'admin_basic').description, /3 drafts per season/);
  assert.match(PLANS.find((plan) => plan.tier === 'admin_top').description, /15 drafts per season/);
});
