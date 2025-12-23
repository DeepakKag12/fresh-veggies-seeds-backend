const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');

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

    const reviews = await Review.find(query)
      .populate('userId', 'name email')
      .populate('productId', 'name images')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
  try {
    const reviews = await Review.find({
      productId: req.params.productId,
      isApproved: true
    })
      .populate('userId', 'name')
      .sort({ createdAt: -1 });

    // Calculate average rating
    const avgRating = reviews.length > 0
      ? reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length
      : 0;

    res.status(200).json({
      success: true,
      count: reviews.length,
      avgRating: Math.round(avgRating * 10) / 10,
      data: reviews
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create review
// @route   POST /api/reviews
// @access  Private
exports.createReview = async (req, res) => {
  try {
    const { productId, rating, title, comment, orderId } = req.body;
    const userId = req.user._id;

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({ productId, userId });
    if (existingReview) {
      return res.status(400).json({
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
        'orderItems.productId': productId,
        orderStatus: 'Delivered'
      });
      isVerifiedPurchase = !!order;
    }

    const review = await Review.create({
      productId,
      userId,
      orderId,
      rating,
      title,
      comment,
      isVerifiedPurchase
    });

    // Update product rating
    await updateProductRating(productId);

    res.status(201).json({
      success: true,
      data: review
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Approve/Reject review
// @route   PUT /api/reviews/:id/approve
// @access  Private/Admin
exports.approveReview = async (req, res) => {
  try {
    const { isApproved, adminResponse } = req.body;

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { isApproved, adminResponse },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Update product rating if approved
    if (isApproved) {
      await updateProductRating(review.productId);
    }

    res.status(200).json({
      success: true,
      data: review
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Helper function to update product rating
const updateProductRating = async (productId) => {
  try {
    const reviews = await Review.find({
      productId,
      isApproved: true
    });

    if (reviews.length > 0) {
      const avgRating = reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length;
      await Product.findByIdAndUpdate(productId, {
        rating: Math.round(avgRating * 10) / 10,
        numReviews: reviews.length
      });
    } else {
      await Product.findByIdAndUpdate(productId, {
        rating: 0,
        numReviews: 0
      });
    }
  } catch (error) {
    console.error('Error updating product rating:', error);
  }
};
