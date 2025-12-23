const express = require('express');
const router = express.Router();
const {
  getAllReviews,
  getProductReviews,
  createReview,
  approveReview,
  deleteReview
} = require('../controllers/reviewController');
const { protect, admin } = require('../middleware/auth');

router.get('/admin', protect, admin, getAllReviews);
router.get('/product/:productId', getProductReviews);

router.post('/', protect, createReview);
router.put('/:id/approve', protect, admin, approveReview);
router.delete('/:id', protect, admin, deleteReview);

module.exports = router;
