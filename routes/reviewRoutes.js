const express = require('express');
const router = express.Router();
const {
  getAllReviews,
  getProductReviews,
  checkReviewEligibility,
  createReview,
  updateReview,
  approveReview,
  deleteReview
} = require('../controllers/reviewController');
const { protect, admin } = require('../middleware/auth');
const validateObjectId = require('../middleware/validateObjectId');

router.get('/admin', protect, admin, getAllReviews);
router.get('/product/:productId', validateObjectId('productId'), getProductReviews);
router.get('/eligibility/:productId', protect, validateObjectId('productId'), checkReviewEligibility);

router.post('/', protect, createReview);
router.put('/:id', protect, validateObjectId('id'), updateReview);
router.put('/:id/approve', protect, admin, validateObjectId('id'), approveReview);
router.delete('/:id', protect, admin, validateObjectId('id'), deleteReview);

module.exports = router;
