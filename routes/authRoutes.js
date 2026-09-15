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

const msg91Limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP verification requests, please try again later.' }
});

// Authentication routes
router.post('/register', register);
router.post('/login', login);
router.get('/verify-email/:token', verifyEmail);

// MSG91 SMS OTP verification routes (both direct OTP flow and token widget)
router.post('/msg91/send-otp', msg91Limiter, sendMsg91Otp);
router.post('/msg91/verify-otp', msg91Limiter, verifyMsg91Otp);
router.post('/msg91/resend-otp', msg91Limiter, resendMsg91Otp);
router.post('/msg91/verify-token', msg91Limiter, verifyMsg91Token);
router.post('/msg91-verify', msg91Limiter, verifyMsg91Token);

// Password recovery routes
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:resetToken', resetPassword);

// Mobile login routes (OTP-based)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

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
