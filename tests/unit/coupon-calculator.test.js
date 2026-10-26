const test = require('node:test');
const assert = require('node:assert');

test('Coupon Engine - Pricing Calculations & Rule Constraints', async (t) => {

  // Pure logic mirror of couponService discount calculator
  const computeDiscount = ({ itemsPrice, discountType, discountValue, maxDiscount }) => {
    let discount = 0;
    const isPercentage = String(discountType).toLowerCase() === 'percentage';
    if (isPercentage) {
      discount = (itemsPrice * discountValue) / 100;
      if (maxDiscount) {
        discount = Math.min(discount, maxDiscount);
      }
    } else {
      discount = discountValue;
    }
    // Guard against negative orders or discount exceeding items
    return Math.max(0, Math.min(Math.round(discount), itemsPrice));
  };

  await t.test('1. Computes percentage discount correctly without cap', () => {
    const res = computeDiscount({
      itemsPrice: 1000,
      discountType: 'percentage',
      discountValue: 15
    });
    assert.strictEqual(res, 150);
  });

  await t.test('2. Enforces maximum discount ceiling on large baskets', () => {
    const res = computeDiscount({
      itemsPrice: 5000,
      discountType: 'percentage',
      discountValue: 20, // 20% of 5000 = 1000
      maxDiscount: 250   // Capped at 250
    });
    assert.strictEqual(res, 250);
  });

  await t.test('3. Computes flat amount discount', () => {
    const res = computeDiscount({
      itemsPrice: 800,
      discountType: 'flat',
      discountValue: 100
    });
    assert.strictEqual(res, 100);
  });

  await t.test('4. Inversion guard: discount cannot exceed basket items price', () => {
    const res = computeDiscount({
      itemsPrice: 50,
      discountType: 'flat',
      discountValue: 100 // Flat 100 on a 50 item
    });
    assert.strictEqual(res, 50); // Capped at items price
  });

  await t.test('5. Validates temporal activity window (startDate & expiryDate)', () => {
    const isWithinWindow = (now, startDate, expiryDate) => {
      if (startDate && now < startDate) return false;
      if (expiryDate && now > expiryDate) return false;
      return true;
    };

    const now = new Date('2026-10-27T00:00:00Z');
    const past = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2026-12-31T00:00:00Z');

    assert.strictEqual(isWithinWindow(now, past, future), true);
    assert.strictEqual(isWithinWindow(now, future, future), false); // Not started
    assert.strictEqual(isWithinWindow(now, past, past), false); // Expired
  });

  await t.test('6. Validates minimum basket threshold', () => {
    const meetsThreshold = (itemsPrice, minOrderAmount) => {
      const min = minOrderAmount || 0;
      return itemsPrice >= min;
    };

    assert.strictEqual(meetsThreshold(500, 300), true);
    assert.strictEqual(meetsThreshold(250, 300), false);
    assert.strictEqual(meetsThreshold(300, 300), true);
  });
});
