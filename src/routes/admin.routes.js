const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getAllUsers,
  getUserDetails,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  getRevenueOverview,
  getSalesAnalytics,
  getLowStockProducts
} = require('../controllers/admin.controller');
const { previewPurge, purgeData } = require('../controllers/data-purge.controller');
const {
  getDeleteHistory,
  getDeleteRecord,
  restoreDeletedRecord,
  permanentlyDeleteRecord,
  getAuditLogs,
  getAuditStats
} = require('../controllers/delete-history.controller');
const { protect, admin } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.get('/stats',           protect, admin, getDashboardStats);
router.get('/dashboard/stats', protect, admin, getDashboardStats);
router.get('/revenue',   protect, admin, getRevenueOverview);
router.get('/analytics', protect, admin, getSalesAnalytics);
router.get('/lowstock',  protect, admin, getLowStockProducts);

// ── Customer CRM & User Directory ──────────────────────────────────────────
router.get('/users',            protect, admin, getAllUsers);
router.get('/users/:id',        protect, admin, validateObjectId, getUserDetails);
router.put('/users/:id/status', protect, admin, validateObjectId, updateUserStatus);
router.put('/users/:id/role',   protect, admin, validateObjectId, updateUserRole);
router.delete('/users/:id',     protect, admin, validateObjectId, deleteUser);
// ── Order Management & Logistics ──────────────────────────────────────────────
const {
  updateOrderStatus,
  updateOrderTracking,
  issueOrderRefund
} = require('../controllers/order.controller');

router.put('/orders/:id/status', protect, admin, validateObjectId, updateOrderStatus);
router.post('/orders/:id/track', protect, admin, validateObjectId, updateOrderTracking);
router.post('/orders/:id/refund', protect, admin, validateObjectId, issueOrderRefund);


// ── Delete History, Trash & Audit Logs ──────────────────────────────────────
router.get('/delete-history',                  protect, admin, getDeleteHistory);
router.get('/delete-history/:id',              protect, admin, validateObjectId, getDeleteRecord);
router.post('/delete-history/:id/restore',     protect, admin, validateObjectId, restoreDeletedRecord);
router.delete('/delete-history/:id/permanent', protect, admin, validateObjectId, permanentlyDeleteRecord);

router.get('/trash',                           protect, admin, getDeleteHistory);
router.get('/trash/:id',                       protect, admin, validateObjectId, getDeleteRecord);
router.post('/trash/:id/restore',              protect, admin, validateObjectId, restoreDeletedRecord);
router.delete('/trash/:id/permanent',          protect, admin, validateObjectId, permanentlyDeleteRecord);

router.get('/audit-logs',                      protect, admin, getAuditLogs);
router.get('/audit-logs/stats',                protect, admin, getAuditStats);

// Production preparation. Admin-gated at the route; the controller additionally
// requires the super admin identity, a password re-entry and a typed phrase.
router.get('/purge-data/preview', protect, admin, previewPurge);
router.post('/purge-data',        protect, admin, purgeData);

module.exports = router;
