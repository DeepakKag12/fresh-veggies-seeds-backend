const express = require('express');
const router = express.Router();
const { 
  register, 
  login, 
  getMe,
  logout, 
  updateProfile, 
  changeEmail, 
  changePassword,
  forgotPassword,
  resetPassword,
  sendOTP,
  verifyOTP,
  getCart,
  updateCart,
  verifyEmail,
  verifyMsg91Token,
  sendMsg91Otp,
  verifyMsg91Otp,
  resendMsg91Otp,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Allow user up to 15 OTP sends per day (24 hours).
// Keyed by normalized 10-digit mobile number so shared Wi-Fi/NAT IPs don't block other users.
const dailyOtpSendLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 15, // 15 OTP attempts per day
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const rawPhone = req.body?.phone ? String(req.body.phone).replace(/\D/g, '').slice(-10) : '';
    if (rawPhone && rawPhone.length === 10) {
      return `otp_phone_${rawPhone}`;
    }
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown_ip';
  },
  message: {
    success: false,
    message: 'You have reached the daily limit of 15 OTP requests. Please try again tomorrow or contact support.'
  }
});

// Generous verification limiter so entering/checking code never accidentally blocks honest customers
const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60, // 60 verification attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification attempts. Please wait a moment before trying again.'
  }
});

// Authentication routes
router.post('/register', register);
router.post('/login', login);
router.get('/verify-email/:token', verifyEmail);

// MSG91 SMS OTP verification routes (both direct OTP flow and token widget)
router.post('/msg91/send-otp', dailyOtpSendLimiter, sendMsg91Otp);
router.post('/msg91/verify-otp', otpVerifyLimiter, verifyMsg91Otp);
router.post('/msg91/resend-otp', dailyOtpSendLimiter, resendMsg91Otp);
router.post('/msg91/verify-token', otpVerifyLimiter, verifyMsg91Token);
router.post('/msg91-verify', otpVerifyLimiter, verifyMsg91Token);

// Password recovery routes
router.post('/forgot-password', dailyOtpSendLimiter, forgotPassword);
router.post('/reset-password/:resetToken', resetPassword);

// Mobile login routes (OTP-based)
router.post('/send-otp', dailyOtpSendLimiter, sendOTP);
router.post('/verify-otp', otpVerifyLimiter, verifyOTP);

// Protected routes
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.get('/cart', protect, getCart);
router.put('/cart', protect, updateCart);
router.put('/profile', protect, updateProfile);
router.put('/change-email', protect, changeEmail);
router.put('/change-password', protect, changePassword);

// Delivery address management
router.post('/addresses', protect, addAddress);
router.put('/addresses/:addressId', protect, updateAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);
router.put('/addresses/:addressId/default', protect, setDefaultAddress);

module.exports = router;
