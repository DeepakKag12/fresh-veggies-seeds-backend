const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const razorpayService = require('../../src/services/razorpay.service');

test('Payment Gateway & Cryptographic Verification', async (t) => {

  const secret = 'test_secret_key_12345';
  process.env.RAZORPAY_KEY_SECRET = secret;

  await t.test('1. Validates genuine Razorpay HMAC-SHA256 payment signature', () => {
    const orderId = 'order_DA123456789';
    const paymentId = 'pay_987654321';
    
    // Compute genuine signature
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${orderId}|${paymentId}`);
    const validSignature = hmac.digest('hex');

    const result = razorpayService.verifyPaymentSignature(orderId, paymentId, validSignature);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.message, 'Payment verified successfully');
  });

  await t.test('2. Rejects forged or tampered payment signature', () => {
    const orderId = 'order_DA123456789';
    const paymentId = 'pay_987654321';
    const forgedSignature = 'forged_deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234';

    const result = razorpayService.verifyPaymentSignature(orderId, paymentId, forgedSignature);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.message, 'Payment verification failed');
  });

  await t.test('3. Rejects payment verification when order ID is tampered with', () => {
    const orderId = 'order_DA123456789';
    const tamperedOrderId = 'order_ATTACKER_999';
    const paymentId = 'pay_987654321';

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${orderId}|${paymentId}`);
    const signature = hmac.digest('hex');

    const result = razorpayService.verifyPaymentSignature(tamperedOrderId, paymentId, signature);
    assert.strictEqual(result.success, false);
  });

  await t.test('4. Gracefully formats refund records for test and unconfigured environments', async () => {
    const refundResult = await razorpayService.refundPayment('test_pay_123', 500);
    assert.strictEqual(refundResult.success, true);
    assert.strictEqual(refundResult.data.entity, 'refund');
    assert.strictEqual(refundResult.data.amount, 50000); // 500 * 100 paise
    assert.strictEqual(refundResult.data.status, 'processed');
  });
});
