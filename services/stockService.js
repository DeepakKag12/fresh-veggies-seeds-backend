/**
 * Stock Service
 * ─────────────────────────────────────────────────────────────
 * Handles stock decrement after an order is confirmed, and fires
 * a low-stock alert email to the admin when any product drops
 * below LOW_STOCK_THRESHOLD units.
 *
 * Idempotency: the Order.stockDecremented flag ensures this
 * runs at most once per order, even if both the webhook and
 * the verify-payment endpoint race to confirm the same order.
 */

const Product = require('../models/Product');
const Order   = require('../models/Order');
const emailService = require('./emailService');

const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD) || 10;

/**
 * Decrement stock for every Product line item in a confirmed order,
 * then send a low-stock alert email for items that fall below threshold.
 *
 * @param {import('mongoose').Document} order  — Mongoose Order document
 */
exports.decrementStockAfterConfirm = async (order) => {
  // ── Idempotency guard ──────────────────────────────────────────────────────
  if (order.stockDecremented) {
    console.log(`ℹ️  Stock already decremented for order ${order._id} — skipping`);
    return;
  }

  const lowStockItems = [];

  for (const item of order.orderItems) {
    // Combos don't have independent stock — only decrement Product items
    if (item.productType !== 'Product') continue;

    try {
      const updated = await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: -item.quantity } },
        { new: true, select: 'name stock' }
      );

      if (!updated) {
        console.error(`⚠️  Stock decrement: product ${item.product} not found`);
        continue;
      }

      // Clamp to 0 if somehow went negative (should not happen with stock checks)
      if (updated.stock < 0) {
        await Product.findByIdAndUpdate(item.product, { $set: { stock: 0 } });
        updated.stock = 0;
      }

      if (updated.stock < LOW_STOCK_THRESHOLD) {
        lowStockItems.push({ name: updated.name, stock: updated.stock });
        console.log(`⚠️  Low stock: "${updated.name}" → ${updated.stock} units remaining`);
      }
    } catch (err) {
      console.error(`⚠️  Stock decrement error for product ${item.product}:`, err.message);
    }
  }

  // ── Mark the flag so we never decrement twice ──────────────────────────────
  try {
    await Order.updateOne({ _id: order._id }, { $set: { stockDecremented: true } });
  } catch (err) {
    console.error('⚠️  Could not set stockDecremented flag:', err.message);
  }

  // ── Fire-and-forget low-stock alert email ──────────────────────────────────
  if (lowStockItems.length > 0) {
    emailService.sendLowStockAlertEmail(lowStockItems).catch((err) =>
      console.error('⚠️  Low-stock email error:', err.message)
    );
  }
};
