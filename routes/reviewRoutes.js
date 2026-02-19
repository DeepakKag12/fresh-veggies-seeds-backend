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
const validateObjectId = require('../middleware/validateObjectId');

router.get('/admin', protect, admin, getAllReviews);
router.get('/product/:productId', validateObjectId('productId'), getProductReviews);

router.post('/', protect, createReview);
router.put('/:id/approve', protect, admin, validateObjectId, approveReview);
router.delete('/:id', protect, admin, validateObjectId, deleteReview);

module.exports = router;
