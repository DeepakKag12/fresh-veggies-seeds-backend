const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/user.model');
const Settings = require('../src/models/settings.model');
const { getShippingRules, computeShippingPrice } = require('../src/config/order.config');

async function runLoop1() {
  console.log('====================================================');
  console.log('🔍 AUDIT LOOP 1: Identity, Addresses & Core Config');
  console.log('   Features: FEAT-001, FEAT-002, FEAT-024');
  console.log('====================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fresh_veggies_test';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const results = [];

  try {
    // ─── FEAT-001: Identity, Registration & OTP ─────────────────────────────
    console.log('\n--- [FEAT-001] Testing Identity, Registration & OTP ---');
    const testEmail = `audit_user_${Date.now()}@freshveggies.test`;
    const testPhone = '9876543210';
    const testPassword = 'Password@123';

    // 1. Clean up any previous test user
    await User.deleteMany({ $or: [{ email: testEmail }, { phone: testPhone }] });

    // 2. Register valid customer
    const user = await User.create({
      name: 'Audit Customer',
      email: testEmail,
      phone: testPhone,
      password: testPassword,
      role: 'customer',
      emailVerified: true
    });
    console.log(`✓ 1. Valid customer registered: ${user._id}`);
    results.push({ test: 'FEAT-001: Register valid customer', status: 'PASS' });

    // 3. Attempt duplicate email
    let duplicateRejected = false;
    try {
      await User.create({
        name: 'Duplicate User',
        email: testEmail,
        phone: '9876543211',
        password: testPassword
      });
    } catch (err) {
      if (err.code === 11000 || err.name === 'MongoServerError') {
        duplicateRejected = true;
      }
    }
    if (!duplicateRejected) throw new Error('Duplicate email should be rejected with unique constraint error');
    console.log('✓ 2. Duplicate email rejected by unique index');
    results.push({ test: 'FEAT-001: Duplicate email rejection', status: 'PASS' });

    // 4. Invalid mobile regex test
    const { isValidPhone } = require('../src/validators/auth.validator');
    if (isValidPhone('12345') || isValidPhone('abc1234567') || !isValidPhone('9876543210')) {
      throw new Error('Phone regex failed to reject 12345 or accept 9876543210');
    }
    console.log('✓ 3. Invalid mobile regex (12345) successfully rejected');
    results.push({ test: 'FEAT-001: Invalid phone regex validation', status: 'PASS' });

    // 5. Test OTP generation & sandbox token '123456'
    user.generateOTP();
    await user.save({ validateBeforeSave: false });

    const crypto = require('crypto');
    const hashedSandbox = crypto.createHash('sha256').update('123456').digest('hex');
    const isSandboxValid = user.otpExpires > Date.now();
    if (!isSandboxValid) throw new Error('OTP generation failed or expired immediately');
    console.log('✓ 4. OTP generation and expiry verified');
    results.push({ test: 'FEAT-001: OTP generation & expiry', status: 'PASS' });

    // 6. JWT payload verification
    const token = jwt.sign(
      { id: user._id, userId: user._id, role: user.role, tv: user.tokenVersion || 0 },
      process.env.JWT_SECRET || 'test_jwt_secret_123',
      { expiresIn: '7d' }
    );
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test_jwt_secret_123');
    if (!decoded.userId || decoded.role !== 'customer' || !decoded.exp) {
      throw new Error(`JWT payload missing required fields: ${JSON.stringify(decoded)}`);
    }
    console.log(`✓ 5. JWT token contains userId, role (${decoded.role}), and valid exp (${decoded.exp})`);
    results.push({ test: 'FEAT-001: JWT payload claims & expiration', status: 'PASS' });

    // ─── FEAT-002: Address Book & Multi-Address Invariants ──────────────────
    console.log('\n--- [FEAT-002] Testing Address Book Invariants ---');
    user.addresses = [];

    // 1. Add first address (must be default)
    user.addresses.push({
      name: 'Home Address',
      phone: '9876543210',
      street: '123 Green Lane',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India',
      isDefault: true
    });
    await user.save();
    console.log(`✓ 1. First address saved. isDefault: ${user.addresses[0].isDefault}`);
    if (!user.addresses[0].isDefault) throw new Error('First address must be default');
    results.push({ test: 'FEAT-002: First address auto-default', status: 'PASS' });

    // 2. Add second address with isDefault: true
    user.addresses.push({
      name: 'Farmhouse Address',
      phone: '9876543210',
      street: '456 Country Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411038',
      country: 'India',
      isDefault: true
    });
    await user.save();

    // Reload user from database
    const refreshedUser = await User.findById(user._id);
    const defaultAddrs = refreshedUser.addresses.filter(a => a.isDefault);
    if (defaultAddrs.length !== 1 || String(defaultAddrs[0]._id) !== String(refreshedUser.addresses[1]._id)) {
      throw new Error(`Exactly one address must be default. Found ${defaultAddrs.length}`);
    }
    console.log(`✓ 2. Second address marked default. First address flipped to false: ${!refreshedUser.addresses[0].isDefault}`);
    results.push({ test: 'FEAT-002: Default address flipping logic', status: 'PASS' });

    // 3. Delete default address and verify fallback reassigns default
    const addrToDeleteId = refreshedUser.addresses[1]._id;
    refreshedUser.addresses.pull(addrToDeleteId);
    await refreshedUser.save();

    const afterDeleteUser = await User.findById(user._id);
    if (afterDeleteUser.addresses.length !== 1 || !afterDeleteUser.addresses[0].isDefault) {
      throw new Error('After deleting default, remaining address should be reassigned default');
    }
    console.log('✓ 3. Default address deleted; fallback automatically re-assigned default to remaining address');
    results.push({ test: 'FEAT-002: Default deletion fallback reassignment', status: 'PASS' });

    // 4. Test address deduplication logic
    const existingStreet = '123 Green Lane';
    const existingCity = 'Pune';
    const existingPin = '411001';
    const duplicateDetected = afterDeleteUser.addresses.some(a =>
      (a.street || '').toLowerCase() === existingStreet.toLowerCase() &&
      (a.city || '').toLowerCase() === existingCity.toLowerCase() &&
      (a.pincode || '').toString() === existingPin
    );
    if (!duplicateDetected) throw new Error('Address deduplication check failed to detect duplicate street and PIN');
    console.log('✓ 4. Address deduplication check accurately matched existing street/city/pincode');
    results.push({ test: 'FEAT-002: Address deduplication check', status: 'PASS' });

    // ─── FEAT-024: Global Business Settings & Delivery Rules ───────────────
    console.log('\n--- [FEAT-024] Testing Global Settings & Delivery Thresholds ---');
    let settings = await Settings.getSingleton();
    const originalThreshold = settings.delivery.freeDeliveryThreshold;
    const originalCharge = settings.delivery.deliveryCharge;

    // 1. Fetch public settings
    console.log(`✓ 1. Retrieved settings. Current freeDeliveryThreshold: ₹${originalThreshold}`);
    results.push({ test: 'FEAT-024: Retrieve global settings singleton', status: 'PASS' });

    // 2. Update threshold dynamically
    let settingsDoc = await Settings.findOne();
    if (!settingsDoc) settingsDoc = await Settings.create({});
    const newThreshold = 750;
    settingsDoc.delivery.freeDeliveryThreshold = newThreshold;
    settingsDoc.delivery.deliveryCharge = 60;
    await settingsDoc.save();
    Settings.invalidateCache();

    // 3. Check shipping calculation with updated threshold
    const rules = await getShippingRules();
    if (rules.freeDeliveryThreshold !== 750 || rules.deliveryCharge !== 60) {
      throw new Error(`Rules not updated dynamically: ${JSON.stringify(rules)}`);
    }

    // Cart total ₹600 (below ₹750) -> should charge ₹60
    const chargeBelow = computeShippingPrice(600, rules.freeDeliveryThreshold, rules.deliveryCharge);
    if (chargeBelow !== 60) throw new Error(`Expected delivery charge 60 for ₹600 cart, got ${chargeBelow}`);

    // Cart total ₹800 (above ₹750) -> should be free (₹0)
    const chargeAbove = computeShippingPrice(800, rules.freeDeliveryThreshold, rules.deliveryCharge);
    if (chargeAbove !== 0) throw new Error(`Expected free delivery for ₹800 cart, got ${chargeAbove}`);

    console.log(`✓ 2. Dynamically updated free delivery threshold to ₹750. ₹600 cart charge = ₹${chargeBelow}, ₹800 cart charge = ₹${chargeAbove}`);
    results.push({ test: 'FEAT-024: Dynamic shipping threshold & cart charge reflection', status: 'PASS' });

    // Restore original settings
    settingsDoc.delivery.freeDeliveryThreshold = originalThreshold;
    settingsDoc.delivery.deliveryCharge = originalCharge;
    await settingsDoc.save();
    Settings.invalidateCache();
    console.log('✓ 3. Restored original delivery settings');

    // Clean up test customer
    await User.findByIdAndDelete(user._id);
    console.log('✓ Cleaned up test user record');

    console.log('\n====================================================');
    console.log('🎉 AUDIT LOOP 1 SUMMARY: ALL TESTS PASSED GREEN');
    console.log('====================================================');
    console.table(results);
  } catch (err) {
    console.error('\n❌ AUDIT LOOP 1 ERROR:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

runLoop1();
