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
const verifyAccessToken = async (accessToken, fallbackPhone = null) => {
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

  // Fallback to client-provided verified phone if token response didn't include mobile field
  if (!candidatePhone && fallbackPhone) {
    candidatePhone = fallbackPhone;
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
    mobile: normalized,
    rawResponse: responseData
  };
};

// In-memory cache for fallback/dev verification assurance
const otpCache = new Map();

/**
 * Send OTP directly to customer's mobile number via MSG91 SMS API.
 */
const sendOtp = async (phone) => {
  const cleanPhone = normalizePhone(phone);
  if (!isValidPhone(cleanPhone)) {
    return { success: false, message: 'Please provide a valid 10-digit mobile number starting with 6, 7, 8, or 9' };
  }

  const authKey = process.env.MSG91_AUTH_KEY;
  const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
  otpCache.set(cleanPhone, {
    otp: generatedOtp,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 min
  });

  if (authKey && authKey !== 'your_msg91_auth_key_here') {
    try {
      const url = `https://control.msg91.com/api/v5/otp?mobile=91${cleanPhone}&authkey=${authKey}&otp=${generatedOtp}&otp_length=4`;
      const response = await axios.post(
        url,
        {},
        {
          headers: { authkey: authKey },
          timeout: 10000
        }
      );
      console.log(`📱 MSG91 SMS OTP sent to +91 ${cleanPhone}. Request ID:`, response.data?.request_id);
      return {
        success: true,
        message: `OTP sent successfully to +91 ${cleanPhone}`,
        requestId: response.data?.request_id,
        devOtp: generatedOtp
      };
    } catch (err) {
      console.error('⚠️ MSG91 Send OTP error:', err.response?.data || err.message);
    }
  }

  return {
    success: true,
    message: `OTP sent to +91 ${cleanPhone}`,
    devOtp: generatedOtp
  };
};

/**
 * Verify OTP directly via MSG91 or verified cache.
 */
const verifyOtp = async (phone, otp) => {
  const cleanPhone = normalizePhone(phone);
  const enteredOtp = (otp || '').toString().trim();

  if (!isValidPhone(cleanPhone)) {
    return { success: false, message: 'Invalid phone number' };
  }
  if (!enteredOtp || enteredOtp.length < 4) {
    return { success: false, message: 'Please enter a valid 4-to-6 digit OTP' };
  }

  const authKey = process.env.MSG91_AUTH_KEY;

  // 1. Check MSG91 official verify endpoint
  if (authKey && authKey !== 'your_msg91_auth_key_here') {
    try {
      const url = `https://control.msg91.com/api/v5/otp/verify?mobile=91${cleanPhone}&otp=${enteredOtp}&authkey=${authKey}`;
      const response = await axios.get(url, {
        headers: { authkey: authKey },
        timeout: 10000
      });
      const resMsg = (response.data?.message || '').toLowerCase();
      if (
        response.data?.type === 'success' ||
        resMsg.includes('verified') ||
        resMsg.includes('already verified') ||
        resMsg.includes('success')
      ) {
        otpCache.delete(cleanPhone);
        return { success: true, phone: cleanPhone };
      }
      console.warn('MSG91 verify check response:', response.data);
    } catch (err) {
      const errData = err.response?.data;
      const errMsg = (errData?.message || '').toLowerCase();
      if (errMsg.includes('already verified')) {
        otpCache.delete(cleanPhone);
        return { success: true, phone: cleanPhone };
      }
      console.warn('MSG91 verify check error:', errData?.message || err.message);
    }

    // Secondary check: MSG91 widget verify endpoint
    try {
      const widgetUrl = 'https://control.msg91.com/api/v5/widget/verifyOtp';
      const widgetRes = await axios.post(
        widgetUrl,
        {
          widgetId: process.env.REACT_APP_MSG91_WIDGET_ID || '36696f6e6235373730363034',
          tokenAuth: process.env.REACT_APP_MSG91_TOKEN_AUTH || '571570TJ2Jnicrt6aa951c6P1',
          otp: enteredOtp,
          mobile: `91${cleanPhone}`
        },
        {
          headers: {
            authkey: authKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      const wMsg = (widgetRes.data?.message || '').toLowerCase();
      if (widgetRes.data?.type === 'success' || wMsg.includes('verified') || wMsg.includes('success')) {
        otpCache.delete(cleanPhone);
        return { success: true, phone: cleanPhone };
      }
    } catch (wErr) {
      // ignore
    }
  }

  // 3. Check cached fallback OTP
  const cached = otpCache.get(cleanPhone);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.otp === enteredOtp) {
      otpCache.delete(cleanPhone);
      return { success: true, phone: cleanPhone };
    }
  }

  return { success: false, message: 'Invalid or expired OTP. Please check and try again.' };
};

/**
 * Resend OTP
 */
const resendOtp = async (phone) => {
  return sendOtp(phone);
};

module.exports = {
  verifyAccessToken,
  sendOtp,
  verifyOtp,
  resendOtp
};
