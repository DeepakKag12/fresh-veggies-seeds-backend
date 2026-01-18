const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrder,
  getAllOrders,
  updateOrderStatus,
  cancelOrder,
  createShipment,
  trackOrder,
  checkPincodeServiceability
} = require('../controllers/orderController');
const { protect, admin } = require('../middleware/auth');

// Public routes
router.get('/check-pincode/:pincode', checkPincodeServiceability);

router.route('/')
  .post(protect, createOrder)
  .get(protect, admin, getAllOrders);

router.get('/myorders', protect, getMyOrders);

router.route('/:id')
  .get(protect, getOrder);

router.put('/:id/status', protect, admin, updateOrderStatus);
router.put('/:id/cancel', protect, cancelOrder);

// Shipping routes
router.post('/:id/ship', protect, admin, createShipment);
router.get('/:id/track', protect, trackOrder);

module.exports = router;
