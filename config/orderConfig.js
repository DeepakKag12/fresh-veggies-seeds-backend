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
const FREE_DELIVERY_THRESHOLD = 300; // ₹ — order value at or above which delivery is free
const DELIVERY_CHARGE         = 50;  // ₹ — flat fee below the threshold

/**
 * Delivery fee for a given basket value.
 * @param {number} itemsPrice - server-computed items subtotal, before discount
 */
const computeShippingPrice = (itemsPrice) =>
  itemsPrice >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_CHARGE;

// ─── Order state machine ─────────────────────────────────────────────────────
// The only status transitions an admin action may perform. Anything not listed
// is rejected, so an order can never jump from Pending straight to Delivered or
// come back from a terminal state.
const ALLOWED_TRANSITIONS = {
  Pending:               ['Confirmed', 'Cancelled'],
  Confirmed:             ['Packed', 'Cancelled'],
  Packed:                ['Shipped', 'Cancelled'],
  Shipped:               ['Delivered'],
  Delivered:             [],            // terminal
  Cancelled:             [],            // terminal
  // An admin must be able to APPROVE a cancellation, not only reject it.
  // 'Cancelled' was missing here, so every order a customer asked to cancel got
  // stuck in this state permanently and its stock stayed committed forever.
  CancellationRequested: ['Cancelled', 'Confirmed', 'Packed', 'Shipped'],
};

/** Statuses from which a shipment may be booked. */
const SHIPPABLE_STATUSES = ['Confirmed', 'Packed'];

/** Statuses that mean the order is over and stock/coupons should be released. */
const TERMINAL_STATUSES = ['Delivered', 'Cancelled'];

/** Statuses at which stock has been committed to the customer. */
const STOCK_COMMITTED_STATUSES = ['Confirmed', 'Packed', 'Shipped', 'Delivered'];

const canTransition = (from, to) => (ALLOWED_TRANSITIONS[from] || []).includes(to);

module.exports = {
  FREE_DELIVERY_THRESHOLD,
  DELIVERY_CHARGE,
  computeShippingPrice,
  ALLOWED_TRANSITIONS,
  SHIPPABLE_STATUSES,
  TERMINAL_STATUSES,
  STOCK_COMMITTED_STATUSES,
  canTransition,
};
