const test = require('node:test');
const assert = require('node:assert');
const {
  extractQuantityCount,
  getVolumeDiscountRate,
  calculateProportionalTier,
  calculateComparativeSavings,
  generateStandardTiers
} = require('../../src/utils/pricing-engine.util');

test('Pricing Engine - extractQuantityCount', async (t) => {
  await t.test('extracts grams from strings', () => {
    assert.strictEqual(extractQuantityCount('250g'), 250);
    assert.strictEqual(extractQuantityCount(' 500 grams '), 500);
  });

  await t.test('extracts kg and converts to grams', () => {
    assert.strictEqual(extractQuantityCount('1kg'), 1000);
    assert.strictEqual(extractQuantityCount('2.5 kg'), 2500);
    assert.strictEqual(extractQuantityCount('0.5 kilograms'), 500);
  });

  await t.test('extracts seed counts', () => {
    assert.strictEqual(extractQuantityCount('50 Seeds'), 50);
    assert.strictEqual(extractQuantityCount('100 SEEDS'), 100);
  });

  await t.test('handles numbers directly', () => {
    assert.strictEqual(extractQuantityCount(150), 150);
  });

  await t.test('handles null, undefined and invalid values gracefully', () => {
    assert.strictEqual(extractQuantityCount(null), 0);
    assert.strictEqual(extractQuantityCount(undefined), 0);
    assert.strictEqual(extractQuantityCount(''), 0);
    assert.strictEqual(extractQuantityCount('Pack'), 0);
  });
});

test('Pricing Engine - getVolumeDiscountRate', async (t) => {
  await t.test('returns correct volume curve tiers', () => {
    assert.strictEqual(getVolumeDiscountRate(1), 0.0);
    assert.strictEqual(getVolumeDiscountRate(1.5), 0.0);
    assert.strictEqual(getVolumeDiscountRate(2), 0.08); // 8%
    assert.strictEqual(getVolumeDiscountRate(4), 0.08); // 8%
    assert.strictEqual(getVolumeDiscountRate(5), 0.15); // 15%
    assert.strictEqual(getVolumeDiscountRate(8), 0.15); // 15%
    assert.strictEqual(getVolumeDiscountRate(10), 0.20); // 20%
    assert.strictEqual(getVolumeDiscountRate(15), 0.20); // 20%
  });
});

test('Pricing Engine - calculateProportionalTier', async (t) => {
  await t.test('calculates base tier with zero discount', () => {
    const tier = calculateProportionalTier({
      count: '100g',
      baseQuantity: 100,
      baseMrp: 50,
      basePrice: 40,
      applyVolumeDiscount: true
    });
    assert.strictEqual(tier.count, 100);
    assert.strictEqual(tier.originalPrice, 50);
    assert.strictEqual(tier.price, 40);
    assert.strictEqual(tier.ratio, 1);
    assert.strictEqual(tier.volumeDiscountPct, 0);
  });

  await t.test('calculates 5x tier with 15% volume discount applied', () => {
    // 500g vs 100g base (baseMrp 50, basePrice 40)
    // Proportional MRP: 50 * 5 = 250
    // Proportional Base Price: 40 * 5 = 200
    // 15% volume discount: 200 * 0.85 = 170
    const tier = calculateProportionalTier({
      count: '500g',
      baseQuantity: 100,
      baseMrp: 50,
      basePrice: 40,
      applyVolumeDiscount: true
    });
    assert.strictEqual(tier.count, 500);
    assert.strictEqual(tier.originalPrice, 250);
    assert.strictEqual(tier.price, 170);
    assert.strictEqual(tier.volumeDiscountPct, 15);
  });

  await t.test('enforces inversion guard: selling price never exceeds MRP', () => {
    const tier = calculateProportionalTier({
      count: '100g',
      baseQuantity: 100,
      baseMrp: 50,
      basePrice: 80, // Price higher than MRP
      applyVolumeDiscount: false
    });
    assert.ok(tier.price <= tier.originalPrice, 'Price must not exceed MRP');
    assert.strictEqual(tier.price, 50);
  });

  await t.test('handles invalid inputs without crashing', () => {
    const tier = calculateProportionalTier({
      count: 'invalid',
      baseQuantity: 0,
      baseMrp: 0,
      basePrice: 0
    });
    assert.strictEqual(tier.count, 0);
    assert.ok(tier.price >= 0);
  });
});

test('Pricing Engine - calculateComparativeSavings & generateStandardTiers', async (t) => {
  await t.test('calculates comparative savings vs base unit', () => {
    // tierPrice: 170, tierCount: '500g', basePrice: 40, baseQuantity: '100g'
    const savings = calculateComparativeSavings(170, '500g', 40, '100g');
    // Buying 5x 100g @ ₹40 = ₹200. Tier is ₹170.
    // Savings = ₹30 (15%)
    assert.strictEqual(savings.savingsAmount, 30);
    assert.strictEqual(savings.savingsPct, 15);
    assert.ok(savings.unitSavingsText.includes('Save ₹30'));
  });

  await t.test('generates standard weight tiers automatically', () => {
    const tiers = generateStandardTiers({
      baseQuantity: 100,
      baseMrp: 50,
      basePrice: 40,
      type: 'weight'
    });
    assert.strictEqual(tiers.length, 4);
    assert.strictEqual(tiers[0].quantity, '100g');
    assert.strictEqual(tiers[1].quantity, '250g');
    assert.strictEqual(tiers[2].quantity, '500g');
    assert.strictEqual(tiers[3].quantity, '1kg');
    // Inversion check on all tiers
    tiers.forEach((t) => {
      assert.ok(t.price <= t.originalPrice, `${t.quantity} price must not exceed MRP`);
    });
  });
});
