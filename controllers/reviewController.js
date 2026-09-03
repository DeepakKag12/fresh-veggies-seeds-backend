const mongoose = require('mongoose');
const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const statsCache = require('../utils/statsCache');
const { serverError } = require('../utils/respond');

// @desc    Get all reviews (Admin)
// @route   GET /api/reviews/admin
// @access  Private/Admin
exports.getAllReviews = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};

    if (status === 'pending') {
      query.isApproved = false;
    } else if (status === 'approved') {
      query.isApproved = true;
    }

    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'name email')
        .populate('productId', 'name images')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: reviews
    });
  } catch (error) {
    console.error('getAllReviews error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
};

// @desc    Get reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const filter = { productId: req.params.productId, isApproved: true };

    // The average is computed over ALL approved reviews, not just this page —
    // deriving it from the returned slice would make it change as you paginate.
    const [reviews, total, [stats]] = await Promise.all([
      Review.find(filter)
        .populate('userId', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
      Review.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(req.params.productId), isApproved: true } },
        { $group: { _id: null, avg: { $avg: '$rating' } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      avgRating: stats ? Math.round(stats.avg * 10) / 10 : 0,
      data: reviews
    });
  } catch (error) {
    console.error('getProductReviews error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
  }
};

// @desc    Create review
// @route   POST /api/reviews
// @access  Private
exports.createReview = async (req, res) => {
  try {
    const { productId, rating, title, comment, orderId } = req.body;
    const userId = req.user._id;

    // ── Validation ────────────────────────────────────────────────────────────
    // These previously fell through to Mongoose and surfaced as raw 500s.
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'A valid product id is required.' });
    }

    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a whole number between 1 and 5.' });
    }

    const product = await Product.findById(productId).select('_id').lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    // Friendly pre-check; the unique (productId, userId) index is the real guard.
    const existingReview = await Review.findOne({ productId, userId }).lean();
    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    // Check if verified purchase
    let isVerifiedPurchase = false;
    if (orderId) {
      const order = await Order.findOne({
        _id: orderId,
        userId,
        'orderItems.product': productId,
        orderStatus: 'Delivered'
      });
      isVerifiedPurchase = !!order;
    }

    let review;
    try {
      review = await Review.create({
        productId,
        userId,
        orderId: orderId || undefined,
        rating: numericRating,
        title,
        comment,
        isVerifiedPurchase
      });
    } catch (err) {
      // The unique index caught a concurrent duplicate the pre-check missed.
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'You have already reviewed this product' });
      }
      throw err;
    }

    // Reviews start unapproved (Review schema default), so a new one cannot move
    // the product's rating until an admin approves it. Recalculating here would
    // be a no-op; approveReview is what triggers it.

    res.status(201).json({ success: true, data: review });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors).map((e) => e.message).join(' ')
      });
    }
    console.error('createReview error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to submit review.' });
  }
};

// @desc    Approve/Reject review
// @route   PUT /api/reviews/:id/approve
// @access  Private/Admin
// Approving or rejecting changes the dashboard's pending-review badge.
exports.approveReview = async (req, res) => {
  try {
    statsCache.invalidate('admin:');
    const { isApproved, adminResponse } = req.body;

    // Must be a real boolean: the string "false" is truthy, so an un-approve
    // sent as text silently approved the review instead.
    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isApproved must be true or false.'
      });
    }

    const update = { isApproved };
    if (adminResponse !== undefined) {
      update.adminResponse = String(adminResponse).trim().slice(0, 500);
    }

    const review = await Review.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Recalculate on BOTH transitions. Previously only approval refreshed the
    // rating, so revoking a review left its stars baked into the product's
    // average forever.
    await updateProductRating(review.productId);

    res.status(200).json({ success: true, data: review });
  } catch (error) {
    console.error('approveReview error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update review.' });
  }
};

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private/Admin
exports.deleteReview = async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Update product rating
    await updateProductRating(review.productId);

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'reviewController.js → deleteReview');
  }
};

// Helper function to update product rating
const updateProductRating = async (productId) => {
  try {
    // Aggregate in the database rather than loading every review into memory
    // and reducing in JS — a popular product with thousands of reviews made
    // this an increasingly expensive read on every approval.
    const [stats] = await Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(productId), isApproved: true } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);

    await Product.findByIdAndUpdate(productId, {
      rating: stats ? Math.round(stats.avg * 10) / 10 : 0,
      numReviews: stats ? stats.count : 0
    });
  } catch (error) {
    console.error('Error updating product rating:', error.message);
  }
};
