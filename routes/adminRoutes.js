const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getAllUsers,
  updateUserRole,
  deleteUser,
  getSalesAnalytics,
  getLowStockProducts
} = require('../controllers/adminController');
const { protect, admin } = require('../middleware/auth');
const validateObjectId = require('../middleware/validateObjectId');

router.get('/stats',     protect, admin, getDashboardStats);
router.get('/analytics', protect, admin, getSalesAnalytics);
router.get('/lowstock',  protect, admin, getLowStockProducts);
router.get('/users',     protect, admin, getAllUsers);
router.put('/users/:id/role', protect, admin, validateObjectId, updateUserRole);
router.delete('/users/:id',   protect, admin, validateObjectId, deleteUser);

module.exports = router;
