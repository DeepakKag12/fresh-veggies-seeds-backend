const axios = require('axios');
const jwt = require('jsonwebtoken');
const { normalizePhone, isValidPhone } = require('../utils/validators');

/**
 * Service to interact with MSG91 APIs (SMS OTP only).
 * All email communication is handled exclusively by Brevo.
 */

/**
 * Verify the MSG91 access token received from the OTP widget.
 * @param {string} accessToken - JWT access token returned by MSG91 OTP widget
 * @returns {Promise<{ success: boolean, phone?: string, message?: string }>}
 */
const verifyAccessToken = async (accessToken) => {
  if (!accessToken || typeof accessToken !== 'string') {
    return { success: false, message: 'Invalid or missing access token' };
  }

  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    console.error('❌ MSG91_AUTH_KEY is not configured in environment variables');
    return {
      success: false,
      message: 'SMS OTP service is currently unconfigured on the server'
    };
  }

  // Primary endpoint per MSG91 Widget documentation
  const endpoints = [
    'https://control.msg91.com/api/v5/widget/verifyAccessToken',
    'https://api.msg91.com/api/v5/widget/verifyAccessToken'
  ];

  let lastError = null;
  let responseData = null;

  for (const url of endpoints) {
    try {
      const response = await axios.post(
        url,
        {
          authkey: authKey,
          'access-token': accessToken.trim()
        },
        {
          headers: {
            'Content-Type': 'application/json',
            authkey: authKey
          },
          timeout: 10000
        }
      );

      responseData = response.data;
      if (responseData) break;
    } catch (err) {
      lastError = err;
      // If server returned 400/401/403 with error JSON, capture it
      if (err.response?.data) {
        responseData = err.response.data;
        break;
      }
    }
  }

  if (!responseData) {
    console.error('❌ MSG91 verifyAccessToken network failure:', lastError?.message);
    return {
      success: false,
      message: 'Failed to contact SMS verification service. Please try again.'
    };
  }

  // Check MSG91 status
  if (responseData.type === 'error' || responseData.status === 'error') {
    return {
      success: false,
      message: responseData.message || 'OTP verification failed or token expired'
    };
  }

  // Extract mobile number from response fields
  // In MSG91: response may have `mobile`, `message` (e.g. "919876543210" or "Number Verified"),
  // or inside `data`
  let candidatePhone = null;

  if (responseData.mobile) {
    candidatePhone = responseData.mobile;
  } else if (responseData.data && responseData.data.mobile) {
    candidatePhone = responseData.data.mobile;
  } else if (responseData.message && typeof responseData.message === 'string' && /\d{10}/.test(responseData.message)) {
    candidatePhone = responseData.message;
  }

  // If candidatePhone is still not found in direct fields, inspect the JWT payload
  if (!candidatePhone) {
    try {
      const decoded = jwt.decode(accessToken.trim());
      if (decoded) {
        candidatePhone = decoded.mobile || decoded.phone || decoded.sub || decoded.identifier;
      }
    } catch (decodeErr) {
      console.warn('⚠️ Could not decode token claims:', decodeErr.message);
    }
  }

  if (!candidatePhone) {
    // If response was 'success' but phone couldn't be extracted
    return {
      success: false,
      message: 'Verified mobile number could not be determined from OTP verification token'
    };
  }

  const normalized = normalizePhone(candidatePhone);
  if (!isValidPhone(normalized)) {
    return {
      success: false,
      message: 'The verified phone number is not a valid 10-digit mobile number'
    };
  }

  return {
    success: true,
    phone: normalized,
    rawResponse: responseData
  };
};

module.exports = {
  verifyAccessToken
};
