const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeText,
  validateCustomerContact,
  canAccessConversation
} = require('../../src/utils/chat-security.util');

test('Chat Security - sanitizeText', async (t) => {
  await t.test('strips HTML and script tags', () => {
    const dirty = '<script>alert("hacked")</script><b>Hello</b> <a href="evil.com">Click</a>';
    assert.strictEqual(sanitizeText(dirty), 'alert("hacked")Hello Click');
  });

  await t.test('trims whitespace and handles empty inputs', () => {
    assert.strictEqual(sanitizeText('   trimmed   '), 'trimmed');
    assert.strictEqual(sanitizeText(null), '');
    assert.strictEqual(sanitizeText(undefined), '');
    assert.strictEqual(sanitizeText(123), '');
  });

  await t.test('enforces maxLength truncation', () => {
    const long = 'A'.repeat(3000);
    assert.strictEqual(sanitizeText(long, 2000).length, 2000);
  });
});

test('Chat Security - validateCustomerContact', async (t) => {
  await t.test('rejects short or empty names', () => {
    assert.strictEqual(validateCustomerContact({ name: '', phone: '9876543210' }).valid, false);
    assert.strictEqual(validateCustomerContact({ name: 'A', phone: '9876543210' }).valid, false);
    assert.strictEqual(validateCustomerContact({ name: '   ', phone: '9876543210' }).valid, false);
  });

  await t.test('rejects invalid mobile numbers', () => {
    // Starts with 5 (invalid in India)
    assert.strictEqual(validateCustomerContact({ name: 'Ramesh', phone: '5123456789' }).valid, false);
    // Short numbers
    assert.strictEqual(validateCustomerContact({ name: 'Ramesh', phone: '12345' }).valid, false);
    // Non-digits
    assert.strictEqual(validateCustomerContact({ name: 'Ramesh', phone: 'abcdefghij' }).valid, false);
    // Null/undefined
    assert.strictEqual(validateCustomerContact({ name: 'Ramesh', phone: null }).valid, false);
  });

  await t.test('accepts valid Indian names and mobile numbers with formatting', () => {
    const res1 = validateCustomerContact({ name: 'Pooja Verma', phone: '9876543210' });
    assert.strictEqual(res1.valid, true);
    assert.strictEqual(res1.cleanName, 'Pooja Verma');
    assert.strictEqual(res1.cleanPhone, '9876543210');

    // With +91 prefix and dashes
    const res2 = validateCustomerContact({ name: 'Aarav Sharma', phone: '+91 98765-43210' });
    assert.strictEqual(res2.valid, true);
    assert.strictEqual(res2.cleanPhone, '9876543210');
  });
});

test('Chat Security - canAccessConversation (IDOR / BOLA Guard)', async (t) => {
  const convUser = {
    _id: '507f1f77bcf86cd799439011',
    customerId: '507f1f77bcf86cd799439012'
  };

  const convGuest = {
    _id: '507f1f77bcf86cd799439013',
    guestId: 'guest_verified_123'
  };

  await t.test('grants admin universal operational access', () => {
    assert.strictEqual(canAccessConversation(convUser, { role: 'admin' }, null), true);
    assert.strictEqual(canAccessConversation(convGuest, { role: 'admin' }, null), true);
  });

  await t.test('grants access to conversation owner', () => {
    assert.strictEqual(canAccessConversation(convUser, { _id: '507f1f77bcf86cd799439012' }, null), true);
    assert.strictEqual(canAccessConversation(convGuest, null, 'guest_verified_123'), true);
  });

  await t.test('blocks unauthorized users and attacker guests', () => {
    // Wrong user ID
    assert.strictEqual(canAccessConversation(convUser, { _id: '507f1f77bcf86cd799439999' }, null), false);
    // Wrong guest ID
    assert.strictEqual(canAccessConversation(convGuest, null, 'guest_attacker_666'), false);
    // Unauthenticated requester
    assert.strictEqual(canAccessConversation(convUser, null, null), false);
    assert.strictEqual(canAccessConversation(null, { role: 'admin' }, null), false);
  });
});
