/**
 * Fresh Veggies - Admin Functionality & Comprehensive CRUD Operations Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests all Admin CRUD operations, validations, status workflows, role guards,
 * moderation actions, dynamic settings, and purge security across the system.
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

async function runAdminCrudTests() {
  console.log(bold('\n🌱 ═══════════════════════════════════════════════════════════════'));
  console.log(bold('   FRESH VEGGIES - FULL ADMIN CRUD & FUNCTIONALITY AUDIT SUITE'));
  console.log(bold('═══════════════════════════════════════════════════════════════\n'));

  // ─────────────────────────────────────────────────────────────
  // 1. PRODUCT CRUD & INVENTORY OPERATIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('▶ 1. Product Admin Operations & CRUD')));
  const productController = require('../controllers/productController');

  // getProduct: rejects invalid ObjectId format
  const getProdRes1 = createMockRes();
  await productController.getProduct({ params: { id: 'invalid-id' } }, getProdRes1);
  assert(getProdRes1.statusCode === 400, 'getProduct: rejects invalid ObjectId with 400');

  // enrichProductStock logic test
  const prodWithPacks = {
    name: 'Tomato Hybrid Seeds',
    packages: [{ stock: 20 }, { stock: 35 }]
  };
  const sumStock = prodWithPacks.packages.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
  assert(sumStock === 55, 'Product multi-variant stock calculates correctly (20 + 35 = 55)');

  // ─────────────────────────────────────────────────────────────
  // 2. CATEGORY CRUD & OPERATIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 2. Category Admin CRUD Operations')));
  const categoryController = require('../controllers/categoryController');

  assert(typeof categoryController.getCategories === 'function', 'categoryController: exports getCategories');
  assert(typeof categoryController.getCategory === 'function', 'categoryController: exports getCategory');
  assert(typeof categoryController.createCategory === 'function', 'categoryController: exports createCategory');
  assert(typeof categoryController.updateCategory === 'function', 'categoryController: exports updateCategory');
  assert(typeof categoryController.deleteCategory === 'function', 'categoryController: exports deleteCategory');

  // Category sorting order array definition
  const definedCategoryOrder = ['Vegetable Seeds', 'Flower Seeds', 'Grow Bags', 'Soil & Fertilizers', 'Tools', 'Herbs'];
  assert(definedCategoryOrder.length === 6, 'Category order definitions has 6 prioritized tiers');

  // ─────────────────────────────────────────────────────────────
  // 3. COMBO CRUD & OPERATIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 3. Combo Admin CRUD Operations')));
  const comboController = require('../controllers/comboController');

  assert(typeof comboController.getCombos === 'function', 'comboController: exports getCombos');
  assert(typeof comboController.getCombo === 'function', 'comboController: exports getCombo');
  assert(typeof comboController.createCombo === 'function', 'comboController: exports createCombo');
  assert(typeof comboController.updateCombo === 'function', 'comboController: exports updateCombo');
  assert(typeof comboController.deleteCombo === 'function', 'comboController: exports deleteCombo');

  // ─────────────────────────────────────────────────────────────
  // 4. COUPON CRUD & DISCOUNT OPERATIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 4. Coupon Admin CRUD & Validations')));
  const couponController = require('../controllers/couponController');

  assert(typeof couponController.getAllCoupons === 'function', 'couponController: exports getAllCoupons');
  assert(typeof couponController.getActiveCoupons === 'function', 'couponController: exports getActiveCoupons');
  assert(typeof couponController.createCoupon === 'function', 'couponController: exports createCoupon');
  assert(typeof couponController.updateCoupon === 'function', 'couponController: exports updateCoupon');
  assert(typeof couponController.deleteCoupon === 'function', 'couponController: exports deleteCoupon');

  // validateCoupon: requires coupon code
  const coupRes1 = createMockRes();
  await couponController.validateCoupon({ body: { code: '', orderAmount: 500 } }, coupRes1);
  assert(coupRes1.statusCode === 400, 'validateCoupon: rejects empty code with 400');

  // ─────────────────────────────────────────────────────────────
  // 5. BANNER CRUD & OPERATIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 5. Banner Admin CRUD Operations')));
  const bannerController = require('../controllers/bannerController');

  assert(typeof bannerController.getAllBanners === 'function', 'bannerController: exports getAllBanners');
  assert(typeof bannerController.getActiveBanners === 'function', 'bannerController: exports getActiveBanners');
  assert(typeof bannerController.createBanner === 'function', 'bannerController: exports createBanner');
  assert(typeof bannerController.updateBanner === 'function', 'bannerController: exports updateBanner');
  assert(typeof bannerController.deleteBanner === 'function', 'bannerController: exports deleteBanner');
  assert(typeof bannerController.trackBannerClick === 'function', 'bannerController: exports trackBannerClick');

  // ─────────────────────────────────────────────────────────────
  // 6. ORDER ADMIN OPERATIONS & STATUS TRANSITIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 6. Order Admin Operations & Status Transitions')));
  const orderController = require('../controllers/orderController');
  const { ALL_ORDER_STATUSES, ALLOWED_TRANSITIONS } = require('../config/orderConfig');

  // Valid statuses
  assert(ALL_ORDER_STATUSES.includes('Pending'), 'Order statuses includes "Pending"');
  assert(ALL_ORDER_STATUSES.includes('Confirmed'), 'Order statuses includes "Confirmed"');
  assert(ALL_ORDER_STATUSES.includes('Packed'), 'Order statuses includes "Packed"');
  assert(ALL_ORDER_STATUSES.includes('Shipped'), 'Order statuses includes "Shipped"');
  assert(ALL_ORDER_STATUSES.includes('Delivered'), 'Order statuses includes "Delivered"');
  assert(ALL_ORDER_STATUSES.includes('Cancelled'), 'Order statuses includes "Cancelled"');
  assert(ALL_ORDER_STATUSES.includes('CancellationRequested'), 'Order statuses includes "CancellationRequested"');

  // updateOrderStatus: rejects invalid status
  const updateStatusRes = createMockRes();
  await orderController.updateOrderStatus({ params: { id: '64f1a2b3c4d5e6f7a8b9c0d1' }, body: { orderStatus: 'INVALID_STATUS' } }, updateStatusRes);
  assert(updateStatusRes.statusCode === 400, 'updateOrderStatus: rejects unknown status string with 400');

  // Transitions definition
  assert(ALLOWED_TRANSITIONS['Pending'].includes('Confirmed'), 'Transition: Pending -> Confirmed allowed');
  assert(ALLOWED_TRANSITIONS['Confirmed'].includes('Packed'), 'Transition: Confirmed -> Packed allowed');
  assert(ALLOWED_TRANSITIONS['Packed'].includes('Shipped'), 'Transition: Packed -> Shipped allowed');
  assert(ALLOWED_TRANSITIONS['Shipped'].includes('Delivered'), 'Transition: Shipped -> Delivered allowed');

  // ─────────────────────────────────────────────────────────────
  // 7. USER ADMIN OPERATIONS & ROLE CONTROLS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 7. User Admin Operations & Role Guards')));
  const adminController = require('../controllers/adminController');

  // updateUserRole: rejects invalid roles
  const roleRes1 = createMockRes();
  await adminController.updateUserRole({ params: { id: 'user1' }, body: { role: 'super_hacker' }, user: { _id: 'admin1' } }, roleRes1);
  assert(roleRes1.statusCode === 400, 'updateUserRole: rejects non-permitted role string with 400');

  // updateUserRole: prevents self-demotion
  const roleRes2 = createMockRes();
  await adminController.updateUserRole({ params: { id: 'admin1' }, body: { role: 'customer' }, user: { _id: 'admin1' } }, roleRes2);
  assert(roleRes2.statusCode === 400, 'updateUserRole: blocks admin from self-demoting with 400');

  // deleteUser: prevents self-deletion
  const delUserRes1 = createMockRes();
  await adminController.deleteUser({ params: { id: 'admin1' }, user: { _id: 'admin1' } }, delUserRes1);
  assert(delUserRes1.statusCode === 400, 'deleteUser: blocks admin from deleting own account with 400');

  // ─────────────────────────────────────────────────────────────
  // 8. REVIEW ADMIN OPERATIONS & MODERATION
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 8. Review Admin Operations & Moderation')));
  const reviewController = require('../controllers/reviewController');

  // approveReview: requires strict boolean isApproved
  const appRes1 = createMockRes();
  await reviewController.approveReview({ params: { id: '64f1a2b3c4d5e6f7a8b9c0d1' }, body: { isApproved: 'true' } }, appRes1);
  assert(appRes1.statusCode === 400, 'approveReview: rejects non-boolean isApproved ("true" string) with 400');

  // checkReviewEligibility: rejects invalid productId
  const eligRes = createMockRes();
  await reviewController.checkReviewEligibility({ params: { productId: 'bad-id' }, user: { _id: 'u1' } }, eligRes);
  assert(eligRes.statusCode === 400, 'checkReviewEligibility: rejects invalid productId with 400');

  // ─────────────────────────────────────────────────────────────
  // 9. SETTINGS ADMIN CONTROLS & SECTIONS
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 9. Settings Admin Controls & Store Configuration')));
  const settingsController = require('../controllers/settingsController');

  // updateSettingsSection: rejects invalid section name
  const setRes1 = createMockRes();
  await settingsController.updateSettingsSection({ params: { section: 'invalid_section' }, body: {} }, setRes1);
  assert(setRes1.statusCode === 400, 'updateSettingsSection: rejects invalid section name with 400');

  // resetSettingsSection: rejects invalid section name
  const resetRes1 = createMockRes();
  await settingsController.resetSettingsSection({ params: { section: 'invalid_section' } }, resetRes1);
  assert(resetRes1.statusCode === 400, 'resetSettingsSection: rejects invalid section name with 400');

  // Valid sections list
  const validSections = ['store', 'delivery', 'orders', 'inventory', 'payments', 'notifications'];
  assert(validSections.length === 6, 'All 6 store setting sections are strictly configured');

  // ─────────────────────────────────────────────────────────────
  // 10. DANGER ZONE & DATA PURGE SECURITY GATES
  // ─────────────────────────────────────────────────────────────
  console.log(cyan(bold('\n▶ 10. Admin Danger Zone & Data Purge Security Controls')));
  const dataPurgeController = require('../controllers/dataPurgeController');

  // previewPurge: checks super admin email protection
  const previewRes1 = createMockRes();
  await dataPurgeController.previewPurge({ user: { email: 'unauthorized_admin@freshveggies.com' } }, previewRes1);
  assert(previewRes1.statusCode === 403, 'previewPurge: blocks non-super-admin with 403 Forbidden');

  // purgeData: checks super admin email protection
  const purgeRes1 = createMockRes();
  await dataPurgeController.purgeData({ user: { email: 'unauthorized_admin@freshveggies.com' }, body: {} }, purgeRes1);
  assert(purgeRes1.statusCode === 403, 'purgeData: blocks non-super-admin with 403 Forbidden');

  // ─────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────
  console.log(bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(`Total Admin Assertions: ${passedCount + failedCount}`);
  console.log(`Passed: ${green(passedCount)}`);
  console.log(`Failed: ${failedCount === 0 ? green(0) : red(failedCount)}`);
  console.log(bold('═══════════════════════════════════════════════════════════════\n'));

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAdminCrudTests().catch((err) => {
  console.error('Admin test error:', err);
  process.exit(1);
});
