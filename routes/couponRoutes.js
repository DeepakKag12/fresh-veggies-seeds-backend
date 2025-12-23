const express = require('express');
const router = express.Router();
const {
  getAllCoupons,
  getActiveCoupons,
  validateCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon
} = require('../controllers/couponController');
const { protect, admin } = require('../middleware/auth');

router.get('/active', getActiveCoupons);
router.post('/validate', protect, validateCoupon);

router.route('/')
  .get(protect, admin, getAllCoupons)
  .post(protect, admin, createCoupon);

router.route('/:id')
  .put(protect, admin, updateCoupon)
  .delete(protect, admin, deleteCoupon);

module.exports = router;
