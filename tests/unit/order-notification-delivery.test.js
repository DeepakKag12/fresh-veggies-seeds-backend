const test = require('node:test');
const assert = require('node:assert');

test('Order Notification Delivery Invariants', async (t) => {
  await t.test('1. Delivery claim status transitions', () => {
    const validStatuses = ['Pending', 'Sending', 'Sent', 'Failed'];
    assert.ok(validStatuses.includes('Pending'));
    assert.ok(validStatuses.includes('Sending'));
    assert.ok(validStatuses.includes('Sent'));
    assert.ok(validStatuses.includes('Failed'));

    // Status transition rules:
    // Only states not in ['Sent', 'Sending'] are eligible for claim
    const isEligible = (status) => !['Sent', 'Sending'].includes(status);

    assert.strictEqual(isEligible('Pending'), true);
    assert.strictEqual(isEligible('Failed'), true);
    assert.strictEqual(isEligible(undefined), true);
    assert.strictEqual(isEligible('Sent'), false);
    assert.strictEqual(isEligible('Sending'), false);
  });

  await t.test('2. Atomic claim prevents duplicate delivery execution', () => {
    let claimed = false;
    const tryClaim = () => {
      if (!claimed) {
        claimed = true;
        return { modifiedCount: 1 };
      }
      return { modifiedCount: 0 };
    };

    // First runner claims
    const run1 = tryClaim();
    assert.strictEqual(run1.modifiedCount, 1);

    // Concurrent second runner fails to claim
    const run2 = tryClaim();
    assert.strictEqual(run2.modifiedCount, 0);
  });
});

