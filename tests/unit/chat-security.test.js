const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.CHAT_GUEST_SECRET = 'unit_test_chat_secret_key_1234567890';

const {
  sanitizeText,
  validateCustomerContact,
  issueGuestCapability,
  verifyGuestCapability,
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

test('Chat Security - Guest Capability Cryptographic Issuance & Verification', async (t) => {
  const validGuestId = 'guest_' + 'f'.repeat(32);

  await t.test('issues valid capability format', () => {
    const capability = issueGuestCapability(validGuestId);
    assert.ok(capability.startsWith(validGuestId + '.'));
    assert.strictEqual(verifyGuestCapability(validGuestId, capability), true);
  });

  await t.test('rejects tampered capability', () => {
    const capability = issueGuestCapability(validGuestId);
    const tampered = capability.slice(0, -2) + '00';
    assert.strictEqual(verifyGuestCapability(validGuestId, tampered), false);
  });

  await t.test('rejects cross-guest capability reuse', () => {
    const otherGuestId = 'guest_' + 'e'.repeat(32);
    const capability = issueGuestCapability(validGuestId);
    assert.strictEqual(verifyGuestCapability(otherGuestId, capability), false);
  });

  await t.test('rejects invalid types gracefully', () => {
    assert.strictEqual(verifyGuestCapability(validGuestId, null), false);
    assert.strictEqual(verifyGuestCapability(validGuestId, undefined), false);
    assert.strictEqual(verifyGuestCapability(null, 'cap'), false);
    assert.strictEqual(verifyGuestCapability(validGuestId, 12345), false);
  });
});

test('Chat Security - canAccessConversation (IDOR / BOLA Guard)', async (t) => {
  const convUser = {
    _id: '507f1f77bcf86cd799439011',
    customerId: '507f1f77bcf86cd799439012'
  };

  const validGuestId = 'guest_' + 'a'.repeat(32);
  const validGuestCap = issueGuestCapability(validGuestId);

  const convGuest = {
    _id: '507f1f77bcf86cd799439013',
    guestId: validGuestId
  };

  await t.test('grants admin universal operational access', () => {
    assert.strictEqual(canAccessConversation(convUser, { role: 'admin' }, null), true);
    assert.strictEqual(canAccessConversation(convGuest, { role: 'admin' }, null), true);
  });

  await t.test('grants access to conversation owner', () => {
    assert.strictEqual(canAccessConversation(convUser, { _id: '507f1f77bcf86cd799439012' }, null), true);
    assert.strictEqual(canAccessConversation(convGuest, null, validGuestId, validGuestCap), true);
  });

  await t.test('blocks unauthorized users and attacker guests', () => {
    // Wrong user ID
    assert.strictEqual(canAccessConversation(convUser, { _id: '507f1f77bcf86cd799439999' }, null), false);
    // Guest without capability
    assert.strictEqual(canAccessConversation(convGuest, null, validGuestId, null), false);
    // Guest with forged capability
    assert.strictEqual(canAccessConversation(convGuest, null, validGuestId, validGuestId + '.invalid_signature'), false);
    // Wrong guest ID
    const attackerGuestId = 'guest_' + 'b'.repeat(32);
    const attackerCap = issueGuestCapability(attackerGuestId);
    assert.strictEqual(canAccessConversation(convGuest, null, attackerGuestId, attackerCap), false);
    // Unauthenticated requester
    assert.strictEqual(canAccessConversation(convUser, null, null), false);
    assert.strictEqual(canAccessConversation(null, { role: 'admin' }, null), false);
  });
});
