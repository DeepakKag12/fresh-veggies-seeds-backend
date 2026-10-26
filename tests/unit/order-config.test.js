const test = require('node:test');
const assert = require('node:assert');
const {
  computeShippingPrice,
  computeOnlineDiscount,
  canTransition,
  ALL_ORDER_STATUSES,
  TERMINAL_STATUSES,
  FREE_DELIVERY_THRESHOLD,
  DELIVERY_CHARGE
} = require('../../src/config/order.config');

test('Order Config - computeShippingPrice', async (t) => {
  await t.test('charges delivery fee below threshold (₹499)', () => {
    assert.strictEqual(computeShippingPrice(0), DELIVERY_CHARGE);
    assert.strictEqual(computeShippingPrice(200), DELIVERY_CHARGE);
    assert.strictEqual(computeShippingPrice(498), DELIVERY_CHARGE);
  });

  await t.test('gives free delivery at or above threshold (₹499)', () => {
    assert.strictEqual(computeShippingPrice(499), 0);
    assert.strictEqual(computeShippingPrice(1000), 0);
  });

  await t.test('respects custom override threshold and charge', () => {
    assert.strictEqual(computeShippingPrice(300, 250, 70), 0);
    assert.strictEqual(computeShippingPrice(200, 250, 70), 70);
  });
});

test('Order Config - computeOnlineDiscount', async (t) => {
  await t.test('calculates percentage discount capped at max limit', () => {
    // 10% on ₹500 = ₹50 (cap ₹100) -> ₹50
    assert.strictEqual(computeOnlineDiscount(500, 'percentage', 10, 100), 50);
    // 10% on ₹1500 = ₹150 (cap ₹100) -> ₹100
    assert.strictEqual(computeOnlineDiscount(1500, 'percentage', 10, 100), 100);
  });

  await t.test('calculates flat discount', () => {
    assert.strictEqual(computeOnlineDiscount(500, 'flat', 50, 100), 50);
  });

  await t.test('handles invalid inputs and zero discount', () => {
    assert.strictEqual(computeOnlineDiscount(0, 'percentage', 10, 100), 0);
    assert.strictEqual(computeOnlineDiscount(500, 'percentage', 0, 100), 0);
    assert.strictEqual(computeOnlineDiscount(-100, 'percentage', 10, 100), 0);
  });
});

test('Order Config - canTransition State Machine', async (t) => {
  await t.test('allows normal forward progression', () => {
    assert.strictEqual(canTransition('Pending', 'Confirmed'), true);
    assert.strictEqual(canTransition('Confirmed', 'Processing'), true);
    assert.strictEqual(canTransition('Processing', 'Packed'), true);
    assert.strictEqual(canTransition('Packed', 'Shipped'), true);
    assert.strictEqual(canTransition('Shipped', 'Delivered'), true);
  });

  await t.test('allows cancellation from active states', () => {
    assert.strictEqual(canTransition('Pending', 'Cancelled'), true);
    assert.strictEqual(canTransition('Confirmed', 'Cancelled'), true);
    assert.strictEqual(canTransition('Processing', 'Cancelled'), true);
    assert.strictEqual(canTransition('Packed', 'Cancelled'), true);
    assert.strictEqual(canTransition('Shipped', 'Cancelled'), true);
  });

  await t.test('STRICTLY PROHIBITS backward transitions from terminal states', () => {
    // Delivered is terminal: cannot be moved back
    assert.strictEqual(canTransition('Delivered', 'Pending'), false);
    assert.strictEqual(canTransition('Delivered', 'Confirmed'), false);
    assert.strictEqual(canTransition('Delivered', 'Shipped'), false);
    assert.strictEqual(canTransition('Delivered', 'Cancelled'), false);

    // Cancelled is terminal: cannot be moved back
    assert.strictEqual(canTransition('Cancelled', 'Pending'), false);
    assert.strictEqual(canTransition('Cancelled', 'Confirmed'), false);
    assert.strictEqual(canTransition('Cancelled', 'Shipped'), false);
    assert.strictEqual(canTransition('Cancelled', 'Delivered'), false);
  });

  await t.test('allows same state transition (idempotent)', () => {
    assert.strictEqual(canTransition('Processing', 'Processing'), true);
    assert.strictEqual(canTransition('Delivered', 'Delivered'), true);
  });

  await t.test('rejects unknown or invalid status strings', () => {
    assert.strictEqual(canTransition('Pending', 'InLimbo'), false);
    assert.strictEqual(canTransition('UnknownStatus', 'Confirmed'), false);
  });
});
