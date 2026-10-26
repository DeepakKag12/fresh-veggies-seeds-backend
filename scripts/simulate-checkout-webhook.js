/**
 * Fresh Veggies - End-to-End Checkout & Razorpay Webhook Simulation Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Simulates complete customer purchase journey:
 * 1. Pincode serviceability check
 * 2. Coupon validation
 * 3. Server-side priced Razorpay order creation
 * 4. HMAC-SHA256 signature generation & webhook execution
 * 5. Order state machine validation (Pending -> Confirmed)
 * 6. Stock decrement & idempotency validation
 * 7. Malformed signature rejection guard
 */

const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const User = require('../src/models/user.model');
const Product = require('../src/models/product.model');
const Order = require('../src/models/order.model');
const Coupon = require('../src/models/coupon.model');

const PORT = process.env.PORT || 5000;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'dev_razorpay_webhook_secret_9988';
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret_fresh_veggies_2026';

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ [PASS] ${message}`);
    passedAssertions++;
  } else {
    console.error(`  ✖ [FAIL] ${message}`);
    failedAssertions++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function makeRequest({ method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const rawData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (rawData && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(rawData);
    }
    if (rawData && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let respBody = '';
      res.on('data', (chunk) => { respBody += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(respBody);
        } catch {
          json = respBody;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on('error', (err) => reject(err));
    if (rawData) req.write(rawData);
    req.end();
  });
}

async function runCheckoutSimulation() {
  console.log('\n💳 ═══════════════════════════════════════════════════════════════════');
  console.log('   END-TO-END CHECKOUT & RAZORPAY WEBHOOK SIMULATION SUITE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🔌 Connected to MongoDB for database state validation.\n');

  try {
    // ── Pre-flight: Find or create customer user ─────────────────────────────
    let testUser = await User.findOne({ role: 'customer', isActive: true });
    if (!testUser) {
      testUser = await User.create({
        name: 'Simulated Customer',
        email: `checkout_sim_${Date.now()}@freshveggies.test`,
        password: 'Password123!',
        phone: '9' + Math.floor(100000000 + Math.random() * 900000000),
        role: 'customer',
        isActive: true
      });
    }

    const token = jwt.sign(
      { id: testUser._id.toString(), role: testUser.role, tokenVersion: testUser.tokenVersion || 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Find active product
    const product = await Product.findOne({ isActive: true, isDeleted: { $ne: true }, stock: { $gt: 5 } });
    assert(!!product, `Found active test product: "${product?.name}" with stock: ${product?.stock}`);
    const initialProductStock = product.stock;

    // ── STEP 1: Pincode Serviceability Check ────────────────────────────────
    console.log('\n▶ 1. Storefront Pincode Serviceability Check');
    const pincodeRes = await makeRequest({
      method: 'GET',
      path: '/api/orders/check-pincode/452001'
    });
    assert(pincodeRes.status === 200, 'GET /api/orders/check-pincode/452001 returns HTTP 200');
    assert(pincodeRes.data.data?.serviceable === true, 'Pincode 452001 is reported serviceable by logistics engine');

    // ── STEP 2: Coupon Validation ───────────────────────────────────────────
    console.log('\n▶ 2. Coupon Validation & Pricing Protection');
    const testCouponCode = 'SIMSAVE_' + Date.now();
    const coupon = await Coupon.create({
      code: testCouponCode,
      description: 'Simulated 10% discount test coupon',
      discountType: 'percentage',
      discountValue: 10,
      minOrderAmount: 100,
      maxDiscountAmount: 50,
      expiryDate: new Date(Date.now() + 30 * 86400000),
      isActive: true,
      isDeleted: false
    });

    const couponRes = await makeRequest({
      method: 'POST',
      path: '/api/coupons/validate',
      headers: authHeaders,
      body: { code: testCouponCode, orderAmount: 500 }
    });
    if (couponRes.status !== 200) {
      console.log('❌ couponRes error details:', couponRes.status, couponRes.data);
    }
    assert(couponRes.status === 200, 'POST /api/coupons/validate returns HTTP 200');
    assert(couponRes.data.success === true, `Coupon ${testCouponCode} validated successfully`);

    // ── STEP 3: Razorpay Order Creation ─────────────────────────────────────
    console.log('\n▶ 3. Server-Side Priced Razorpay Order Initiation');
    const orderItems = [{
      product: product._id.toString(),
      productType: 'Product',
      name: product.name,
      price: product.price,
      quantity: 1,
      image: product.images?.[0] || 'https://via.placeholder.com/150'
    }];

    const shippingAddress = {
      name: 'Simulated Customer',
      phone: '9876543210',
      street: '101 Botanica Garden Avenue, Scheme 78',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452001',
      country: 'India'
    };

    const createOrderRes = await makeRequest({
      method: 'POST',
      path: '/api/payments/create-order',
      headers: authHeaders,
      body: {
        orderItems,
        shippingAddress,
        couponCode: testCouponCode
      }
    });

    if (createOrderRes.status !== 200) {
      console.log('❌ createOrderRes error details:', createOrderRes.status, createOrderRes.data);
    }
    assert(createOrderRes.status === 200, 'POST /api/payments/create-order returns HTTP 200');
    const rzpOrderId = createOrderRes.data.data?.razorpayOrderId;
    const internalOrderId = createOrderRes.data.data?.internalOrderId;
    assert(!!rzpOrderId, `Razorpay order generated: ${rzpOrderId}`);
    assert(!!internalOrderId, `Internal order ID created: ${internalOrderId}`);

    // Verify initial Pending status in database
    const initialOrderDoc = await Order.findById(internalOrderId);
    assert(initialOrderDoc.orderStatus === 'Pending', 'Initial database orderStatus is "Pending"');
    assert(initialOrderDoc.paymentStatus === 'Pending', 'Initial database paymentStatus is "Pending"');
    assert(initialOrderDoc.paymentDetails.razorpayOrderId === rzpOrderId, 'Razorpay Order ID correctly associated');

    // ── STEP 4: Razorpay Webhook Simulation (payment.captured) ──────────────
    console.log('\n▶ 4. Razorpay Webhook Processing (HMAC-SHA256 Signature Verification)');
    const simulatedPaymentId = 'pay_sim_' + crypto.randomBytes(8).toString('hex');
    const webhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_simulated_freshveggies',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: simulatedPaymentId,
            entity: 'payment',
            amount: initialOrderDoc.totalPrice * 100, // paise
            currency: 'INR',
            status: 'captured',
            order_id: rzpOrderId,
            method: 'upi',
            captured: true
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    });

    const validSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(Buffer.from(webhookPayload, 'utf8'))
      .digest('hex');

    const webhookRes = await makeRequest({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature
      },
      body: webhookPayload
    });

    assert(webhookRes.status === 200, `POST /api/payments/webhook accepted with HTTP 200`);
    assert(webhookRes.data.received === true || webhookRes.data.success === true, 'Webhook confirmed payload received');

    // ── STEP 5: Order State Machine & Stock Transition Validation ───────────
    console.log('\n▶ 5. Database Order State & Inventory Verification');
    const confirmedOrderDoc = await Order.findById(internalOrderId);
    assert(confirmedOrderDoc.orderStatus === 'Confirmed', 'Order status automatically transitioned to "Confirmed"');
    assert(confirmedOrderDoc.paymentStatus === 'Paid', 'Order paymentStatus transitioned to "Paid"');
    assert(confirmedOrderDoc.paymentDetails.razorpayPaymentId === simulatedPaymentId, 'Payment ID linked to order record');

    const lastStatusHistory = confirmedOrderDoc.statusHistory[confirmedOrderDoc.statusHistory.length - 1];
    assert(lastStatusHistory.status === 'Confirmed', 'Status history audit contains "Confirmed" entry');
    assert(lastStatusHistory.note.includes('Razorpay webhook'), 'Audit note specifies confirmation via Razorpay webhook');

    // Verify stock decremented
    const updatedProduct = await Product.findById(product._id);
    assert(updatedProduct.stock === initialProductStock - 1, `Inventory stock decremented by 1 unit (${initialProductStock} → ${updatedProduct.stock})`);

    // ── STEP 6: Malformed / Tampered Webhook Signature Rejection Guard ───────
    console.log('\n▶ 6. Malformed & Tampered Webhook Signature Security Guard');
    const tamperedSignature = crypto.randomBytes(32).toString('hex');
    const tamperedRes = await makeRequest({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': tamperedSignature
      },
      body: webhookPayload
    });
    assert(tamperedRes.status === 400, 'Tampered HMAC signature rejected with HTTP 400');
    assert(tamperedRes.data.message.includes('mismatch'), 'Response correctly reports signature mismatch');

    // ── STEP 7: Webhook Idempotency Validation (Prevent Double Decrement) ───
    console.log('\n▶ 7. Webhook Idempotency & Replay Defense');
    const replayRes = await makeRequest({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature
      },
      body: webhookPayload
    });
    assert(replayRes.status === 200, 'Replayed webhook returns HTTP 200 without throwing errors');
    const afterReplayProduct = await Product.findById(product._id);
    assert(afterReplayProduct.stock === updatedProduct.stock, 'Replayed webhook did NOT double-decrement inventory stock');

    // ── Cleanup Test Artifacts ──────────────────────────────────────────────
    // Restore product stock
    await Product.findByIdAndUpdate(product._id, { $inc: { stock: 1 } });
    await Order.findByIdAndDelete(internalOrderId);
    await Coupon.findByIdAndDelete(coupon._id);
    console.log('\n🧹 Cleaned up simulation test order and restored original inventory stock.');

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log(`🎉 ALL CHECKOUT & WEBHOOK SIMULATION TESTS PASSED: ${passedAssertions}/${passedAssertions}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

  } finally {
    await mongoose.disconnect();
  }
}

runCheckoutSimulation().catch((err) => {
  console.error('\n❌ Checkout simulation failure:', err);
  process.exit(1);
});
