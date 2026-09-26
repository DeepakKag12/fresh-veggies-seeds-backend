const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');
const { protect, admin } = require('../middleware/auth.middleware');

// Public route to submit an inquiry
router.post('/', contactController.submitContactInquiry);

// Admin-only routes to view and manage inquiries
router.get('/', protect, admin, contactController.getContactInquiries);
router.patch('/:id', protect, admin, contactController.updateInquiryStatus);

module.exports = router;
