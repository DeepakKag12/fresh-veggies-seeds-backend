const test = require('node:test');
const assert = require('node:assert');
const {
  isValidEmail,
  isValidPhone,
  normalizePhone,
  validatePassword,
  cleanText,
  validateCart
} = require('../../src/validators/auth.validator');

test('Auth Validator & User Security Logic', async (t) => {

  await t.test('1. Email validation adheres to pragmatic format rules', () => {
    assert.strictEqual(isValidEmail('user@freshveggies.me'), true);
    assert.strictEqual(isValidEmail('customer.name+tag@gmail.com'), true);
    assert.strictEqual(isValidEmail('notanemail'), false);
    assert.strictEqual(isValidEmail('user@'), false);
    assert.strictEqual(isValidEmail('@domain.com'), false);
    assert.strictEqual(isValidEmail('user@domain'), false);
    assert.strictEqual(isValidEmail(''), false);
    assert.strictEqual(isValidEmail(null), false);
    assert.strictEqual(isValidEmail(undefined), false);
  });

  await t.test('2. Indian phone validation and normalisation', () => {
    assert.strictEqual(isValidPhone('9876543210'), true);
    assert.strictEqual(isValidPhone('+919876543210'), true);
    assert.strictEqual(isValidPhone('+91 98765 43210'), true);
    assert.strictEqual(isValidPhone('98765-43210'), true);
    assert.strictEqual(isValidPhone('09876543210'), true);
    // Invalid phones
    assert.strictEqual(isValidPhone('1234567890'), false); // Starts with 1
    assert.strictEqual(isValidPhone('98765'), false); // Too short
    assert.strictEqual(isValidPhone('9876543210123'), false); // Too long
    assert.strictEqual(isValidPhone('abcdefghij'), false);

    // Normalisation to 10 digits
    assert.strictEqual(normalizePhone('+91 98765 43210'), '9876543210');
    assert.strictEqual(normalizePhone('09876543210'), '9876543210');
    assert.strictEqual(normalizePhone('98765-43210'), '9876543210');
  });

  await t.test('3. Password policy enforcement (min 8 chars, letter + number)', () => {
    assert.strictEqual(validatePassword('Password@123').valid, true);
    assert.strictEqual(validatePassword('freshveggies2026').valid, true);
    // Invalid
    assert.strictEqual(validatePassword('short1').valid, false); // < 8
    assert.strictEqual(validatePassword('onlyletterslong').valid, false); // No numbers
    assert.strictEqual(validatePassword('1234567890').valid, false); // No letters
    assert.strictEqual(validatePassword(null).valid, false);
  });

  await t.test('4. cleanText truncates and trims free text', () => {
    assert.strictEqual(cleanText('  Hello World  ', 20), 'Hello World');
    assert.strictEqual(cleanText('A very long text that exceeds limit', 10), 'A very lon');
    assert.strictEqual(cleanText(null, 10), '');
  });

  await t.test('5. Cart payload validation', () => {
    assert.strictEqual(validateCart('not an array').valid, false);
    assert.strictEqual(validateCart([{ product: 'prod_123', quantity: 1 }]).valid, true);
    assert.strictEqual(validateCart([null]).valid, false);
    assert.strictEqual(validateCart([{ quantity: 1 }]).valid, false); // Missing product id
  });
});
