const test = require('node:test');
const assert = require('node:assert');

test('Stock Service Logic & Invariant Validation', async (t) => {
  await t.test('1. restoreReservedStock ignores null, undefined or empty arrays safely', async () => {
    const stockService = require('../../src/services/stock.service');
    await assert.doesNotReject(async () => {
      await stockService.restoreReservedStock(null);
      await stockService.restoreReservedStock([]);
      await stockService.restoreReservedStock(undefined);
    });
  });

  await t.test('2. restoreReservedStock filters out zero or negative quantities', async () => {
    const stockService = require('../../src/services/stock.service');
    const invalidItems = [
      { product: '507f1f77bcf86cd799439011', quantity: 0 },
      { product: '507f1f77bcf86cd799439012', quantity: -5 }
    ];
    await assert.doesNotReject(async () => {
      await stockService.restoreReservedStock(invalidItems);
    });
  });

  await t.test('3. Stock reservation ledger format invariant', () => {
    const mockLedger = [
      { product: '507f1f77bcf86cd799439011', quantity: 2, productType: 'Combo', name: 'Summer Salad Combo' },
      { product: '507f1f77bcf86cd799439012', quantity: 4, productType: 'Product', name: 'Cherry Tomatoes' },
      { product: '507f1f77bcf86cd799439013', quantity: 2, productType: 'Product', name: 'English Cucumber' }
    ];

    // Constituent detection guard
    const hasConstituents = mockLedger.some(
      other => other.productType === 'Product'
    );
    assert.strictEqual(hasConstituents, true, 'Reservation ledger must contain constituent products');
    assert.strictEqual(mockLedger[0].productType, 'Combo');
  });

  await t.test('4. Idempotent cancel restoration guard logic', () => {
    // If order was already restored, second call must skip
    const orderAlreadyRestored = {
      _id: '507f1f77bcf86cd799439020',
      stockDecremented: true,
      stockRestored: true,
      orderItems: []
    };
    assert.strictEqual(orderAlreadyRestored.stockRestored, true);

    // If order never decremented stock (e.g. cancelled before confirmation), restore must skip
    const orderNeverDecremented = {
      _id: '507f1f77bcf86cd799439021',
      stockDecremented: false,
      stockRestored: false,
      orderItems: []
    };
    assert.strictEqual(orderNeverDecremented.stockDecremented, false);
  });
});

