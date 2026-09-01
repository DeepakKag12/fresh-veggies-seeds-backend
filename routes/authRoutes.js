const express = require('express');
const router = express.Router();
const { 
  register, 
  login, 
  getMe, 
  updateProfile, 
  changeEmail, 
  changePassword,
  forgotPassword,
  resetPassword,
  sendOTP,
  verifyOTP,
  getCart,
  updateCart,
  verifyEmail
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Authentication routes
router.post('/register', register);
router.post('/login', login);
router.get('/verify-email/:token', verifyEmail);

// Password recovery routes
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:resetToken', resetPassword);

// Mobile login routes (OTP-based)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Protected routes
router.get('/me', protect, getMe);
router.get('/cart', protect, getCart);
router.put('/cart', protect, updateCart);
router.put('/profile', protect, updateProfile);
router.put('/change-email', protect, changeEmail);
router.put('/change-password', protect, changePassword);

module.exports = router;
