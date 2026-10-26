/**
 * Automatic Proportional Variant Pricing Engine (FEAT-006)
 * Target Real-World Benchmark: Costco / BulkSupplements (Volume & Tiered Pricing)
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsibilities:
 * 1. Proportional MRP & Selling Price derivation from a single base unit configuration.
 * 2. Progressive volume discount curves (economies of scale rewards for larger sizes).
 * 3. Comparative unit-cost calculations (e.g. ₹24/100g vs ₹19/100g).
 * 4. Comparative volume savings relative to base unit rate (e.g. "Save 18% vs 100g pack").
 * 5. Pre-validation and database integrity verification hooks for Mongoose.
 */

/**
 * Extracts numeric quantity count from string or number.
 * e.g. "250g" -> 250, "1kg" -> 1000, "50 Seeds" -> 50, 100 -> 100
 */
function extractQuantityCount(quantityStr) {
  if (typeof quantityStr === 'number') return quantityStr;
  if (!quantityStr) return 0;
  const str = String(quantityStr).trim();

  // Handle kg conversion to grams
  const kgMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo|kilograms?)/i);
  if (kgMatch) {
    return parseFloat(kgMatch[1]) * 1000;
  }

  // Handle grams or seed counts
  const match = str.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Calculates progressive volume discount percentage based on count ratio relative to base.
 * @param {number} ratio - Tier Count ÷ Base Quantity
 * @returns {number} volume discount rate (0.0 to 0.25)
 */
function getVolumeDiscountRate(ratio) {
  if (ratio >= 10) return 0.20; // 20% volume discount on 10x bulk tier (e.g. 1kg vs 100g)
  if (ratio >= 5)  return 0.15; // 15% volume discount on 5x tier (e.g. 500g vs 100g)
  if (ratio >= 2)  return 0.08; // 8% volume discount on 2x-4x tier (e.g. 250g vs 100g)
  return 0.0;                   // 0% discount on base tier
}

/**
 * Computes proportional MRP and Selling Price for a variant tier with volume curve.
 * @param {Object} params
 * @param {number|string} params.count - Target variant count / quantity
 * @param {number} params.baseQuantity - Base unit quantity (e.g. 100 or 50)
 * @param {number} params.baseMrp - Base MRP
 * @param {number} params.basePrice - Base selling price
 * @param {boolean} [params.applyVolumeDiscount=true] - Whether to apply progressive volume discount
 * @returns {{ count: number, originalPrice: number, price: number, ratio: number, volumeDiscountPct: number }}
 */
function calculateProportionalTier({
  count,
  baseQuantity,
  baseMrp,
  basePrice,
  applyVolumeDiscount = true
}) {
  const numericCount = extractQuantityCount(count);
  const baseQty = Number(baseQuantity) > 0 ? Number(baseQuantity) : 1;
  const bMrp = Number(baseMrp) > 0 ? Number(baseMrp) : (Number(basePrice) || 100);
  const bPrice = Number(basePrice) > 0 ? Number(basePrice) : Math.round(bMrp * 0.75);

  if (numericCount <= 0) {
    return { count: 0, originalPrice: bMrp, price: bPrice, ratio: 1, volumeDiscountPct: 0 };
  }

  const ratio = numericCount / baseQty;

  // Proportional MRP formula: Base MRP × (Tier Count ÷ Base Quantity)
  const proportionalMrp = Math.round((bMrp * numericCount) / baseQty);

  // Base proportional selling price before volume curve
  let sellingPrice = Math.round((bPrice * numericCount) / baseQty);

  let volumeDiscountPct = 0;
  if (applyVolumeDiscount && ratio > 1) {
    const discountRate = getVolumeDiscountRate(ratio);
    volumeDiscountPct = Math.round(discountRate * 100);
    sellingPrice = Math.round(sellingPrice * (1 - discountRate));
  }

  // Inversion guard: Price must never exceed MRP
  sellingPrice = Math.min(sellingPrice, proportionalMrp);

  return {
    count: numericCount,
    originalPrice: proportionalMrp,
    price: Math.max(0, sellingPrice),
    ratio: Math.round(ratio * 100) / 100,
    volumeDiscountPct
  };
}

/**
 * Computes comparative volume savings relative to buying multiples of the base unit.
 * Benchmark: Costco / BulkSupplements "Save ₹X (Y% cheaper per unit)"
 * @param {number} tierPrice - Price of the bulk tier
 * @param {number} tierCount - Quantity of the bulk tier
 * @param {number} basePrice - Price of the base tier
 * @param {number} baseQuantity - Quantity of the base tier
 */
function calculateComparativeSavings(tierPrice, tierCount, basePrice, baseQuantity) {
  const tCount = extractQuantityCount(tierCount);
  const bCount = extractQuantityCount(baseQuantity);
  if (tCount <= 0 || bCount <= 0 || !basePrice || !tierPrice) {
    return { savingsAmount: 0, savingsPct: 0, unitSavingsText: '' };
  }

  const baseUnitRate = basePrice / bCount;
  const baseEquivalentCost = Math.round(baseUnitRate * tCount);
  const savingsAmount = Math.max(0, baseEquivalentCost - tierPrice);
  const savingsPct = baseEquivalentCost > 0 ? Math.round((savingsAmount / baseEquivalentCost) * 100) : 0;

  return {
    savingsAmount,
    savingsPct,
    baseEquivalentCost,
    unitSavingsText: savingsPct > 0 ? `Save ₹${savingsAmount} (${savingsPct}% cheaper vs ${baseQuantity} base)` : ''
  };
}

/**
 * Pre-validate and sync product variant packages & total inventory.
 * Used in Mongoose pre('validate') and pre('save') hooks.
 * @param {Object} productDoc - Mongoose Product document or POJO
 */
function applyAutoPricing(productDoc) {
  if (!productDoc) return;
  const packages = productDoc.packages;
  if (!Array.isArray(packages) || packages.length === 0) return;

  // 1. Inventory Synchronization: sum packages stock
  productDoc.stock = packages.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);

  // 2. Division-by-zero protection: normalize baseQuantity
  if (!productDoc.baseQuantity || Number(productDoc.baseQuantity) <= 0) {
    productDoc.baseQuantity = 1;
  }

  // 3. Automated proportional pricing recalculation
  if (productDoc.isAutoPricing && Number(productDoc.baseMrp) > 0) {
    const baseQty = Number(productDoc.baseQuantity);
    const baseMrp = Number(productDoc.baseMrp);
    const basePrice = Number(productDoc.price) || Math.round(baseMrp * 0.75);

    packages.forEach((pkg) => {
      // Respect manual custom price overrides
      if (!pkg.isCustomPrice) {
        const count = extractQuantityCount(pkg.quantity);
        if (count > 0) {
          const tier = calculateProportionalTier({
            count,
            baseQuantity: baseQty,
            baseMrp,
            basePrice,
            applyVolumeDiscount: true
          });

          pkg.originalPrice = tier.originalPrice;
          pkg.price = tier.price;
        }
      }

      // Inversion guard on each package: selling price <= MRP
      if (pkg.originalPrice && pkg.price > pkg.originalPrice) {
        pkg.originalPrice = pkg.price;
      }
    });

    // 4. Align top-level product price/originalPrice with base package if found
    const basePkg = packages.find((p) => extractQuantityCount(p.quantity) === baseQty);
    if (basePkg) {
      productDoc.originalPrice = basePkg.originalPrice;
      productDoc.price = basePkg.price;
    }
  }
}

/**
 * Generates standard volume tiers based on category type (Costco/BulkSupplements Presets).
 * @param {Object} options
 * @param {number} options.baseQuantity - Base count (e.g. 100 for grams, 50 for seeds)
 * @param {number} options.baseMrp - Base MRP
 * @param {number} options.basePrice - Base price
 * @param {'weight'|'seeds'} [options.type='weight'] - Category type
 * @returns {Array<Object>} Array of package objects ready for product.packages
 */
function generateStandardTiers({ baseQuantity, baseMrp, basePrice, type = 'weight' }) {
  const isWeight = type === 'weight';
  const tierConfigs = isWeight
    ? [
        { label: '100g', count: 100 },
        { label: '250g', count: 250 },
        { label: '500g', count: 500 },
        { label: '1kg',  count: 1000 },
      ]
    : [
        { label: '50 Seeds',  count: 50 },
        { label: '100 Seeds', count: 100 },
        { label: '250 Seeds', count: 250 },
        { label: '500 Seeds', count: 500 },
      ];

  const baseQty = Number(baseQuantity) || (isWeight ? 100 : 50);
  const bMrp = Number(baseMrp) || 100;
  const bPrice = Number(basePrice) || Math.round(bMrp * 0.75);

  return tierConfigs.map((cfg) => {
    const tier = calculateProportionalTier({
      count: cfg.count,
      baseQuantity: baseQty,
      baseMrp: bMrp,
      basePrice: bPrice,
      applyVolumeDiscount: true
    });

    return {
      quantity: cfg.label,
      price: tier.price,
      originalPrice: tier.originalPrice,
      stock: 50,
      isCustomPrice: false
    };
  });
}

module.exports = {
  extractQuantityCount,
  getVolumeDiscountRate,
  calculateProportionalTier,
  calculateComparativeSavings,
  applyAutoPricing,
  generateStandardTiers
};
