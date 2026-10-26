/**
 * Chat Security & Validation Utilities
 * Enforces strict input sanitization, Indian phone number format validation,
 * compulsory contact checks for guest chat, and IDOR/BOLA authorization guards.
 */

/**
 * Strips HTML tags and controls max length to prevent XSS and payload bloat
 */
function sanitizeText(str, maxLength = 2000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates compulsory Name and 10-digit Indian Mobile Number
 * Returns { valid: boolean, error?: string, cleanName?: string, cleanPhone?: string }
 */
function validateCustomerContact({ name, phone }) {
  const cleanName = sanitizeText(name || '', 100);
  if (!cleanName || cleanName.length < 2) {
    return {
      valid: false,
      error: 'Please enter your full name (at least 2 characters).'
    };
  }

  // Normalize phone by stripping non-digit characters and taking last 10 digits
  const rawPhone = (phone || '').toString();
  const digitsOnly = rawPhone.replace(/\D/g, '');
  const cleanPhone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

  // Indian mobile numbers start with 6, 7, 8, or 9 and are exactly 10 digits
  if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
    return {
      valid: false,
      error: 'Please enter a valid 10-digit mobile number (e.g. 9876543210).'
    };
  }

  return {
    valid: true,
    cleanName,
    cleanPhone
  };
}

/**
 * Authorization Guard: Prevents IDOR / Broken Object Level Authorization
 * Verifies if the requester (admin, authenticated customer, or guest)
 * is authorized to view, join, or send messages to the conversation.
 */
function canAccessConversation(conversation, user, guestId) {
  if (!conversation) return false;
  
  // Admins have universal operational access
  if (user?.role === 'admin') return true;

  // Authenticated user matches conversation customerId
  if (user?._id && conversation.customerId) {
    return conversation.customerId.toString() === user._id.toString();
  }

  // Guest session matches conversation guestId
  if (guestId && conversation.guestId) {
    return conversation.guestId === guestId;
  }

  return false;
}

module.exports = {
  sanitizeText,
  validateCustomerContact,
  canAccessConversation
};
