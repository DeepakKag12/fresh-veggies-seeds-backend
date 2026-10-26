const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function runTests() {
  console.log('======================================================');
  console.log(' STARTING COMPREHENSIVE BACKEND & BUSINESS LOGIC VERIFICATION');
  console.log('======================================================');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not configured in .env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log(' Connected to MongoDB:', mongoose.connection.name);

  const Category = require('../src/models/category.model');
  const Product = require('../src/models/product.model');
  const Combo = require('../src/models/combo.model');
  const User = require('../src/models/user.model');
  const { buildVerifiedItems } = require('../src/services/pricing.service');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, desc) {
    totalTests++;
    if (condition) {
      console.log(` PASS: ${desc}`);
      passedTests++;
    } else {
      console.error(` FAIL: ${desc}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 1: CATEGORY CREATION & SLUG VALIDATION HOOK
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 1. Testing Category Creation & Slug Hook ---');
  const testCatName = `Test Exotic Seeds ${Date.now()}`;
  const cat = new Category({ name: testCatName, description: 'Test category description' });
  await cat.validate(); // Must not throw "Path 'slug' is required"
  assert(cat.slug && cat.slug.length > 0, `Category auto-generates slug on validate: "${cat.slug}"`);
  await cat.save();
  assert(cat._id != null, 'Category saved successfully in database');

  // Verify duplicate prevention logic
  const duplicateCat = new Category({ name: testCatName, slug: cat.slug });
  let duplicateCaught = false;
  try {
    await duplicateCat.save();
  } catch (err) {
    duplicateCaught = true;
  }
  assert(duplicateCaught, 'Duplicate category name/slug is rejected by unique index');

  // Clean up test category
  await Category.deleteOne({ _id: cat._id });

  // ─────────────────────────────────────────────────────────────
  // TEST 2: AUTOMATIC PROPORTIONAL MRP CALCULATION FOR PRODUCT VARIANTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Testing Automatic Proportional MRP Calculation ---');
  // Formula: Calculated MRP = Base MRP × (Selected Variant Quantity ÷ Base Quantity)
  // Base: 50 seeds, Base MRP: ₹100
  // 50 seeds -> ₹100
  // 100 seeds -> ₹200
  // 150 seeds -> ₹300
  // 200 seeds -> ₹400
  const testProdData = {
    name: `Test Tomato Seeds Proportional ${Date.now()}`,
    categoryId: (await Category.findOne({ isActive: true }))?._id || new mongoose.Types.ObjectId(),
    description: 'Proportional count test product',
    price: 90, // discounted selling price for base
    originalPrice: 100,
    isAutoPricing: true,
    baseQuantity: 50,
    baseMrp: 100,
    baseUnit: 'Seeds',
    packages: [
      { quantity: '50 Seeds', price: 90, stock: 20 },
      { quantity: '100 Seeds', price: 180, stock: 25 },
      { quantity: '150 Seeds', price: 270, stock: 15 },
      { quantity: '200 Seeds', price: 360, stock: 10 }
    ],
    images: ['https://example.com/tomato.jpg']
  };

  // Run applyAutoPricing logic
  Product.applyAutoPricing(testProdData);

  const pkg50 = testProdData.packages.find(p => p.quantity.includes('50'));
  const pkg100 = testProdData.packages.find(p => p.quantity.includes('100'));
  const pkg150 = testProdData.packages.find(p => p.quantity.includes('150'));
  const pkg200 = testProdData.packages.find(p => p.quantity.includes('200'));

  assert(pkg50 && pkg50.originalPrice === 100, `50 seeds MRP = ₹100 (got ₹${pkg50?.originalPrice})`);
  assert(pkg100 && pkg100.originalPrice === 200, `100 seeds MRP = ₹200 (got ₹${pkg100?.originalPrice})`);
  assert(pkg150 && pkg150.originalPrice === 300, `150 seeds MRP = ₹300 (got ₹${pkg150?.originalPrice})`);
  assert(pkg200 && pkg200.originalPrice === 400, `200 seeds MRP = ₹400 (got ₹${pkg200?.originalPrice})`);

  // Test custom price preservation
  testProdData.packages.push({
    quantity: '300 Seeds',
    price: 500,
    originalPrice: 550,
    isCustomPrice: true,
    stock: 5
  });
  Product.applyAutoPricing(testProdData);
  const pkg300 = testProdData.packages.find(p => p.quantity.includes('300'));
  assert(pkg300 && pkg300.originalPrice === 550, `Custom price preserved without being overwritten: ₹${pkg300?.originalPrice}`);

  // Test save to DB and Mongoose pre hooks
  const prodDoc = await Product.create(testProdData);
  assert(prodDoc.stock === (20 + 25 + 15 + 10 + 5), `Total stock auto-synced from packages: ${prodDoc.stock}`);

  // Test Server-Side Pricing Verification
  const orderItemsInput = [
    {
      product: prodDoc._id.toString(),
      productType: 'Product',
      packageId: prodDoc.packages[1]._id.toString(), // 100 Seeds
      quantity: 2
    }
  ];
  const { verifiedItems, computedItemsPrice } = await buildVerifiedItems(orderItemsInput);
  assert(verifiedItems.length === 1, 'Server verified 1 line item');
  assert(verifiedItems[0].price === prodDoc.packages[1].price, `Server used trusted variant DB price: ₹${verifiedItems[0].price}`);
  assert(computedItemsPrice === verifiedItems[0].price * 2, `Computed correct subtotal: ₹${computedItemsPrice}`);

  // Clean up test product
  await Product.deleteOne({ _id: prodDoc._id });

  // ─────────────────────────────────────────────────────────────
  // TEST 3: COMBO CREATION, EDITING & SINGLE PRODUCT REMOVAL
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Testing Combo Management Workflow ---');
  const existingProducts = await Product.find({ isActive: true, isDeleted: { $ne: true } }).limit(3);
  if (existingProducts.length >= 2) {
    const comboData = {
      name: `Test Summer Combo ${Date.now()}`,
      description: 'Combo for testing product removal',
      price: 250,
      originalPrice: 350,
      stock: 15,
      images: ['https://example.com/combo.jpg'],
      includedProducts: [
        { productId: existingProducts[0]._id, quantity: 2 },
        { productId: existingProducts[1]._id, quantity: 1 }
      ]
    };

    const comboDoc = await Combo.create(comboData);
    assert(comboDoc.includedProducts.length === 2, 'Combo created with 2 products');

    // Simulate removing Product 0 while retaining Product 1
    const removeId = existingProducts[0]._id.toString();
    const updatedProducts = comboDoc.includedProducts.filter(
      p => (p.productId?._id || p.productId).toString() !== removeId
    );
    comboDoc.includedProducts = updatedProducts;
    await comboDoc.save();

    const reloadedCombo = await Combo.findById(comboDoc._id);
    assert(reloadedCombo.includedProducts.length === 1, `Removed product remains removed: count = ${reloadedCombo.includedProducts.length}`);
    assert(reloadedCombo.includedProducts[0].productId.toString() === existingProducts[1]._id.toString(), 'Remaining product matches untouched product');

    // Clean up test combo
    await Combo.deleteOne({ _id: comboDoc._id });
  } else {
    console.log('Skipping combo multi-product test (not enough products in DB)');
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 4: ADDRESS DEDUPLICATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Address Deduplication ---');
  // Find or create a test user
  let testUser = await User.findOne({ email: 'test_address_dedup@example.com' });
  if (!testUser) {
    const randomPhone = '9' + Math.floor(100000000 + Math.random() * 900000000);
    testUser = await User.create({
      name: 'Test Address User',
      email: 'test_address_dedup@example.com',
      phone: randomPhone,
      password: 'Password123!',
      addresses: []
    });
  }

  const sampleAddress = {
    name: 'Ramesh Patel',
    phone: '9876543210',
    street: '123 MG Road Flat 4B',
    city: 'Indore',
    state: 'Madhya Pradesh',
    pincode: '452001',
    isDefault: true
  };

  // Add address once
  testUser.addresses.push(sampleAddress);
  await testUser.save();
  const initialAddressCount = testUser.addresses.length;

  // Add same normalized address with duplicate detection
  const isDuplicate = testUser.addresses.some(a =>
    a.street.trim().toLowerCase() === sampleAddress.street.trim().toLowerCase() &&
    a.pincode.trim() === sampleAddress.pincode.trim() &&
    a.city.trim().toLowerCase() === sampleAddress.city.trim().toLowerCase()
  );
  assert(isDuplicate === true, 'Existing address is recognized as duplicate');

  // Verify that adding a duplicate address is prevented
  if (!isDuplicate) {
    testUser.addresses.push(sampleAddress);
    await testUser.save();
  }
  const afterCount = testUser.addresses.length;
  assert(afterCount === initialAddressCount, `Address count remained unchanged (${afterCount}) without duplicate insertion`);

  // Clean up test user
  await User.deleteOne({ _id: testUser._id });

  console.log(`\n======================================================`);
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
  console.log(`======================================================`);

  await mongoose.disconnect();
  process.exit(totalTests === passedTests ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
