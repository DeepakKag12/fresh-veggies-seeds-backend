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
const Combo   = require('../models/Combo');
const emailService = require('./emailService');

const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD) || 10;

/**
 * Decrement stock for every Product line item in a confirmed order,
 * then send a low-stock alert email for items that fall below threshold.
 *
 * @param {import('mongoose').Document} order  — Mongoose Order document
 */

/**
 * Atomically reserve stock at the moment an order is placed.
 *
 * Validation alone was check-then-act: two customers could both read "1 left",
 * both pass the check, and both get an order — the loser only discovering the
 * problem when an admin confirmed it. Each reservation here is a single
 * conditional findOneAndUpdate, so the database itself decides the winner and
 * the second customer is told the item is sold out immediately.
 *
 * If any line cannot be satisfied, everything already taken in this call is put
 * back before throwing, so a partial failure never strands units.
 *
 * @param {Array} items verifiedItems from pricingService
 * @throws {Error} with a customer-facing "sold out" message
 */
exports.reserveStock = async (items) => {
  const taken = [];

  const rollback = async () => {
    for (const t of taken) {
      if (t.packageId) {
        await Product.updateOne(
          { _id: t.product, 'packages._id': t.packageId },
          { $inc: { 'packages.$.stock': t.quantity, stock: t.quantity } }
        ).catch((e) => console.error('⚠️  Reservation rollback failed:', e.message));
      } else if (t.productType === 'Combo') {
        await Combo.updateOne({ _id: t.product }, { $inc: { stock: t.quantity } })
          .catch((e) => console.error('⚠️  Reservation rollback failed:', e.message));
      } else {
        await Product.updateOne({ _id: t.product }, { $inc: { stock: t.quantity } })
          .catch((e) => console.error('⚠️  Reservation rollback failed:', e.message));
      }
    }
  };

  for (const item of items) {
    const qty = item.quantity;
    let claimed = null;

    if (item.packageId) {
      // Pack variants carry their own stock inside the packages subdocument.
      claimed = await Product.findOneAndUpdate(
        { _id: item.product, packages: { $elemMatch: { _id: item.packageId, stock: { $gte: qty } } } },
        { $inc: { 'packages.$.stock': -qty, stock: -qty } },
        { new: true, select: 'name' }
      );
    } else if (item.productType === 'Combo') {
      claimed = await Combo.findOneAndUpdate(
        { _id: item.product, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true, select: 'name' }
      );
    } else {
      claimed = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true, select: 'name' }
      );
    }

    if (!claimed) {
      await rollback();
      const err = new Error(`"${item.name}" is sold out or does not have ${qty} left.`);
      err.statusCode = 409;
      throw err;
    }

    taken.push({ product: item.product, quantity: qty, packageId: item.packageId, productType: item.productType });
  }

  return true;
};

exports.decrementStockAfterConfirm = async (order) => {
  if (order.stockDecremented) {
    console.log(`ℹ️  Stock already decremented for order ${order._id} — skipping`);
    return;
  }

  // ── Atomic idempotency claim ───────────────────────────────────────────────
  // verifyPayment and the Razorpay webhook can confirm the same order
  // concurrently. Reading the in-memory flag is not enough: both callers can
  // pass that check before either writes it. Claiming the flag up front means
  // exactly one of them proceeds to touch stock.
  const claim = await Order.updateOne(
    { _id: order._id, stockDecremented: { $ne: true } },
    { $set: { stockDecremented: true } }
  );
  if (claim.modifiedCount !== 1) {
    console.log(`ℹ️  Stock decrement for order ${order._id} already claimed — skipping`);
    return;
  }
  order.stockDecremented = true;

  const lowStockItems = [];
  const oversold      = [];

  for (const item of order.orderItems) {
    // Combos don't have independent stock — only decrement Product items
    if (item.productType !== 'Product') continue;

    try {
      // Conditional decrement: the filter requires enough stock to still be
      // there, so two orders racing for the last units cannot both succeed.
      // Checking stock at order time and decrementing here are separate steps,
      // and without this guard the gap between them lets inventory go negative.
      let updated;
      if (item.packageId) {
        updated = await Product.findOneAndUpdate(
          { _id: item.product, packages: { $elemMatch: { _id: item.packageId, stock: { $gte: item.quantity } } } },
          { $inc: { 'packages.$.stock': -item.quantity, stock: -item.quantity } },
          { new: true, select: 'name stock packages' }
        );
      } else {
        updated = await Product.findOneAndUpdate(
          { _id: item.product, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity } },
          { new: true, select: 'name stock' }
        );
      }

      if (!updated) {
        // Either the product is gone, or someone else took the units first.
        const exists = await Product.findById(item.product).select('name stock packages');
        if (!exists) {
          console.error(`⚠️  Stock decrement: product ${item.product} not found`);
          continue;
        }

        if (item.packageId) {
          const pkg = exists.packages?.id(item.packageId);
          if (!pkg) {
             console.error(`⚠️  Stock decrement: package ${item.packageId} not found in product ${item.product}`);
             continue;
          }
          console.error(
            `🚨 OVERSOLD: "${exists.name}" (Pack) — order ${order._id} needs ${item.quantity} but only ${pkg.stock} in stock. Stock set to 0; reconcile manually.`
          );
          oversold.push({ name: `${exists.name} (Pack)`, required: item.quantity, available: pkg.stock });
          updated = await Product.findOneAndUpdate(
            { _id: item.product, 'packages._id': item.packageId },
            { $set: { 'packages.$.stock': 0 } },
            { new: true, select: 'name stock packages' }
          );
        } else {
          // Oversold. Take the stock to zero and flag it loudly rather than
          // silently clamping — this needs a human to reconcile the order.
          console.error(
            `🚨 OVERSOLD: "${exists.name}" — order ${order._id} needs ${item.quantity} but only ${exists.stock} in stock. Stock set to 0; reconcile manually.`
          );
          oversold.push({ name: exists.name, required: item.quantity, available: exists.stock });
          updated = await Product.findByIdAndUpdate(
            item.product,
            { $set: { stock: 0 } },
            { new: true, select: 'name stock' }
          );
        }
      }

      if (updated.stock < LOW_STOCK_THRESHOLD) {
        lowStockItems.push({ name: updated.name, stock: updated.stock });
        console.log(`⚠️  Low stock: "${updated.name}" → ${updated.stock} units remaining`);
      }
    } catch (err) {
      console.error(`⚠️  Stock decrement error for product ${item.product}:`, err.message);
    }
  }

  // ── Record any oversell on the order so it is actionable ───────────────────
  // A log line alone gets lost. Persisting it lets the admin order view flag
  // the order as needing manual reconciliation.
  if (oversold.length > 0) {
    try {
      await Order.updateOne(
        { _id: order._id },
        { $set: { stockIssues: oversold.map((o) => ({ ...o, at: new Date() })) } }
      );
    } catch (err) {
      console.error('⚠️  Could not record stock issues:', err.message);
    }
  }

  // ── Fire-and-forget low-stock alert email ──────────────────────────────────
  if (lowStockItems.length > 0) {
    emailService.sendLowStockAlertEmail(lowStockItems).catch((err) =>
      console.error('⚠️  Low-stock email error:', err.message)
    );
  }
};


/**
 * Return stock to inventory when a committed order is cancelled or refunded.
 *
 * The mirror of decrementStockAfterConfirm. Without this, every cancellation
 * permanently lost the units: they were taken out of stock on confirmation and
 * never given back, so inventory drifted below reality until someone noticed.
 *
 * Guarded by order.stockRestored, and only ever runs for an order whose stock
 * was actually taken (stockDecremented), so a cancel → refund-webhook sequence
 * cannot credit the same units twice.
 *
 * @param {import('mongoose').Document} order
 */
exports.restoreStockAfterCancel = async (order) => {
  if (!order.stockDecremented) {
    // Stock was never taken for this order (cancelled before confirmation).
    return;
  }
  if (order.stockRestored) {
    console.log(`ℹ️  Stock already restored for order ${order._id} — skipping`);
    return;
  }

  // Claim the restore atomically, so two concurrent cancel/refund events cannot
  // both pass the guard above and each add the units back.
  const claim = await Order.updateOne(
    { _id: order._id, stockDecremented: true, stockRestored: { $ne: true } },
    { $set: { stockRestored: true } }
  );
  if (claim.modifiedCount !== 1) {
    console.log(`ℹ️  Stock restore for order ${order._id} already claimed — skipping`);
    return;
  }

  for (const item of order.orderItems) {
    // Combos have no independent stock, matching the decrement side.
    if (item.productType !== 'Product') continue;

    try {
      let updated;
      if (item.packageId) {
        updated = await Product.findOneAndUpdate(
          { _id: item.product, 'packages._id': item.packageId },
          { $inc: { 'packages.$.stock': item.quantity, stock: item.quantity } },
          { new: true, select: 'name stock' }
        );
      } else {
        updated = await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } },
          { new: true, select: 'name stock' }
        );
      }
      if (!updated) {
        console.error(`⚠️  Stock restore: product ${item.product} no longer exists`);
        continue;
      }
      console.log(`↩ Restored ${item.quantity} unit(s) of "${updated.name}" → ${updated.stock} in stock`);
    } catch (err) {
      console.error(`⚠️  Stock restore error for product ${item.product}:`, err.message);
    }
  }

  order.stockRestored = true;
};
