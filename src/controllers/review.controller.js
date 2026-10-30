const mongoose = require('mongoose');
const Review = require('../models/review.model');
const Product = require('../models/product.model');
const Order = require('../models/order.model');
const statsCache = require('../utils/stats-cache.util');
const { serverError } = require('../utils/respond.util');

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
    if (!mongoose.Types.ObjectId.isValid(req.params.productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const sort = req.query.sort || 'recent';
    const ratingFilter = req.query.rating ? parseInt(req.query.rating) : null;
    const hasPhotosFilter = req.query.hasPhotos === 'true';

    let sortObj = { createdAt: -1 };
    if (sort === 'highest') sortObj = { rating: -1, createdAt: -1 };
    else if (sort === 'lowest') sortObj = { rating: 1, createdAt: -1 };
    else if (sort === 'helpful') sortObj = { helpfulCount: -1, createdAt: -1 };

    const filter = { productId: req.params.productId, isApproved: true };
    if (ratingFilter && [1, 2, 3, 4, 5].includes(ratingFilter)) {
      filter.rating = ratingFilter;
    }
    if (hasPhotosFilter) {
      filter['images.0'] = { $exists: true };
    }

    const [reviews, total, [stats], distribution, withPhotosCount] = await Promise.all([
      Review.find(filter)
        .populate('userId', 'name')
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
      Review.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(req.params.productId), isApproved: true } },
        { $group: { _id: null, avg: { $avg: '$rating' }, totalApproved: { $sum: 1 } } }
      ]),
      Review.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(req.params.productId), isApproved: true } },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ]),
      Review.countDocuments({
        productId: req.params.productId,
        isApproved: true,
        'images.0': { $exists: true }
      })
    ]);

    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, withPhotos: withPhotosCount || 0 };
    if (Array.isArray(distribution)) {
      distribution.forEach((item) => {
        if (item._id && breakdown[item._id] !== undefined) {
          breakdown[item._id] = item.count;
        }
      });
    }

    const payload = {
      success: true,
      count: reviews.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      avgRating: stats ? Math.round(stats.avg * 10) / 10 : 0,
      totalApproved: stats ? stats.totalApproved : 0,
      breakdown,
      data: reviews
    };

    res.status(200).json(payload);
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
    let orderQuery = {
      userId,
      orderStatus: 'Delivered',
      'orderItems.product': productId
    };

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      orderQuery._id = orderId;
    }

    const verifiedOrder = await Order.findOne(orderQuery).sort({ createdAt: -1 }).select('_id orderStatus').lean();
    const isVerified = Boolean(verifiedOrder);

    const sanitizedImages = Array.isArray(req.body.images)
      ? req.body.images.filter(img => typeof img === 'string' && img.trim().length > 0).slice(0, 5)
      : [];

    let review;
    try {
      review = await Review.create({
        productId,
        userId,
        orderId: verifiedOrder?._id || undefined,
        rating: numericRating,
        title: title.trim().slice(0, 100),
        comment: comment.trim().slice(0, 1000),
        images: sanitizedImages,
        isVerifiedPurchase: isVerified,
        isVerifiedBuyer: isVerified,
        isApproved: false // Requires moderation before public display
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
      }
      throw err;
    }

    statsCache.invalidate('admin:');
    statsCache.invalidate(`reviews:product:${productId}`);

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid review id' });
    }
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
    return serverError(res, error, 'reviewController.js → approveReview');
  }
};

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private/Admin
exports.deleteReview = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid review id' });
    }
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
    const [stats] = await Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(productId), isApproved: true } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);

    await Product.findByIdAndUpdate(productId, {
      rating: stats ? Math.round(stats.avg * 10) / 10 : 0,
      numReviews: stats ? stats.count : 0
    });

    statsCache.invalidate('products:');
    statsCache.invalidate(`reviews:product:${productId}`);
  } catch (error) {
    console.error('Error updating product rating:', error.message);
  }
};

// @desc    Vote review helpful
// @route   POST /api/reviews/:id/helpful
// @access  Public
exports.voteHelpful = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid review id' });
    }
    const review = await Review.findByIdAndUpdate(
      id,
      { $inc: { helpfulCount: 1 } },
      { new: true }
    ).select('helpfulCount');

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    res.status(200).json({ success: true, helpfulCount: review.helpfulCount });
  } catch (error) {
    return serverError(res, error, 'reviewController.js → voteHelpful');
  }
};

exports.updateProductRating = updateProductRating;
