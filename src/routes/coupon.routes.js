const express = require('express');
const router = express.Router();
const {
  getAllCoupons,
  getActiveCoupons,
  validateCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon
} = require('../controllers/coupon.controller');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.get('/active', getActiveCoupons);
router.post('/validate', optionalAuth, validateCoupon);

router.route('/')
  .get(protect, admin, getAllCoupons)
  .post(protect, admin, createCoupon);

router.route('/:id')
  .put(protect, admin, validateObjectId, updateCoupon)
  .delete(protect, admin, validateObjectId, deleteCoupon);

module.exports = router;
