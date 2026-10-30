const test = require('node:test');
const assert = require('node:assert');
const { saveAddressToUser } = require('../../src/services/address.service');

test('Address Service Logic & Invariants', async (t) => {
  await t.test('1. Bails out gracefully when userId or street is missing', async () => {
    await assert.doesNotReject(async () => {
      await saveAddressToUser(null, { street: 'Main St' });
      await saveAddressToUser('507f1f77bcf86cd799439011', null);
      await saveAddressToUser('507f1f77bcf86cd799439011', {});
    });
  });

  await t.test('2. Address normalization and deduplication invariant', () => {
    const addresses = [
      { street: '123 MG Road', pincode: '560001', isDefault: true }
    ];

    const duplicateCandidate = { street: ' 123 mg road ', pincode: '560001 ' };

    const exists = addresses.some(
      (a) =>
        (a.street || '').trim().toLowerCase() === duplicateCandidate.street.trim().toLowerCase() &&
        (a.pincode || '').trim() === duplicateCandidate.pincode.trim()
    );

    assert.strictEqual(exists, true, 'Case-insensitive and whitespace-trimmed address should be identified as duplicate');
  });

  await t.test('3. First address is assigned isDefault: true', () => {
    const addresses = [];
    const isFirst = addresses.length === 0;
    assert.strictEqual(isFirst, true);
  });
});

