/**
 * Auth & User Input Validator
 * ─────────────────────────────────────────────────────────────
 * Pragmatic, RFC-compliant format validators for auth, mobile OTP, and cart data.
 */

// Deliberately pragmatic: one @, a dot in the domain, no whitespace.
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
 * Password policy: at least 8 characters with a letter and a number.
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

/** Validate a persisted cart payload. */
const MAX_CART_ITEMS = 50;
const validateCart = (cart) => {
  if (!Array.isArray(cart)) {
    return { valid: false, message: 'Cart must be an array.' };
  }
  if (cart.length > MAX_CART_ITEMS) {
    return { valid: false, message: `Cart cannot hold more than ${MAX_CART_ITEMS} items.` };
  }
  for (const item of cart) {
    if (!item || typeof item !== 'object') {
      return { valid: false, message: 'Cart item must be an object.' };
    }
    const productId = item.product || item._id;
    if (!productId || (typeof productId !== 'string' && typeof productId !== 'object')) {
      return { valid: false, message: 'Cart item requires a product id.' };
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return { valid: false, message: 'Item quantity must be between 1 and 100.' };
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
};
