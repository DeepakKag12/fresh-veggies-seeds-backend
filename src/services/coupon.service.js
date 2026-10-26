/**
 * Coupon Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns every rule about whether a coupon may be used and what it is worth.
 *
 * The critical rule: **the discount is always computed here from the coupon
 * code, never accepted from the client.** Previously both order endpoints took
 * `discountAmount` straight off the request body and merely capped it at the
 * items price, so a crafted request could claim a full-value discount and pay
 * only the delivery fee. Callers now pass a code; this module decides the money.
 *
 * Redemption is two-phase so that a coupon is never burned by an order that
 * never gets paid for:
 *
 *   validateCoupon()  — read-only check + discount calculation (checkout preview)
 *   redeemCoupon()    — atomically claims one use, enforcing usageLimit
 *   releaseCoupon()   — hands that use back if the order fails or is cancelled
 */

const Coupon = require('../models/coupon.model');
const Order  = require('../models/order.model');

/**
 * Work out what a coupon is worth against a basket, and whether this user may
 * use it at all. Performs no writes.
 *
 * @param {string} code       - raw coupon code from the client
 * @param {number} itemsPrice - server-computed items subtotal
 * @param {ObjectId} userId
 * @returns {Promise<{valid: boolean, message?: string, coupon?: object, discountAmount?: number}>}
 */
exports.validateCoupon = async (code, itemsPrice, userId) => {
  if (!code || typeof code !== 'string') {
    return { valid: false, message: 'Coupon code is required.' };
  }

  const normalized = code.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code: normalized, isActive: true, isDeleted: { $ne: true } });

  if (!coupon) {
    return { valid: false, message: 'Invalid coupon code.' };
  }

  const now = new Date();
  if (now < coupon.startDate) {
    return { valid: false, message: 'This coupon is not active yet.' };
  }
  if (now > coupon.expiryDate) {
    return { valid: false, message: 'This coupon has expired.' };
  }

  const minAmount = coupon.minOrderAmount ?? coupon.minOrderValue ?? 0;
  if (itemsPrice < minAmount) {
    return {
      valid: false,
      message: `Coupon valid on orders above ₹${minAmount} only (Add ₹${minAmount - itemsPrice} more).`
    };
  }

  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, message: 'This coupon has reached its usage limit.' };
  }

  // Per-user limit. Only orders that actually stand count against the user:
  // a cancelled or payment-failed order must not consume someone's allowance.
  if (userId) {
    const userOrderCount = await Order.countDocuments({
      userId,
      'couponUsed.code': normalized,
      orderStatus:   { $ne: 'Cancelled' },
      paymentStatus: { $ne: 'Failed' }
    });
    const userUsedByCount = Array.isArray(coupon.usedBy)
      ? coupon.usedBy.filter(u => String(u.user) === String(userId)).length
      : 0;
    const userUsageCount = Math.max(userOrderCount, userUsedByCount);

    const limit = coupon.perUserLimit || 1;
    if (userUsageCount >= limit) {
      return { valid: false, message: 'You have already used this coupon.' };
    }
  }

  // ── Discount calculation ───────────────────────────────────────────────────
  let discountAmount;
  const isPercentage = coupon.discountType === 'percentage' || coupon.discountType === 'PERCENTAGE';
  if (isPercentage) {
    discountAmount = (itemsPrice * coupon.discountValue) / 100;
    const maxDiscount = coupon.maxDiscountAmount ?? coupon.maxDiscount;
    if (maxDiscount) {
      discountAmount = Math.min(discountAmount, maxDiscount);
    }
  } else {
    discountAmount = coupon.discountValue;
  }

  // A discount can never exceed the basket, and never turn an order negative.
  discountAmount = Math.max(0, Math.min(Math.round(discountAmount), itemsPrice));

  return { valid: true, coupon, discountAmount };
};

/**
 * Atomically claim one use of a coupon and track in usedBy.
 *
 * @returns {Promise<boolean>} true if a use was claimed
 */
exports.redeemCoupon = async (couponId, userId = null, orderId = null, discountAmount = 0) => {
  const coupon = await Coupon.findById(couponId).select('usageLimit');
  if (!coupon) return false;

  // No limit configured — just count the redemption.
  const filter = coupon.usageLimit
    ? { _id: couponId, usedCount: { $lt: coupon.usageLimit } }
    : { _id: couponId };

  const update = { $inc: { usedCount: 1 } };
  if (userId) {
    update.$push = {
      usedBy: {
        user: userId,
        orderId: orderId || null,
        usedAt: new Date(),
        discountAmount: discountAmount || 0,
      }
    };
  }

  const result = await Coupon.updateOne(filter, update);
  return result.modifiedCount === 1;
};

/**
 * Give back a previously claimed use, when the order it belonged to is
 * cancelled or its payment never completed. Floors at zero so a double release
 * can never drive the counter negative.
 */
exports.releaseCoupon = async (couponId, userId = null, orderId = null) => {
  if (!couponId) return;
  try {
    const update = { $inc: { usedCount: -1 } };
    if (userId || orderId) {
      update.$pull = {
        usedBy: orderId ? { orderId } : { user: userId }
      };
    }
    await Coupon.updateOne(
      { _id: couponId, usedCount: { $gt: 0 } },
      update
    );
  } catch (err) {
    console.error('⚠️  Coupon release error:', err.message);
  }
};

/**
 * Resolve a coupon code into the persisted `couponUsed` sub-document plus the
 * discount, claiming one use in the process. Used by both order-creation paths.
 *
 * Returns { discountAmount: 0, couponUsed: null } when no code was supplied, so
 * callers can use it unconditionally.
 *
 * @throws {Error} with a customer-safe message when the coupon is not usable
 */
exports.applyCouponToOrder = async (code, itemsPrice, userId, orderId = null) => {
  if (!code) return { discountAmount: 0, couponUsed: null };

  const result = await exports.validateCoupon(code, itemsPrice, userId);
  if (!result.valid) {
    const err = new Error(result.message);
    err.isCouponError = true;
    throw err;
  }

  const claimed = await exports.redeemCoupon(result.coupon._id, userId, orderId, result.discountAmount);
  if (!claimed) {
    const err = new Error('This coupon has just reached its usage limit.');
    err.isCouponError = true;
    throw err;
  }

  return {
    discountAmount: result.discountAmount,
    couponUsed: {
      couponId:       result.coupon._id,
      code:           result.coupon.code,
      discountAmount: result.discountAmount
    }
  };
};
