const dotenv = require('dotenv');
const path = require('path');
const axios = require('axios');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testRoutes() {
  console.log('🧪 ─── STARTING FRONTEND-BACKEND ROUTE CONNECTIVITY AUDIT ───\n');

  // Load the running server
  require('../server');

  // Give server 1.5s to bind port and connect DB
  await new Promise((r) => setTimeout(r, 1500));

  const client = axios.create({
    baseURL: 'http://127.0.0.1:5000/api',
    validateStatus: () => true // Don't throw on non-2xx
  });

  const tests = [
    {
      name: 'GET /api/products (Catalogue listing)',
      fn: async () => {
        const res = await client.get('/products');
        if (res.status === 200 && (res.data?.success || Array.isArray(res.data?.data))) {
          return { pass: true, detail: `Returned ${res.data?.count ?? res.data?.data?.length ?? 0} products` };
        }
        return { pass: false, detail: `Status: ${res.status}` };
      }
    },
    {
      name: 'GET /api/combos (Combo deals listing)',
      fn: async () => {
        const res = await client.get('/combos');
        if (res.status === 200 && (res.data?.success || Array.isArray(res.data?.data))) {
          return { pass: true, detail: `Returned ${res.data?.count ?? res.data?.data?.length ?? 0} combos` };
        }
        return { pass: false, detail: `Status: ${res.status}` };
      }
    },
    {
      name: 'GET /api/settings (Storefront delivery & payment settings)',
      fn: async () => {
        const res = await client.get('/settings');
        if (res.status === 200 && res.data?.data?.delivery) {
          return {
            pass: true,
            detail: `Free delivery over: ₹${res.data.data.delivery.freeDeliveryThreshold}, Delivery fee: ₹${res.data.data.delivery.deliveryCharge}`
          };
        }
        return { pass: false, detail: `Status: ${res.status}` };
      }
    },
    {
      name: 'POST /api/coupons/validate (Coupon validation)',
      fn: async () => {
        const res = await client.post('/coupons/validate', { code: 'WELCOME50', orderAmount: 500 });
        if (res.status === 200 || res.status === 400 || res.status === 404) {
          return { pass: true, detail: `Handled with status ${res.status}: ${res.data?.message || 'OK'}` };
        }
        return { pass: false, detail: `Status: ${res.status}` };
      }
    },
    {
      name: 'POST /api/auth/msg91/verify-token (SMS OTP token verification)',
      fn: async () => {
        const res = await client.post('/auth/msg91/verify-token', {});
        // Should return 400 Bad Request: "Access token from MSG91 OTP widget is required"
        if (res.status === 400 && res.data?.message?.includes('token')) {
          return { pass: true, detail: `Correctly caught missing token: "${res.data.message}"` };
        }
        return { pass: false, detail: `Unexpected status ${res.status}: ${JSON.stringify(res.data)}` };
      }
    },
    {
      name: 'POST /api/orders (Protected order creation guard)',
      fn: async () => {
        const res = await client.post('/orders', {});
        if (res.status === 401) {
          return { pass: true, detail: 'Correctly protected: 401 Unauthorized for unauthenticated request' };
        }
        return { pass: false, detail: `Unexpected status ${res.status}` };
      }
    },
    {
      name: 'POST /api/payments/create-order (Protected Razorpay order creation guard)',
      fn: async () => {
        const res = await client.post('/payments/create-order', {});
        if (res.status === 401) {
          return { pass: true, detail: 'Correctly protected: 401 Unauthorized for unauthenticated request' };
        }
        return { pass: false, detail: `Unexpected status ${res.status}` };
      }
    }
  ];

  let passedCount = 0;
  for (const t of tests) {
    try {
      const result = await t.fn();
      if (result.pass) {
        console.log(`✅ [PASS] ${t.name} → ${result.detail}`);
        passedCount++;
      } else {
        console.error(`❌ [FAIL] ${t.name} → ${result.detail}`);
      }
    } catch (err) {
      console.error(`❌ [ERROR] ${t.name} → ${err.message}`);
    }
  }

  console.log(`\n🎉 ROUTE AUDIT FINISHED: ${passedCount}/${tests.length} tests passed successfully!\n`);
  process.exit(passedCount === tests.length ? 0 : 1);
}

testRoutes().catch((err) => {
  console.error('Fatal route test failure:', err);
  process.exit(1);
});
