/**
 * Lightweight request-body validation helpers.
 * Returns { valid: false, message: '...' } on failure, or { valid: true } on success.
 * No external dependencies — pure JS.
 */

const MAX_ITEMS_PER_ORDER  = 20;  // maximum distinct line items
const MAX_QTY_PER_ITEM     = 100; // maximum quantity per line item

/**
 * Validate the orderItems array.
 */
function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, message: 'Order must contain at least one item.' };
  }
  if (items.length > MAX_ITEMS_PER_ORDER) {
    return { valid: false, message: `Order cannot have more than ${MAX_ITEMS_PER_ORDER} items.` };
  }
  for (const item of items) {
    if (!item.product || typeof item.product !== 'string') {
      return { valid: false, message: 'Each item must have a valid product ID.' };
    }
    if (!['Product', 'Combo'].includes(item.productType)) {
      return { valid: false, message: 'productType must be "Product" or "Combo".' };
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
      return { valid: false, message: `Quantity must be between 1 and ${MAX_QTY_PER_ITEM}.` };
    }
  }
  return { valid: true };
}

/**
 * Validate a shipping address object.
 */
function validateShippingAddress(addr) {
  if (!addr || typeof addr !== 'object') {
    return { valid: false, message: 'Shipping address is required.' };
  }
  const { name, phone, street, city, state, pincode } = addr;
  if (!name?.trim())    return { valid: false, message: 'Shipping name is required.' };
  if (!phone?.toString().trim()) return { valid: false, message: 'Phone number is required.' };
  if (!street?.trim())  return { valid: false, message: 'Street address is required.' };
  if (!city?.trim())    return { valid: false, message: 'City is required.' };
  if (!state?.trim())   return { valid: false, message: 'State is required.' };
  const pinStr = pincode?.toString().trim();
  if (!pinStr) return { valid: false, message: 'Pincode is required.' };
  if (!/^[1-9][0-9]{5}$/.test(pinStr)) {
    return { valid: false, message: 'Please enter a valid 6-digit Indian PIN code.' };
  }

  return { valid: true };
}

module.exports = { validateOrderItems, validateShippingAddress };
