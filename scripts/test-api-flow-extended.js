/**
 * Fresh Veggies - Extended API Controller Unit & Flow Tests
 * ─────────────────────────────────────────────────────────────
 * Tests controller request/response cycles with mock req and res objects.
 */

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

// Mock Express Response Factory
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

async function runControllerTests() {
  console.log(bold('\n🌱 ═══════════════════════════════════════════════════════════════'));
  console.log(bold('   FRESH VEGGIES - EXTENDED API CONTROLLER TESTS'));
  console.log(bold('═══════════════════════════════════════════════════════════════\n'));

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: AUTH CONTROLLER VALIDATION
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('▶ SUITE 1: Auth Controller Request Validations')));
  const authController = require('../controllers/authController');

  // 1. Register with missing fields
  const regRes1 = createMockRes();
  await authController.register({ body: { name: '', email: '', phone: '', password: '' } }, regRes1);
  assert(regRes1.statusCode === 400, 'Register: rejects missing fields with status 400');
  assert(regRes1.body?.success === false, 'Register: returns success: false');

  // 2. Register with invalid email
  const regRes2 = createMockRes();
  await authController.register({ body: { name: 'Deepak', email: 'not-an-email', phone: '9876543210', password: 'ValidPass123' } }, regRes2);
  assert(regRes2.statusCode === 400, 'Register: rejects invalid email with status 400');
  assert(regRes2.body?.message?.includes('valid email'), 'Register: returns email error message');

  // 3. Register with invalid phone
  const regRes3 = createMockRes();
  await authController.register({ body: { name: 'Deepak', email: 'deepak@test.com', phone: '12345', password: 'ValidPass123' } }, regRes3);
  assert(regRes3.statusCode === 400, 'Register: rejects invalid phone with status 400');
  assert(regRes3.body?.message?.includes('10-digit Indian mobile'), 'Register: returns phone error message');

  // 4. Register with weak password
  const regRes4 = createMockRes();
  await authController.register({ body: { name: 'Deepak', email: 'deepak@test.com', phone: '9876543210', password: '123' } }, regRes4);
  assert(regRes4.statusCode === 400, 'Register: rejects weak password with status 400');

  // 5. Login with missing credentials
  const loginRes1 = createMockRes();
  await authController.login({ body: { email: '', password: '' } }, loginRes1);
  assert(loginRes1.statusCode === 400, 'Login: rejects empty credentials with status 400');

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: ORDER & PAYMENT CONTROLLER VALIDATION
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ SUITE 2: Order & Payment Controller Validations')));
  const orderController = require('../controllers/orderController');
  const paymentController = require('../controllers/paymentController');

  // 1. Create order with empty items
  const orderRes1 = createMockRes();
  await orderController.createOrder({ body: { orderItems: [] }, user: { _id: 'mockUserId' } }, orderRes1);
  assert(orderRes1.statusCode === 400, 'CreateOrder: rejects empty items array with 400');

  // 2. Create online payment order with empty items
  const payRes1 = createMockRes();
  await paymentController.createRazorpayOrder({ body: { orderItems: [] }, user: { _id: 'mockUserId' } }, payRes1);
  assert(payRes1.statusCode === 400, 'CreateRazorpayOrder: rejects empty items array with 400');

  // 3. Verify payment signature missing fields
  const verifyRes1 = createMockRes();
  await paymentController.verifyPayment({ body: {}, user: { _id: 'mockUserId' } }, verifyRes1);
  assert(verifyRes1.statusCode === 400, 'VerifyPayment: rejects missing fields with 400');

  // 4. Webhook missing signature
  const webhookRes1 = createMockRes();
  await paymentController.razorpayWebhook({ headers: {}, body: Buffer.from('{}') }, webhookRes1);
  assert(webhookRes1.statusCode === 400, 'RazorpayWebhook: rejects missing webhook signature with 400');

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: REVIEW CONTROLLER VALIDATION
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ SUITE 3: Review Controller Validations')));
  const reviewController = require('../controllers/reviewController');

  // 1. Get reviews with malformed ObjectId
  const revRes1 = createMockRes();
  await reviewController.getProductReviews({ params: { productId: 'invalid-id' }, query: {} }, revRes1);
  assert(revRes1.statusCode === 400, 'GetProductReviews: rejects invalid ObjectId with 400');

  // 2. Check eligibility with malformed ObjectId
  const revRes2 = createMockRes();
  await reviewController.checkReviewEligibility({ params: { productId: 'invalid-id' }, user: { _id: 'user123' } }, revRes2);
  assert(revRes2.statusCode === 400, 'CheckReviewEligibility: rejects invalid ObjectId with 400');

  // 3. Create review with invalid rating (e.g. 6 or negative)
  const revRes3 = createMockRes();
  await reviewController.createReview({
    body: { productId: '64f1a2b3c4d5e6f7a8b9c0d1', rating: 6, title: 'Good', comment: 'Great seeds' },
    user: { _id: 'user123' }
  }, revRes3);
  assert(revRes3.statusCode === 400, 'CreateReview: rejects rating > 5 with 400');

  // ─────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────
  console.log(bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(`Total Assertions: ${passedCount + failedCount}`);
  console.log(`Passed: ${green(passedCount)}`);
  console.log(`Failed: ${failedCount === 0 ? green(0) : red(failedCount)}`);
  console.log(bold('═══════════════════════════════════════════════════════════════\n'));

  if (failedCount > 0) {
    process.exit(1);
  }
}

runControllerTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
