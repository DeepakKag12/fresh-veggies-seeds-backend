const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getAllUsers,
  updateUserRole,
  deleteUser,
  getRevenueOverview,
  getSalesAnalytics,
  getLowStockProducts
} = require('../controllers/adminController');
const { previewPurge, purgeData } = require('../controllers/dataPurgeController');
const { protect, admin } = require('../middleware/auth');
const validateObjectId = require('../middleware/validateObjectId');

router.get('/stats',     protect, admin, getDashboardStats);
router.get('/revenue',   protect, admin, getRevenueOverview);
router.get('/analytics', protect, admin, getSalesAnalytics);
router.get('/lowstock',  protect, admin, getLowStockProducts);
router.get('/users',     protect, admin, getAllUsers);
router.put('/users/:id/role', protect, admin, validateObjectId, updateUserRole);
router.delete('/users/:id',   protect, admin, validateObjectId, deleteUser);

// Production preparation. Admin-gated at the route; the controller additionally
// requires the super admin identity, a password re-entry and a typed phrase.
router.get('/purge-data/preview', protect, admin, previewPurge);
router.post('/purge-data',        protect, admin, purgeData);

module.exports = router;
