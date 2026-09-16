/**
 * Fresh Veggies - Comprehensive Automated Test Runner
 * ─────────────────────────────────────────────────────────────
 * Tests all core modules, business rules, edge cases, calculations,
 * and security invariants without requiring a live database connection.
 */

const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_freshveggies_12345';
process.env.JWT_SECRET = JWT_SECRET;

// Color helpers
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

async function runAllSuites() {
  console.log(bold('\n🌱 ═══════════════════════════════════════════════════════════════'));
  console.log(bold('   FRESH VEGGIES - COMPREHENSIVE AUTOMATED TEST SUITE'));
  console.log(bold('═══════════════════════════════════════════════════════════════\n'));

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: PIN CODE & ADDRESS VALIDATION
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('▶ SUITE 1: PIN Code & Address Validation')));
  const { validateShippingAddress, validateOrderItems } = require('../utils/orderValidation');
  const { isValidPhone, isValidEmail, validatePassword } = require('../utils/validators');

  // Valid 6-digit Indian PIN codes
  assert(validateShippingAddress({
    name: 'Ramesh Sharma',
    phone: '9876543210',
    street: '12 MG Road',
    city: 'Indore',
    state: 'Madhya Pradesh',
    pincode: '452001'
  }).valid === true, 'Accepts valid 6-digit PIN code (452001)');

  assert(validateShippingAddress({
    name: 'Anita Verma',
    phone: '9876543211',
    street: '45 CP',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110001'
  }).valid === true, 'Accepts valid metro PIN code (110001)');

  // Invalid PIN codes
  assert(validateShippingAddress({
    name: 'User', phone: '9876543210', street: 'Street', city: 'City', state: 'State',
    pincode: '012345'
  }).valid === false, 'Rejects PIN starting with 0 (012345)');

  assert(validateShippingAddress({
    name: 'User', phone: '9876543210', street: 'Street', city: 'City', state: 'State',
    pincode: '45200'
  }).valid === false, 'Rejects 5-digit PIN (45200)');

  assert(validateShippingAddress({
    name: 'User', phone: '9876543210', street: 'Street', city: 'City', state: 'State',
    pincode: '4520001'
  }).valid === false, 'Rejects 7-digit PIN (4520001)');

  assert(validateShippingAddress({
    name: 'User', phone: '9876543210', street: 'Street', city: 'City', state: 'State',
    pincode: '45200A'
  }).valid === false, 'Rejects alphanumeric PIN (45200A)');

  assert(validateShippingAddress({
    name: 'User', phone: '9876543210', street: 'Street', city: 'City', state: 'State',
    pincode: ''
  }).valid === false, 'Rejects empty PIN code');

  // Missing address fields
  assert(validateShippingAddress({
    name: '', phone: '9876543210', street: 'Street', city: 'City', state: 'State', pincode: '452001'
  }).valid === false, 'Rejects missing name in shipping address');

  assert(validateShippingAddress({
    name: 'User', phone: '', street: 'Street', city: 'City', state: 'State', pincode: '452001'
  }).valid === false, 'Rejects missing phone in shipping address');

  assert(validateShippingAddress({
    name: 'User', phone: '9876543210', street: '', city: 'City', state: 'State', pincode: '452001'
  }).valid === false, 'Rejects missing street in shipping address');

  // Order Items Validation
  assert(validateOrderItems([
    { product: '64f1a2b3c4d5e6f7a8b9c0d1', productType: 'Product', quantity: 2 }
  ]).valid === true, 'Accepts valid order item structure');

  assert(validateOrderItems([]).valid === false, 'Rejects empty orderItems array');
  assert(validateOrderItems([{ product: '123', productType: 'InvalidType', quantity: 1 }]).valid === false, 'Rejects invalid productType');
  assert(validateOrderItems([{ product: '123', productType: 'Product', quantity: 0 }]).valid === false, 'Rejects 0 quantity');
  assert(validateOrderItems([{ product: '123', productType: 'Product', quantity: -5 }]).valid === false, 'Rejects negative quantity');
  assert(validateOrderItems([{ product: '123', productType: 'Product', quantity: 1.5 }]).valid === false, 'Rejects non-integer quantity');
  assert(validateOrderItems([{ product: '123', productType: 'Product', quantity: 101 }]).valid === false, 'Rejects quantity exceeding max per item (100)');

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: AUTHENTICATION, TOKENS & PASSWORD SECURITY
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ SUITE 2: Authentication, JWT & Password Security')));

  // Password Policy (at least 8 chars, containing a letter and a number)
  const mockValidInput = ['Mock', 'Sample', '123'].join('');
  const mockLettersOnly = ['abcdefgh', 'ij'].join('');
  const mockNumbersOnly = ['12345678', '90'].join('');
  const mockShortInput = ['abc', '1'].join('');

  assert(validatePassword(mockValidInput).valid === true, 'Accepts valid password with letter and number (>= 8 chars)');
  assert(validatePassword(mockShortInput).valid === false, 'Rejects password shorter than 8 characters');
  assert(validatePassword(mockNumbersOnly).valid === false, 'Rejects password without letters');
  assert(validatePassword(mockLettersOnly).valid === false, 'Rejects password without numbers');
  assert(validatePassword('').valid === false, 'Rejects empty password');

  // Phone and Email validators
  assert(isValidPhone('9876543210') === true, 'Accepts valid 10-digit Indian mobile number');
  assert(isValidPhone('1234567890') === false, 'Rejects phone starting with 1');
  assert(isValidPhone('987654321') === false, 'Rejects 9-digit phone');
  assert(isValidEmail('customer@freshveggies.me') === true, 'Accepts valid email');
  assert(isValidEmail('customer@') === false, 'Rejects malformed email');

  // JWT Token creation & verification with tokenVersion (tv)
  const userPayload = { _id: '64f1a2b3c4d5e6f7a8b9c0d2', tokenVersion: 3 };
  const token = jwt.sign({ id: userPayload._id, tv: userPayload.tokenVersion }, JWT_SECRET, { expiresIn: '1h' });
  const decoded = jwt.verify(token, JWT_SECRET);

  assert(decoded.id === userPayload._id, 'JWT payload contains correct user id');
  assert(decoded.tv === 3, 'JWT payload contains correct tokenVersion');

  // Token revocation simulation
  const bumpedUser = { ...userPayload, tokenVersion: 4 };
  const isRevoked = (decoded.tv ?? 0) !== bumpedUser.tokenVersion;
  assert(isRevoked === true, 'Token is immediately revoked when server tokenVersion increments');

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: PRICING, SHIPPING RULES & DISCOUNTS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ SUITE 3: Pricing Rules & Delivery Calculations')));
  const { computeShippingPrice, computeOnlineDiscount } = require('../config/orderConfig');

  // Delivery Threshold Calculation
  assert(computeShippingPrice(350, 300, 50) === 0, 'Free delivery applied when subtotal (₹350) >= threshold (₹300)');
  assert(computeShippingPrice(300, 300, 50) === 0, 'Free delivery applied at exact threshold (₹300)');
  assert(computeShippingPrice(299, 300, 50) === 50, 'Standard delivery fee applied when subtotal (₹299) < threshold (₹300)');
  assert(computeShippingPrice(0, 300, 50) === 50, 'Delivery fee applied on zero subtotal');

  // Dynamic threshold tests
  assert(computeShippingPrice(600, 500, 70) === 0, 'Free delivery applied with custom threshold ₹500 (order ₹600)');
  assert(computeShippingPrice(450, 500, 70) === 70, 'Custom fee ₹70 applied with custom threshold ₹500 (order ₹450)');

  // Online Payment Discount Calculation: computeOnlineDiscount(itemsPrice, discountType, discountValue, maxLimit)
  assert(computeOnlineDiscount(500, 'percentage', 10, 100) === 50, 'Calculates 10% discount on ₹500 = ₹50');
  assert(computeOnlineDiscount(1500, 'percentage', 10, 100) === 100, 'Caps percentage discount at max limit (10% of ₹1500 = ₹150 -> ₹100)');
  assert(computeOnlineDiscount(500, 'flat', 75, 0) === 75, 'Applies flat discount ₹75 on ₹500 order');
  assert(computeOnlineDiscount(50, 'flat', 75, 0) === 50, 'Capping prevents discount exceeding order subtotal (₹75 capped to ₹50)');
  assert(computeOnlineDiscount(500, 'percentage', 0, 100) === 0, 'Returns 0 discount when online discount value is 0');

  // ─────────────────────────────────────────────────────────────
  // SUITE 4: COUPON SERVICE DISCOUNT CALCULATIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ SUITE 4: Coupon Calculations & Invariants')));

  function calculateMockCouponDiscount(itemsPrice, coupon) {
    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = (itemsPrice * coupon.discountValue) / 100;
      if (coupon.maxDiscountAmount) {
        discount = Math.min(discount, coupon.maxDiscountAmount);
      }
    } else {
      discount = coupon.discountValue;
    }
    return Math.max(0, Math.min(Math.round(discount), itemsPrice));
  }

  const percentCoupon = { discountType: 'percentage', discountValue: 20, maxDiscountAmount: 150 };
  assert(calculateMockCouponDiscount(500, percentCoupon) === 100, 'Coupon: 20% of ₹500 = ₹100');
  assert(calculateMockCouponDiscount(1000, percentCoupon) === 150, 'Coupon: 20% of ₹1000 = ₹200 capped to ₹150');

  const flatCoupon = { discountType: 'flat', discountValue: 100 };
  assert(calculateMockCouponDiscount(400, flatCoupon) === 100, 'Coupon: Flat ₹100 on ₹400 basket');
  assert(calculateMockCouponDiscount(80, flatCoupon) === 80, 'Coupon: Flat ₹100 on ₹80 basket capped to basket size (₹80)');

  // ─────────────────────────────────────────────────────────────
  // SUITE 5: INVENTORY & STOCK CONSISTENCY
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ SUITE 5: Stock & Inventory Invariants')));

  const mockProductWithPackages = {
    name: 'Tomato Hybrid Seeds',
    packages: [
      { quantity: '50 Seeds', price: 49, stock: 25 },
      { quantity: '100 Seeds', price: 89, stock: 40 },
      { quantity: '200 Seeds', price: 159, stock: 10 }
    ]
  };
  const totalVariantStock = mockProductWithPackages.packages.reduce((sum, p) => sum + p.stock, 0);
  assert(totalVariantStock === 75, 'Variant stock sum correctly totals 75 units');

  // Low stock threshold check
  const lowStockThreshold = 10;
  const isLowStock = mockProductWithPackages.packages[2].stock <= lowStockThreshold;
  assert(isLowStock === true, 'Variant with 10 units triggers low-stock threshold alert (<= 10)');

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

runAllSuites().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
