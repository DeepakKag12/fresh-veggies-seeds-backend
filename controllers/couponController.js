const Coupon = require('../models/Coupon');
const couponService = require('../services/couponService');
const { serverError } = require('../utils/respond');

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Private/Admin
exports.getAllCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('applicableCategories', 'name')
      .populate('applicableProducts', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: coupons.length,
      data: coupons
    });
  } catch (error) {
    return serverError(res, error, 'couponController.js → getAllCoupons');
  }
};

// @desc    Get active coupons (for customers)
// @route   GET /api/coupons/active
// @access  Public
exports.getActiveCoupons = async (req, res) => {
  try {
    const now = new Date();
    const coupons = await Coupon.find({
        isActive: true,
        startDate: { $lte: now },
        expiryDate: { $gte: now }
      })
        .select('code description discountType discountValue minOrderAmount')
        .lean();

    res.status(200).json({
      success: true,
      count: coupons.length,
      data: coupons
    });
  } catch (error) {
    return serverError(res, error, 'couponController.js → getActiveCoupons');
  }
};

// @desc    Validate and apply coupon
// @route   POST /api/coupons/validate
// @access   Private
exports.validateCoupon = async (req, res) => {
  try {
    const { code, orderAmount } = req.body;

    // Delegates to couponService so this preview and the discount actually
    // applied at checkout can never disagree — they run the same code.
    const result = await couponService.validateCoupon(code, Number(orderAmount) || 0, req.user?._id || null);

    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }

    res.status(200).json({
      success: true,
      data: {
        couponId:       result.coupon._id,
        code:           result.coupon.code,
        discountAmount: result.discountAmount,
        finalAmount:    (Number(orderAmount) || 0) - result.discountAmount
      }
    });
  } catch (error) {
    return serverError(res, error, 'couponController.js → validateCoupon');
  }
};

// @desc    Create coupon
// @route   POST /api/coupons
// @access  Private/Admin
exports.createCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.create(req.body);

    res.status(201).json({
      success: true,
      data: coupon
    });
  } catch (error) {
    return serverError(res, error, 'couponController.js → createCoupon');
  }
};

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Private/Admin
exports.updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    res.status(200).json({
      success: true,
      data: coupon
    });
  } catch (error) {
    return serverError(res, error, 'couponController.js → updateCoupon');
  }
};

// @desc    Delete coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Coupon deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'couponController.js → deleteCoupon');
  }
};
