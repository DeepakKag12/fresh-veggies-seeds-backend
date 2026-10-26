const express = require('express');
const router = express.Router();
const {
  getAllCoupons,
  getActiveCoupons,
  validateCoupon,
  applyCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon
} = require('../controllers/coupon.controller');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.get('/active', getActiveCoupons);
router.post('/validate', optionalAuth, validateCoupon);
router.post('/apply', optionalAuth, applyCoupon);

router.route('/')
  .get(protect, admin, getAllCoupons)
  .post(protect, admin, createCoupon);

router.route('/:id')
  .put(protect, admin, validateObjectId, updateCoupon)
  .delete(protect, admin, validateObjectId, deleteCoupon);

module.exports = router;
