const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many contact requests. Please try again later.' }
});

// Public route to submit an inquiry (associates req.user if logged in)
router.post('/', contactLimiter, optionalAuth, contactController.submitContactInquiry);

// Admin-only routes to view and manage inquiries
router.get('/', protect, admin, contactController.getContactInquiries);
router.patch('/:id', protect, admin, contactController.updateInquiryStatus);
router.put('/:id', protect, admin, contactController.updateInquiryStatus);

module.exports = router;
