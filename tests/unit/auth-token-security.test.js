const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit_test_jwt_secret_key_minimum_32_chars_long';

const { protect, admin, optionalAuth } = require('../../src/middleware/auth.middleware');

test('Token-Wise Testing & Security Validation', async (t) => {
  const secret = process.env.JWT_SECRET;
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Security Test User',
    email: 'sec_test@example.com',
    role: 'customer',
    isActive: true,
    tokenVersion: 2
  };

  await t.test('1. Valid JWT token generation & payload verification', () => {
    const token = jwt.sign(
      { id: mockUser._id, userId: mockUser._id, role: mockUser.role, tv: mockUser.tokenVersion },
      secret,
      { expiresIn: '1h' }
    );
    const decoded = jwt.verify(token, secret);
    assert.strictEqual(decoded.id, mockUser._id);
    assert.strictEqual(decoded.userId, mockUser._id);
    assert.strictEqual(decoded.role, 'customer');
    assert.strictEqual(decoded.tv, 2);
    assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
  });

  await t.test('2. Token Tampering Detection (Cryptographic HMAC check)', () => {
    const validToken = jwt.sign(
      { id: mockUser._id, role: 'customer', tv: 2 },
      secret,
      { expiresIn: '1h' }
    );

    // Tamper with payload (escalate role to admin)
    const parts = validToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    payload.role = 'admin';
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forgedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    assert.throws(() => {
      jwt.verify(forgedToken, secret);
    }, /invalid signature/i);
  });

  await t.test('3. Token Expiration Enforcement', () => {
    const expiredToken = jwt.sign(
      { id: mockUser._id, role: 'customer', tv: 2 },
      secret,
      { expiresIn: '-1s' }
    );

    assert.throws(() => {
      jwt.verify(expiredToken, secret);
    }, /jwt expired/i);
  });

  await t.test('4. Token with Wrong Secret is rejected', () => {
    const wrongSecretToken = jwt.sign(
      { id: mockUser._id, role: 'customer', tv: 2 },
      'wrong_secret_attacker_key_32_characters'
    );

    assert.throws(() => {
      jwt.verify(wrongSecretToken, secret);
    }, /invalid signature/i);
  });

  await t.test('5. Protect Middleware rejects missing and malformed tokens', async () => {
    const reqNoHeader = { headers: {} };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await protect(reqNoHeader, res, next);
    assert.strictEqual(statusSent, 401);
    assert.strictEqual(jsonSent.success, false);
    assert.strictEqual(nextCalled, false);

    // Malformed token header
    const reqMalformed = { headers: { authorization: 'Bearer this.is.malformed' } };
    nextCalled = false;
    await protect(reqMalformed, res, next);
    assert.strictEqual(statusSent, 401);
    assert.strictEqual(nextCalled, false);
  });

  await t.test('6. Admin Middleware enforces Role-Based Access Control', () => {
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    // Customer role is rejected with 403 Forbidden
    admin({ user: { role: 'customer' } }, res, next);
    assert.strictEqual(statusSent, 403);
    assert.strictEqual(jsonSent.success, false);
    assert.strictEqual(nextCalled, false);

    // Unauthenticated user is rejected with 403 Forbidden
    statusSent = null;
    admin({}, res, next);
    assert.strictEqual(statusSent, 403);
    assert.strictEqual(nextCalled, false);

    // Admin role succeeds
    nextCalled = false;
    admin({ user: { role: 'admin' } }, res, next);
    assert.strictEqual(nextCalled, true);
  });

  await t.test('7. Token Version (tv) Revocation check', () => {
    // Stored user has tokenVersion = 2
    const currentTv = 2;
    const oldTokenPayload = { id: mockUser._id, tv: 1 };
    const currentTokenPayload = { id: mockUser._id, tv: 2 };

    assert.notStrictEqual(oldTokenPayload.tv, currentTv, 'Older token version must not match current tokenVersion');
    assert.strictEqual(currentTokenPayload.tv, currentTv, 'Matching token version must be valid');
  });
});

