const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrder,
  getAllOrders,
  updateOrderStatus,
  cancelOrder,
  approveCancellation,
  rejectCancellation,
  createShipment,
  trackOrder,
  checkPincodeServiceability,
  deleteStatusHistoryItem,
  bulkDeleteStatusHistory,
  deleteTrackingHistoryItem
} = require('../controllers/orderController');
const { protect, admin } = require('../middleware/auth');
const validateObjectId = require('../middleware/validateObjectId');

// Public routes
router.get('/check-pincode/:pincode', checkPincodeServiceability);

router.route('/')
  .post(protect, createOrder)
  .get(protect, admin, getAllOrders);

router.get('/myorders', protect, getMyOrders);

// All /:id routes share ObjectId validation
router.route('/:id')
  .get(protect, validateObjectId, getOrder);

router.put('/:id/status', protect, admin, validateObjectId, updateOrderStatus);

// History deletion routes (Admin)
router.delete('/:id/history/:historyId', protect, admin, validateObjectId, deleteStatusHistoryItem);
router.post('/:id/history/bulk-delete',  protect, admin, validateObjectId, bulkDeleteStatusHistory);
router.delete('/:id/tracking/:trackingId', protect, admin, validateObjectId, deleteTrackingHistoryItem);

// Cancellation flow
router.put('/:id/cancel',          protect,        validateObjectId, cancelOrder);          // user
router.put('/:id/approve-cancel',  protect, admin, validateObjectId, approveCancellation);  // admin: approve + refund
router.put('/:id/reject-cancel',   protect, admin, validateObjectId, rejectCancellation);   // admin: reject

// Shipping routes
router.post('/:id/ship',  protect, admin, validateObjectId, createShipment);
router.get('/:id/track',  protect,        validateObjectId, trackOrder);

module.exports = router;
