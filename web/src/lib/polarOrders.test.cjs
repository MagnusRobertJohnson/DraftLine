const { test } = require('node:test');
const assert = require('node:assert/strict');
const { orderActionFromEvent, productForCheckout, kindForProduct } = require('./polarOrders.ts');

const ids = { admin: 'p-admin', adminPro: 'p-pro', adminProUpgrade: 'p-up' };
const user = '123e4567-e89b-42d3-a456-426614174000';
const paid = (over = {}) => ({
  type: 'order.paid',
  data: { id: 'o1', status: 'paid', product_id: 'p-admin', metadata: { supabase_user_id: user }, ...over },
});

test('a paid order for each product maps to its kind', () => {
  assert.equal(orderActionFromEvent(paid(), ids).action.kind, 'admin');
  assert.equal(orderActionFromEvent(paid({ product_id: 'p-pro' }), ids).action.kind, 'admin_pro');
  assert.equal(orderActionFromEvent(paid({ product_id: 'p-up' }), ids).action.kind, 'admin_pro_upgrade');
});

test('an unknown product is ignored', () => {
  assert.ok(orderActionFromEvent(paid({ product_id: 'other' }), ids).ignored);
  assert.equal(kindForProduct(undefined, ids), null);
  assert.equal(kindForProduct('x', {}), null);
});

test('subscription orders are ignored', () => {
  assert.ok(orderActionFromEvent(paid({ subscription_id: 's1' }), ids).ignored);
});

test('orders without a valid user id are ignored', () => {
  assert.ok(orderActionFromEvent(paid({ metadata: {} }), ids).ignored);
  assert.ok(orderActionFromEvent(paid({ metadata: { supabase_user_id: 'nope' } }), ids).ignored);
});

test('the customer external id is used when metadata is missing', () => {
  const result = orderActionFromEvent(paid({ metadata: {}, customer: { external_id: user } }), ids);
  assert.equal(result.action.userId, user);
});

test('an order.paid event that is not paid is ignored', () => {
  assert.ok(orderActionFromEvent(paid({ status: 'pending' }), ids).ignored);
});

test('refunds revoke, partial refunds keep access', () => {
  const refund = (status) => ({ type: 'order.refunded', data: { ...paid().data, status } });
  assert.equal(orderActionFromEvent(refund('refunded'), ids).action.status, 'refunded');
  assert.equal(orderActionFromEvent(refund('partially_refunded'), ids).action.status, 'partially_refunded');
});

test('other event types are ignored', () => {
  assert.ok(orderActionFromEvent({ type: 'order.created', data: paid().data }, ids).ignored);
});

test('checkout offers the discounted upgrade only to Admin owners', () => {
  assert.equal(productForCheckout('free', 'admin_basic', ids).productId, 'p-admin');
  assert.equal(productForCheckout('free', 'admin_top', ids).productId, 'p-pro');
  assert.equal(productForCheckout('admin_basic', 'admin_top', ids).productId, 'p-up');
  assert.ok(productForCheckout('admin_basic', 'admin_basic', ids).error);
  assert.ok(productForCheckout('admin_top', 'admin_top', ids).error);
});
