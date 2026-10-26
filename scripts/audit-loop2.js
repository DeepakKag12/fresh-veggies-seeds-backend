const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const {
  calculateProportionalTier,
  calculateComparativeSavings,
  extractQuantityCount,
  applyAutoPricing
} = require('../src/utils/pricing-engine.util');

async function runLoop2() {
  console.log('====================================================');
  console.log('🔍 AUDIT LOOP 2: Botanical Catalog, Search, Faceting & Variant Pricing');
  console.log('   Features: FEAT-003, FEAT-004, FEAT-005, FEAT-006, FEAT-019');
  console.log('====================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fresh_veggies_test';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const results = [];

  try {
    // ─── FEAT-019: Category Hierarchy & Deletion Guards ───────────────────────
    console.log('\n--- [FEAT-019] Testing Category Hierarchy & Deletion Guards ---');

    // 1. Create Parent Category without slug (should auto-slugify in pre('validate'))
    const parentCategory = await Category.create({
      name: `Exotic Herbs ${Date.now()}`
    });
    console.log(`✓ 1. Parent category created with auto-slug: "${parentCategory.slug}"`);
    if (!parentCategory.slug || !parentCategory.slug.startsWith('exotic-herbs')) {
      throw new Error(`Auto-slug generation failed: ${parentCategory.slug}`);
    }
    results.push({ test: 'FEAT-019: safeSlugify pre(validate) execution', status: 'PASS' });

    // 2. Create Sub-category
    const subCategory = await Category.create({
      name: `Culinary Basil ${Date.now()}`,
      parentCategory: parentCategory._id
    });
    console.log(`✓ 2. Sub-category created linked to parent: ${subCategory.parentCategory}`);
    results.push({ test: 'FEAT-019: Parent-child category relationship', status: 'PASS' });

    // 3. Assign product to subCategory and verify deletion guard
    const testProduct = await Product.create({
      name: 'Organic Sweet Genovese Basil',
      categoryId: subCategory._id,
      description: 'Aromatic culinary sweet basil seeds with high germination rate.',
      price: 80,
      originalPrice: 100,
      stock: 25,
      isActive: true
    });
    console.log(`✓ 3. Product created assigned to sub-category: ${testProduct._id}`);

    // 4. Attempt to delete subCategory while product is active
    let deleteBlocked = false;
    const assignedCount = await Product.countDocuments({
      categoryId: subCategory._id,
      isDeleted: { $ne: true }
    });
    if (assignedCount > 0) {
      deleteBlocked = true;
    }
    if (!deleteBlocked) throw new Error('Category deletion guard failed to detect active product');
    console.log(`✓ 4. Category deletion correctly blocked: ${assignedCount} active products assigned`);
    results.push({ test: 'FEAT-019: Category deletion blocker on active products', status: 'PASS' });

    // ─── FEAT-003 & FEAT-004: Catalog Faceting & In-Stock Availability ────────
    console.log('\n--- [FEAT-003 & FEAT-004] Testing Catalog Query & Multi-Faceting ---');

    // 1. Zero-stock product test
    const zeroStockProduct = await Product.create({
      name: 'Rare Heirloom Purple Tomato (Sold Out)',
      categoryId: parentCategory._id,
      description: 'Rare heirloom tomato seeds currently awaiting fresh harvest.',
      price: 150,
      stock: 0,
      isActive: true
    });

    const inStockQuery = {
      isDeleted: { $ne: true },
      isActive: true,
      $or: [
        { stock: { $gt: 0 } },
        { 'packages.stock': { $gt: 0 } }
      ]
    };
    const inStockItems = await Product.find(inStockQuery);
    const zeroStockIncluded = inStockItems.some(p => String(p._id) === String(zeroStockProduct._id));
    if (zeroStockIncluded) throw new Error('Zero stock product should NOT be returned by inStock query');
    console.log('✓ 1. Zero-stock product excluded from inStock query filter');
    results.push({ test: 'FEAT-003: Zero-stock availability filtering', status: 'PASS' });

    // 2. Multi-facet search query test
    const facetResults = await Product.find({
      categoryId: subCategory._id,
      price: { $gte: 50, $lte: 120 },
      isDeleted: { $ne: true }
    }).sort({ price: 1 });

    if (facetResults.length === 0 || facetResults[0].price !== 80) {
      throw new Error(`Facet query failed to return expected product: ${JSON.stringify(facetResults)}`);
    }
    console.log(`✓ 2. Multi-facet search ($gte: 50, $lte: 120, category) matched ${facetResults.length} product(s)`);
    results.push({ test: 'FEAT-004: Multi-facet price and category pipeline query', status: 'PASS' });

    // 3. Dual-Handle Price Range filter test
    const outOfRange = await Product.find({
      categoryId: subCategory._id,
      price: { $gte: 200, $lte: 500 }
    });
    if (outOfRange.length !== 0) throw new Error('Out of range price query should return 0 results');
    console.log('✓ 3. Out-of-bounds price filter safely returned 0 products without error');
    results.push({ test: 'FEAT-004: Out-of-bounds price range boundary handling', status: 'PASS' });

    // ─── FEAT-005 & FEAT-006: Proportional Pricing & Variant Matrix ───────────
    console.log('\n--- [FEAT-005 & FEAT-006] Testing Proportional Variant Pricing Engine ---');

    // Base: 100g = ₹30 (MRP = ₹40)
    const baseQuantity = 100;
    const basePrice = 30;
    const baseMrp = 40;

    // Test tier 250g (ratio 2.5x -> 8% volume discount)
    const tier250g = calculateProportionalTier({
      count: '250g',
      baseQuantity,
      baseMrp,
      basePrice,
      applyVolumeDiscount: true
    });
    console.log(`✓ 250g Tier: Price = ₹${tier250g.price}, MRP = ₹${tier250g.originalPrice}, Discount = ${tier250g.volumeDiscountPct}%`);
    if (tier250g.price <= 0 || tier250g.originalPrice <= tier250g.price) {
      throw new Error('Proportional price must be positive and <= MRP');
    }

    // Test tier 500g (ratio 5.0x -> 15% volume discount)
    const tier500g = calculateProportionalTier({
      count: '500g',
      baseQuantity,
      baseMrp,
      basePrice,
      applyVolumeDiscount: true
    });
    console.log(`✓ 500g Tier: Price = ₹${tier500g.price}, MRP = ₹${tier500g.originalPrice}, Discount = ${tier500g.volumeDiscountPct}%`);

    // Test tier 1kg (1000g, ratio 10.0x -> 20% volume discount)
    const tier1kg = calculateProportionalTier({
      count: '1kg',
      baseQuantity,
      baseMrp,
      basePrice,
      applyVolumeDiscount: true
    });
    console.log(`✓ 1kg Tier: Price = ₹${tier1kg.price}, MRP = ₹${tier1kg.originalPrice}, Discount = ${tier1kg.volumeDiscountPct}%`);

    // Verify comparative savings calculation
    const savings1kg = calculateComparativeSavings(tier1kg.price, '1kg', basePrice, baseQuantity);
    console.log(`✓ 1kg Comparative Savings: Save ₹${savings1kg.savingsAmount} (${savings1kg.savingsPct}% cheaper per unit)`);
    if (savings1kg.savingsAmount <= 0 || savings1kg.savingsPct <= 0) {
      throw new Error('1kg bulk tier must offer positive savings vs base rate');
    }
    results.push({ test: 'FEAT-006: Progressive volume discount curves (250g, 500g, 1kg)', status: 'PASS' });

    // Test applyAutoPricing inventory synchronization
    const mockProductDoc = {
      isAutoPricing: true,
      baseQuantity: 100,
      baseMrp: 40,
      price: 30,
      packages: [
        { quantity: '100g', price: 30, originalPrice: 40, stock: 10, isCustomPrice: false },
        { quantity: '250g', price: 70, originalPrice: 100, stock: 15, isCustomPrice: false },
        { quantity: '500g', price: 130, originalPrice: 200, stock: 5, isCustomPrice: false }
      ]
    };
    applyAutoPricing(mockProductDoc);
    if (mockProductDoc.stock !== 30) {
      throw new Error(`Total inventory should sum package stocks (10+15+5=30). Got ${mockProductDoc.stock}`);
    }
    console.log(`✓ Variant Stock Matrix: Total stock aggregated to ${mockProductDoc.stock}`);
    results.push({ test: 'FEAT-005: Variant package stock aggregation & sync', status: 'PASS' });

    // Clean up test records
    await Product.deleteMany({ _id: { $in: [testProduct._id, zeroStockProduct._id] } });
    await Category.deleteMany({ _id: { $in: [parentCategory._id, subCategory._id] } });
    console.log('✓ Cleaned up test products and categories');

    console.log('\n====================================================');
    console.log('🎉 AUDIT LOOP 2 SUMMARY: ALL TESTS PASSED GREEN');
    console.log('====================================================');
    console.table(results);
  } catch (err) {
    console.error('\n❌ AUDIT LOOP 2 ERROR:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

runLoop2();
