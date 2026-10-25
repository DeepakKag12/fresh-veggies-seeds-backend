/**
 * Fresh Veggies - Live End-to-End Workflows & Security Verification Suite
 * ───────────────────────────────────────────────────────────────────────
 * Tests live customer and administrative workflows, security invariants,
 * fault tolerance, input boundary rejection, and HTTP response headers
 * against the live backend server.
 */

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    passedCount++;
    console.log(`  ${green('✔')} ${message}`);
  } else {
    failedCount++;
    console.error(`  ${red('✖')} ${bold('FAILED:')} ${message}`);
  }
}

async function runE2EWorkflows() {
  console.log(bold('\n🌱 ═══════════════════════════════════════════════════════════════'));
  console.log(bold('   FRESH VEGGIES - END-TO-END WORKFLOWS & SECURITY TEST SUITE'));
  console.log(bold('═══════════════════════════════════════════════════════════════\n'));

  const client = axios.create({
    baseURL: 'http://127.0.0.1:5000',
    validateStatus: () => true, // Don't throw on 4xx/5xx
    timeout: 5000,
  });

  // ─────────────────────────────────────────────────────────────
  // 1. HEALTH & INFRASTRUCTURE READINESS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('▶ 1. Health & Infrastructure Readiness')));
  const healthRes = await client.get('/health');
  assert(healthRes.status === 200, 'Health endpoint responds with HTTP 200');
  assert(healthRes.data?.status === 'healthy', 'Health reports status: healthy');
  assert(healthRes.data?.database === 'connected', 'MongoDB connection is actively connected');
  assert(typeof healthRes.data?.uptime === 'number', 'Uptime is reported');

  // Security: Unauthenticated caller cannot inspect internal secret configuration
  const configRes = await client.get('/health/config');
  assert(configRes.status === 401, 'Unauthenticated /health/config is protected (401)');

  // ─────────────────────────────────────────────────────────────
  // 2. STOREFRONT CATALOGUE & CATEGORY WORKFLOWS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 2. Storefront Catalogue & Category Workflows')));
  const catRes = await client.get('/api/categories');
  assert(catRes.status === 200, 'GET /api/categories returns HTTP 200');
  assert(Array.isArray(catRes.data?.data), 'Returns an array of categories');
  
  const categories = catRes.data?.data || [];
  const featuredInCircle = categories.filter(c => c.showInCircle === true && c.isActive === true);
  assert(featuredInCircle.length >= 2, `Category circle strip has active categories (found ${featuredInCircle.length})`);
  
  const hasFlowers = categories.some(c => c.slug?.includes('flower') || c.name?.toLowerCase().includes('flower'));
  assert(hasFlowers, 'Flowers category exists in catalogue');

  // Products
  const prodRes = await client.get('/api/products');
  assert(prodRes.status === 200, 'GET /api/products returns HTTP 200');
  assert(prodRes.data?.count > 0, `Products catalogue returned ${prodRes.data?.count} items`);
  const firstProd = prodRes.data?.data?.[0];
  assert(firstProd && firstProd.name && firstProd.price !== undefined, 'Products contain required name and price fields');

  // Combos
  const comboRes = await client.get('/api/combos');
  assert(comboRes.status === 200, 'GET /api/combos returns HTTP 200');

  // Storefront Public Settings
  const settingsRes = await client.get('/api/settings');
  assert(settingsRes.status === 200, 'GET /api/settings returns HTTP 200');
  assert(settingsRes.data?.data?.delivery?.deliveryCharge !== undefined, 'Delivery charge configuration is available to storefront');

  // ─────────────────────────────────────────────────────────────
  // 3. SHIPPING & PINCODE SERVICEABILITY WORKFLOW
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 3. Shipping & Pincode Serviceability Workflow')));
  const validPinRes = await client.get('/api/orders/check-pincode/452001');
  assert(validPinRes.status === 200, 'Pincode check for 452001 returns HTTP 200');
  assert(validPinRes.data?.success === true, 'Pincode 452001 is reported serviceable');

  const invalidPinRes = await client.get('/api/orders/check-pincode/999999');
  assert(invalidPinRes.status === 200 || invalidPinRes.status === 400, 'Invalid/unserviceable pincode handled gracefully');

  // ─────────────────────────────────────────────────────────────
  // 4. COUPON VALIDATION & PRICING RULES
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 4. Coupon Validation & Pricing Rules')));
  const emptyCouponRes = await client.post('/api/coupons/validate', { code: '', orderAmount: 500 });
  assert(emptyCouponRes.status === 400, 'Empty coupon code rejected with HTTP 400');

  const fakeCouponRes = await client.post('/api/coupons/validate', { code: 'TOTALLY_FAKE_CODE_999', orderAmount: 500 });
  assert(fakeCouponRes.status === 400, 'Non-existent coupon rejected with HTTP 400 (not 500)');

  // ─────────────────────────────────────────────────────────────
  // 5. SECURITY & BROKEN ACCESS CONTROL (BAC) AUDIT
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 5. Security & Broken Access Control (BAC) Audit')));
  
  // Protected customer endpoints require valid Bearer token
  const myOrdersRes = await client.get('/api/orders/myorders');
  assert(myOrdersRes.status === 401, 'GET /api/orders/myorders blocked for unauthenticated users (401)');

  const createOrderRes = await client.post('/api/orders', { orderItems: [] });
  assert(createOrderRes.status === 401, 'POST /api/orders blocked for unauthenticated users (401)');

  const paymentCreateRes = await client.post('/api/payments/create-order', {});
  assert(paymentCreateRes.status === 401, 'POST /api/payments/create-order blocked for unauthenticated users (401)');

  // Protected admin endpoints require admin token
  const adminStatsRes = await client.get('/api/admin/stats');
  assert(adminStatsRes.status === 401, 'GET /api/admin/stats blocked for unauthenticated users (401)');

  const adminUsersRes = await client.get('/api/admin/users');
  assert(adminUsersRes.status === 401, 'GET /api/admin/users blocked for unauthenticated users (401)');

  const purgePreviewRes = await client.get('/api/admin/purge-data/preview');
  assert(purgePreviewRes.status === 401, 'GET /api/admin/purge-data/preview blocked for unauthenticated users (401)');

  // IDOR & malformed ObjectId guards
  const malformedProdRes = await client.get('/api/products/malformed-id-12345');
  assert(malformedProdRes.status === 400, 'Malformed product ObjectId rejected with HTTP 400 (not 500)');

  const malformedOrderRes = await client.get('/api/orders/malformed-id-12345');
  assert(malformedOrderRes.status === 401 || malformedOrderRes.status === 400, 'Malformed order ID safely rejected');

  // ─────────────────────────────────────────────────────────────
  // 6. FAULT TOLERANCE & MALFORMED INPUT REJECTION
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 6. Fault Tolerance & Malformed Input Rejection')));

  // Malformed JSON / unexpected keys in auth
  const badLoginRes = await client.post('/api/auth/login', { identifier: '', password: '' });
  assert(badLoginRes.status === 400, 'Empty login credentials return HTTP 400');
  assert(badLoginRes.data?.success === false, 'Empty login returns success: false');

  const badRegisterRes = await client.post('/api/auth/register', { name: '', email: 'notanemail' });
  assert(badRegisterRes.status === 400, 'Invalid registration payload rejected with HTTP 400');

  // Contact form validation
  const shortContactRes = await client.post('/api/contact', { name: 'A', email: 'bademail', message: 'Hi' });
  assert(shortContactRes.status === 400, 'Invalid contact form submission rejected with HTTP 400');

  // ─────────────────────────────────────────────────────────────
  // 7. HTTP RESPONSE HEADERS & CACHING POLICY
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 7. HTTP Response Headers & Caching Policy')));
  assert(healthRes.headers['x-content-type-options'] === 'nosniff', 'Security header: X-Content-Type-Options: nosniff present');
  assert(catRes.headers['cache-control'] !== undefined, 'Cache-Control header configured on categories endpoint');

  // 404 handler returns clean JSON
  const notFoundRes = await client.get('/api/non-existent-endpoint-xyz');
  assert(notFoundRes.status === 404, 'Non-existent API route returns HTTP 404');
  assert(typeof notFoundRes.data === 'object', 'Non-existent route returns structured JSON, not HTML stack trace');

  // ─────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────
  console.log(bold(`\n═══════════════════════════════════════════════════════════════`));
  console.log(bold(`TOTAL E2E WORKFLOW ASSERTIONS: ${passedCount + failedCount}`));
  console.log(`${green(`Passed: ${passedCount}`)}`);
  console.log(`${failedCount > 0 ? red(`Failed: ${failedCount}`) : green(`Failed: 0`)}`);
  console.log(bold(`═══════════════════════════════════════════════════════════════\n`));

  if (failedCount > 0) {
    process.exit(1);
  }
}

runE2EWorkflows().catch((err) => {
  console.error('Fatal E2E test failure:', err.message);
  process.exit(1);
});
