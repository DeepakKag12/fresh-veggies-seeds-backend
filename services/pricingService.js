/**
 * Pricing Service — the single authority on what an order costs.
 * ─────────────────────────────────────────────────────────────────────────────
 * This logic previously existed as two near-identical copies of
 * `buildVerifiedItems`, one in orderController (COD) and one in
 * paymentController (online). They had already drifted apart in their error
 * messages and in the order of their stock checks — on the code path that
 * decides how much money to take from a customer.
 *
 * Consolidating also closed two gaps that were present in *both* copies:
 *
 *   1. A product that has package variants but is ordered without a packageId
 *      fell through every stock check — the top-level check was skipped because
 *      packages existed, and the package check was skipped because no packageId
 *      was supplied. Such an item could be ordered in unlimited quantity.
 *   2. Combo stock was never checked at all, despite Combo carrying a stock
 *      field, so combos could be oversold without limit.
 *
 * Prices are ALWAYS read from the database. Whatever price the client sends is
 * ignored, so a tampered cart cannot change what is charged.
 */

const Product = require('../models/Product');
const Combo   = require('../models/Combo');

/**
 * Resolve a cart into server-verified line items and a subtotal.
 *
 * @param {Array} orderItems - raw items from the request
 * @returns {Promise<{verifiedItems: Array, computedItemsPrice: number}>}
 * @throws {Error} with a customer-safe message when an item is unavailable
 */
async function buildVerifiedItems(orderItems) {
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    throw new Error('No order items provided');
  }

  const verifiedItems = [];
  let computedItemsPrice = 0;

  for (const item of orderItems) {
    if (!item.product || !item.productType || !item.quantity || item.quantity < 1) {
      throw new Error('Invalid order item structure');
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Item quantity must be a whole number of at least 1');
    }

    let dbPrice, dbName, dbImage;

    if (item.productType === 'Product') {
      const product = await Product.findById(item.product)
        .select('price name images isActive stock packages');

      if (!product || !product.isActive) {
        throw new Error('One of the items in your cart is no longer available');
      }

      const hasPackages = Array.isArray(product.packages) && product.packages.length > 0;

      if (item.packageId) {
        const pkg = product.packages.id(item.packageId);
        if (!pkg) throw new Error(`Selected pack is no longer available for "${product.name}"`);
        if (pkg.stock < quantity) {
          throw new Error(pkg.stock === 0
            ? `"${product.name}" is sold out in that pack size.`
            : `Only ${pkg.stock} left of "${product.name}" in that pack size.`);
        }
        dbPrice = pkg.price;
      } else if (hasPackages) {
        // Gap #1: previously unchecked. A product sold by pack size must be
        // ordered against a specific pack, otherwise there is no stock figure
        // to validate against and no defined price.
        throw new Error(`Please choose a pack size for "${product.name}"`);
      } else {
        if (product.stock < quantity) {
          throw new Error(product.stock === 0
            ? `"${product.name}" is sold out.`
            : `Only ${product.stock} left of "${product.name}".`);
        }
        dbPrice = product.price;
      }

      dbName  = product.name;
      dbImage = product.images?.[0] || '';

    } else if (item.productType === 'Combo') {
      const combo = await Combo.findById(item.product).select('price name images isActive stock');

      if (!combo || !combo.isActive) {
        throw new Error('One of the combos in your cart is no longer available');
      }

      // Gap #2: combo stock was never validated on either order path.
      if (typeof combo.stock === 'number' && combo.stock < quantity) {
        throw new Error(`Only ${combo.stock} left of "${combo.name}"`);
      }

      dbPrice = combo.price;
      dbName  = combo.name;
      dbImage = combo.images?.[0] || '';

    } else {
      throw new Error(`Unknown productType: ${item.productType}`);
    }

    if (typeof dbPrice !== 'number' || !Number.isFinite(dbPrice) || dbPrice < 0) {
      throw new Error(`"${dbName}" is not correctly priced. Please contact support.`);
    }

    verifiedItems.push({
      product:     item.product,
      productType: item.productType,
      name:        dbName,
      quantity,
      price:       dbPrice, // always server-sourced, never the client's figure
      image:       dbImage,
      ...(item.packageId ? { packageId: item.packageId } : {})
    });

    computedItemsPrice += dbPrice * quantity;
  }

  // Guard against float drift accumulating across line items.
  computedItemsPrice = Math.round(computedItemsPrice * 100) / 100;

  return { verifiedItems, computedItemsPrice };
}

module.exports = { buildVerifiedItems };
