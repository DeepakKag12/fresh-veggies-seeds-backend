const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const ApiError = require('../../src/utils/api-error.util');
const { notFound, errorHandler } = require('../../src/middleware/error.middleware');
const validateObjectId = require('../../src/middleware/validate-object-id.middleware');

test('ApiError & Error Handling Middleware', async (t) => {
  await t.test('1. ApiError creates operational errors with appropriate HTTP status codes', () => {
    const badReq = ApiError.badRequest('Invalid payload');
    assert.strictEqual(badReq.statusCode, 400);
    assert.strictEqual(badReq.message, 'Invalid payload');
    assert.strictEqual(badReq.isOperational, true);

    const unauth = ApiError.unauthorized('No token');
    assert.strictEqual(unauth.statusCode, 401);

    const forbidden = ApiError.forbidden('Forbidden');
    assert.strictEqual(forbidden.statusCode, 403);

    const notFoundErr = ApiError.notFound('Resource missing');
    assert.strictEqual(notFoundErr.statusCode, 404);

    const conflict = ApiError.conflict('Conflict exists');
    assert.strictEqual(conflict.statusCode, 409);
  });

  await t.test('2. notFound middleware returns 404 JSON response', () => {
    const req = { method: 'GET', originalUrl: '/api/unknown-endpoint' };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    notFound(req, res);
    assert.strictEqual(statusSent, 404);
    assert.strictEqual(jsonSent.success, false);
    assert.ok(jsonSent.message.includes('/api/unknown-endpoint'));
  });

  await t.test('3. errorHandler translates CastError into 400', () => {
    const err = { name: 'CastError', path: '_id' };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    errorHandler(err, {}, res, () => {});
    assert.strictEqual(statusSent, 400);
    assert.strictEqual(jsonSent.success, false);
    assert.ok(jsonSent.message.includes('_id'));
  });

  await t.test('4. errorHandler translates ValidationError into 400', () => {
    const err = {
      name: 'ValidationError',
      errors: {
        email: { message: 'Email is required' },
        price: { message: 'Price must be positive' }
      }
    };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    errorHandler(err, {}, res, () => {});
    assert.strictEqual(statusSent, 400);
    assert.strictEqual(jsonSent.success, false);
    assert.ok(jsonSent.message.includes('Email is required'));
  });

  await t.test('5. errorHandler translates Duplicate Key E11000 into 409 Conflict', () => {
    const err = { code: 11000, keyPattern: { email: 1 } };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    errorHandler(err, {}, res, () => {});
    assert.strictEqual(statusSent, 409);
    assert.strictEqual(jsonSent.success, false);
    assert.ok(jsonSent.message.includes('email'));
  });

  await t.test('6. errorHandler translates JWT errors into 401 Unauthorized', () => {
    const err = { name: 'JsonWebTokenError' };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    errorHandler(err, {}, res, () => {});
    assert.strictEqual(statusSent, 401);
    assert.strictEqual(jsonSent.success, false);
  });
});

test('Validate ObjectId Middleware', async (t) => {
  const validId = new mongoose.Types.ObjectId().toString();
  const invalidId = 'not-a-valid-object-id';

  await t.test('1. Direct mode accepts valid ObjectId', () => {
    let nextCalled = false;
    const req = { params: { id: validId } };
    validateObjectId(req, {}, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  });

  await t.test('2. Direct mode rejects invalid ObjectId with 400', () => {
    let statusSent = null;
    let jsonSent = null;
    let nextCalled = false;
    const req = { params: { id: invalidId } };
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; return res; }
    };

    validateObjectId(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusSent, 400);
    assert.strictEqual(jsonSent.success, false);
    assert.strictEqual(nextCalled, false);
  });

  await t.test('3. Factory mode validates named route param', () => {
    const middleware = validateObjectId('productId');
    let nextCalled = false;
    const reqValid = { params: { productId: validId } };
    middleware(reqValid, {}, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);

    let statusSent = null;
    nextCalled = false;
    const reqInvalid = { params: { productId: 'invalid' } };
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: () => res
    };
    middleware(reqInvalid, res, () => { nextCalled = true; });
    assert.strictEqual(statusSent, 400);
    assert.strictEqual(nextCalled, false);
  });
});

