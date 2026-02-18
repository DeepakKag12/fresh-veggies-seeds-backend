const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

// Create Razorpay Order
router.post('/create-order', protect, paymentController.createRazorpayOrder);

// Verify Payment
router.post('/verify-payment', protect, paymentController.verifyPayment);

// Handle Payment Failure
router.post('/payment-failure', protect, paymentController.handlePaymentFailure);

// Refund Payment (Admin only)
router.post('/refund', protect, paymentController.refundPayment);

module.exports = router;
