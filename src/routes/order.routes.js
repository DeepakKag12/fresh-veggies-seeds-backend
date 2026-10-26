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
  updateOrderTracking,
  issueOrderRefund,
  checkPincodeServiceability,
  deleteStatusHistoryItem,
  bulkDeleteStatusHistory,
  deleteTrackingHistoryItem,
  deleteOrder,
  verifyCartIntegrity
} = require('../controllers/order.controller');
const { protect, admin } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

// Public routes
router.get('/check-pincode/:pincode', checkPincodeServiceability);
router.post('/verify-cart', verifyCartIntegrity);

router.route('/')
  .post(protect, createOrder)
  .get(protect, admin, getAllOrders);

router.get('/myorders', protect, getMyOrders);
router.get('/my-orders', protect, getMyOrders);

// All /:id routes share ObjectId validation
router.route('/:id')
  .get(protect, validateObjectId, getOrder)
  .delete(protect, admin, validateObjectId, deleteOrder);

router.put('/:id/status', protect, admin, validateObjectId, updateOrderStatus);

// History deletion routes (Admin)
router.delete('/:id/history/:historyId', protect, admin, validateObjectId, deleteStatusHistoryItem);
router.post('/:id/history/bulk-delete',  protect, admin, validateObjectId, bulkDeleteStatusHistory);
router.delete('/:id/tracking/:trackingId', protect, admin, validateObjectId, deleteTrackingHistoryItem);

// Cancellation flow (POST & PUT supported)
router.post('/:id/cancel',         protect,        validateObjectId, cancelOrder);          // user 1-click cancel
router.put('/:id/cancel',          protect,        validateObjectId, cancelOrder);          // user 1-click cancel
router.put('/:id/approve-cancel',  protect, admin, validateObjectId, approveCancellation);  // admin: approve + refund
router.put('/:id/reject-cancel',   protect, admin, validateObjectId, rejectCancellation);   // admin: reject

// Shipping & Tracking routes
router.post('/:id/ship',   protect, admin, validateObjectId, createShipment);
router.get('/:id/track',   protect,        validateObjectId, trackOrder);
router.post('/:id/track',  protect, admin, validateObjectId, updateOrderTracking); // Assign DTDC tracking
router.post('/:id/refund', protect, admin, validateObjectId, issueOrderRefund);   // 1-click Razorpay refund


module.exports = router;
