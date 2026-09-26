const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { protect, admin } = require('../middleware/auth.middleware');

// Create Razorpay Order (server-side pricing)
router.post('/create-order', protect, paymentController.createRazorpayOrder);

// Verify Payment (HMAC validated)
router.post('/verify-payment', protect, paymentController.verifyPayment);

// Razorpay Webhook — must receive raw body; no JWT needed (verified by HMAC)
// NOTE: This route is registered with express.raw() in server.js, not json()
router.post('/webhook', paymentController.razorpayWebhook);

// Client-side payment failure fallback
router.post('/payment-failure', protect, paymentController.handlePaymentFailure);

// Admin manual refund (idempotent)
router.post('/refund', protect, admin, paymentController.refundPayment);

module.exports = router;
