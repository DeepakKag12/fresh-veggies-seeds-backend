/**
 * Order domain rules — single source of truth
 * ─────────────────────────────────────────────────────────────────────────────
 * Pricing constants and the order state machine previously lived duplicated in
 * both orderController.js and paymentController.js. Two copies of a business
 * rule drift: change the free-delivery threshold in one place and COD orders
 * price differently from online ones. Everything that decides money or status
 * now reads from here.
 */

// ─── Delivery pricing ────────────────────────────────────────────────────────
const Settings = require('../models/Settings');
const DEFAULT_FREE_DELIVERY_THRESHOLD = 300; // ₹ — order value at or above which delivery is free
const DEFAULT_DELIVERY_CHARGE         = 50;  // ₹ — flat fee below the threshold

/**
 * Delivery fee for a given basket value.
 * @param {number} itemsPrice - server-computed items subtotal, before discount
 * @param {number} [customThreshold] - optional override from dynamic settings
 * @param {number} [customCharge] - optional override from dynamic settings
 */
const computeShippingPrice = (itemsPrice, customThreshold, customCharge) => {
  const threshold = typeof customThreshold === 'number' ? customThreshold : DEFAULT_FREE_DELIVERY_THRESHOLD;
  const charge = typeof customCharge === 'number' ? customCharge : DEFAULT_DELIVERY_CHARGE;
  return itemsPrice >= threshold ? 0 : charge;
};

const computeOnlineDiscount = (itemsPrice, discountType = 'percentage', discountValue = 0, maxLimit = 100) => {
  if (!discountValue || discountValue <= 0 || !itemsPrice || itemsPrice <= 0) return 0;
  let discount = 0;
  if (discountType === 'percentage') {
    discount = Math.round((itemsPrice * discountValue) / 100);
    if (maxLimit && maxLimit > 0) {
      discount = Math.min(discount, maxLimit);
    }
  } else {
    discount = discountValue;
  }
  return Math.max(0, Math.min(discount, itemsPrice));
};

const getShippingRules = async () => {
  try {
    const settings = await Settings.getSingleton();
    return {
      freeDeliveryThreshold: settings.delivery.freeDeliveryThreshold ?? DEFAULT_FREE_DELIVERY_THRESHOLD,
      deliveryCharge: settings.delivery.deliveryCharge ?? DEFAULT_DELIVERY_CHARGE,
      minOrderAmount: settings.delivery.minOrderAmount ?? 100,
      codAvailable: (settings.delivery?.codAvailable ?? true) && (settings.payments?.codEnabled ?? true),
      codMinOrder: settings.payments?.codMinOrder ?? settings.delivery?.minOrderAmount ?? 100,
      codMaxOrder: settings.delivery?.codMaxOrder ?? settings.payments?.codMaxOrder ?? 5000,
      codExtraCharge: settings.payments?.codExtraCharge ?? 0,
      onlineDiscountType: settings.payments?.onlineDiscountType || 'percentage',
      onlineDiscountValue: settings.payments?.onlineDiscountValue ?? 0,
      onlineDiscountMaxLimit: settings.payments?.onlineDiscountMaxLimit ?? 100,
    };
  } catch {
    return {
      freeDeliveryThreshold: DEFAULT_FREE_DELIVERY_THRESHOLD,
      deliveryCharge: DEFAULT_DELIVERY_CHARGE,
      minOrderAmount: 100,
      codAvailable: true,
      codMinOrder: 100,
      codMaxOrder: 5000,
      codExtraCharge: 0,
      onlineDiscountType: 'percentage',
      onlineDiscountValue: 0,
      onlineDiscountMaxLimit: 100,
    };
  }
};

const ALL_ORDER_STATUSES = [
  'Pending',
  'Confirmed',
  'Packed',
  'Shipped',
  'Delivered',
  'Cancelled',
  'CancellationRequested',
];

// Standard workflow suggestions for UI shortcuts
const ALLOWED_TRANSITIONS = {
  Pending:               ['Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'],
  Confirmed:             ['Pending', 'Packed', 'Shipped', 'Delivered', 'Cancelled'],
  Packed:                ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'],
  Shipped:               ['Pending', 'Confirmed', 'Packed', 'Delivered', 'Cancelled'],
  Delivered:             ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Cancelled'],
  Cancelled:             ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered'],
  CancellationRequested: ['Cancelled', 'Confirmed', 'Packed', 'Shipped'],
};

/** Statuses from which a shipment may be booked. */
const SHIPPABLE_STATUSES = ['Confirmed', 'Packed'];

/** Statuses that mean the order is over and stock/coupons should be released. */
const TERMINAL_STATUSES = ['Delivered', 'Cancelled'];

/** Statuses at which stock has been committed to the customer. */
const STOCK_COMMITTED_STATUSES = ['Confirmed', 'Packed', 'Shipped', 'Delivered'];

const canTransition = (from, to, isAdmin = true) => {
  if (isAdmin) return ALL_ORDER_STATUSES.includes(to);
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
};

module.exports = {
  FREE_DELIVERY_THRESHOLD: DEFAULT_FREE_DELIVERY_THRESHOLD,
  DELIVERY_CHARGE: DEFAULT_DELIVERY_CHARGE,
  computeShippingPrice,
  computeOnlineDiscount,
  getShippingRules,
  ALL_ORDER_STATUSES,
  ALLOWED_TRANSITIONS,
  SHIPPABLE_STATUSES,
  TERMINAL_STATUSES,
  STOCK_COMMITTED_STATUSES,
  canTransition,
};
