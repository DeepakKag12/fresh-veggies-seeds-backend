/**
 * Input validators shared across controllers.
 *
 * Registration previously accepted anything non-empty: "notanemail" passed as
 * an address (the schema only lowercases it, it never checks the shape) and any
 * 6-character string passed as a password.
 */

// Deliberately pragmatic rather than RFC-complete: one @, a dot in the domain,
// no whitespace. Catches real typos without rejecting valid addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Indian mobile: 10 digits starting 6-9, optionally +91 / 0 prefixed.
const PHONE_RE = /^(?:\+?91[-\s]?)?[6-9]\d{9}$/;

const isValidEmail = (email) =>
  typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());

const isValidPhone = (phone) =>
  typeof phone === 'string' && PHONE_RE.test(phone.trim().replace(/[-\s]/g, ''));

/** Normalise a phone to bare 10 digits so lookups match regardless of format. */
const normalizePhone = (phone) =>
  String(phone || '').replace(/\D/g, '').slice(-10);

/**
 * Password policy. Length alone is weak, but an over-strict policy pushes users
 * to reuse passwords, so: at least 8 characters with a letter and a number.
 * @returns {{valid: boolean, message?: string}}
 */
const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must be under 128 characters.' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { valid: false, message: 'Password must contain at least one letter and one number.' };
  }
  return { valid: true };
};

/** Trim and hard-cap a free-text field so no unbounded string reaches the DB. */
const cleanText = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

/**
 * Validate a persisted cart payload.
 *
 * `cart` is a Mixed array, so before this a client could PUT arbitrary JSON of
 * unbounded size straight into their user document.
 */
const MAX_CART_ITEMS = 50;
const validateCart = (cart) => {
  if (!Array.isArray(cart)) {
    return { valid: false, message: 'Cart must be an array.' };
  }
  if (cart.length > MAX_CART_ITEMS) {
    return { valid: false, message: `Cart cannot hold more than ${MAX_CART_ITEMS} items.` };
  }
  for (const item of cart) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, message: 'Each cart entry must be an object.' };
    }
    if (!item._id || typeof item._id !== 'string' || item._id.length > 64) {
      return { valid: false, message: 'Each cart entry needs a valid product id.' };
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return { valid: false, message: 'Cart quantities must be whole numbers between 1 and 100.' };
    }
  }
  return { valid: true };
};

module.exports = {
  isValidEmail,
  isValidPhone,
  normalizePhone,
  validatePassword,
  cleanText,
  validateCart,
  MAX_CART_ITEMS,
};
