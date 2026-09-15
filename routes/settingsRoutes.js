const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { protect, admin } = require('../middleware/auth');

// Public settings route (store info, delivery thresholds, etc.)
router.get('/', settingsController.getPublicSettings);

// Admin settings routes
router.get('/admin', protect, admin, settingsController.getAdminSettings);
router.put('/admin/:section', protect, admin, settingsController.updateSettingsSection);
router.post('/admin/reset/:section', protect, admin, settingsController.resetSettingsSection);

module.exports = router;
