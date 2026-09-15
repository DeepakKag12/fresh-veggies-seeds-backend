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
      query.$or = [{ status: 'pending' }, { isApproved: false, status: { $exists: false } }];
    } else if (status === 'approved') {
      query.$or = [{ status: 'approved' }, { isApproved: true }];
    } else if (status === 'rejected') {
      query.status = 'rejected';
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

// @desc    Check if user is eligible to review a product
// @route   GET /api/reviews/eligibility/:productId
// @access  Private
exports.checkReviewEligibility = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    // Check if user already reviewed
    const existingReview = await Review.findOne({ productId, userId }).lean();

    // Check if user has a DELIVERED order containing this product
    const deliveredOrder = await Order.findOne({
      userId,
      orderStatus: 'Delivered',
      'orderItems.product': productId
    }).sort({ createdAt: -1 }).select('_id createdAt orderNumber').lean();

    const isVerifiedBuyer = !!deliveredOrder;
    const canReview = isVerifiedBuyer && !existingReview;

    res.status(200).json({
      success: true,
      data: {
        canReview,
        hasReviewed: !!existingReview,
        existingReview: existingReview || null,
        isVerifiedBuyer,
        deliveredOrderId: deliveredOrder?._id || null,
        deliveredOrderNumber: deliveredOrder?.orderNumber || null
      }
    });
  } catch (error) {
    console.error('checkReviewEligibility error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to verify review eligibility.' });
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
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'A valid product id is required.' });
    }

    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a whole number between 1 and 5.' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Review headline is required.' });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, message: 'Review comment is required.' });
    }

    const product = await Product.findById(productId).select('_id').lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Friendly pre-check; the unique (productId, userId) index is the real guard.
    const existingReview = await Review.findOne({ productId, userId }).lean();
    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: 'You have already reviewed this product. You can update your existing review.'
      });
    }

    // ── Purchase & Delivery Verification ───────────────────────────────────────
    // Only a customer who has purchased the product in an order that has reached
    // 'Delivered' status may write a review.
    let orderQuery = {
      userId,
      orderStatus: 'Delivered',
      'orderItems.product': productId
    };

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      orderQuery._id = orderId;
    }

    const verifiedOrder = await Order.findOne(orderQuery).sort({ createdAt: -1 }).select('_id').lean();
    if (!verifiedOrder) {
      return res.status(403).json({
        success: false,
        message: 'Only customers who have purchased and received this product can write a review.'
      });
    }

    let review;
    try {
      review = await Review.create({
        productId,
        userId,
        orderId: verifiedOrder._id,
        rating: numericRating,
        title: title.trim().slice(0, 100),
        comment: comment.trim().slice(0, 1000),
        isVerifiedPurchase: true,
        isApproved: false // Requires moderation before public display
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
      }
      throw err;
    }

    statsCache.invalidate('admin:');

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully! It will appear after moderation approval.',
      data: review
    });
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

// @desc    Update review (Customer)
// @route   PUT /api/reviews/:id
// @access  Private
exports.updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, title, comment } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid review id.' });
    }

    const review = await Review.findOne({ _id: id, userId });
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found or unauthorized.' });
    }

    if (rating !== undefined) {
      const numRating = Number(rating);
      if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
      }
      review.rating = numRating;
    }

    if (title) review.title = String(title).trim().slice(0, 100);
    if (comment) review.comment = String(comment).trim().slice(0, 1000);
    review.isApproved = false; // Re-requires approval upon editing

    await review.save();

    // Recalculate rating because if it was previously approved, unapproving it updates the score
    await updateProductRating(review.productId);
    statsCache.invalidate('admin:');

    res.status(200).json({
      success: true,
      message: 'Review updated successfully! It will be reviewed by admin.',
      data: review
    });
  } catch (error) {
    console.error('updateReview error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update review.' });
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

    const update = {
      isApproved,
      status: isApproved ? 'approved' : 'rejected'
    };
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
