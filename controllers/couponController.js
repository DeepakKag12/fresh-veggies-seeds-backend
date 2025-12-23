const Coupon = require('../models/Coupon');
const Order = require('../models/Order');

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Private/Admin
exports.getAllCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('applicableCategories', 'name')
      .populate('applicableProducts', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: coupons.length,
      data: coupons
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    }).select('code description discountType discountValue minOrderAmount');

    res.status(200).json({
      success: true,
      count: coupons.length,
      data: coupons
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Validate and apply coupon
// @route   POST /api/coupons/validate
// @access   Private
exports.validateCoupon = async (req, res) => {
  try {
    const { code, orderAmount, products } = req.body;
    const userId = req.user._id;

    const coupon = await Coupon.findOne({ 
      code: code.toUpperCase(),
      isActive: true
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Invalid coupon code'
      });
    }

    // Check if coupon is expired
    const now = new Date();
    if (now < coupon.startDate || now > coupon.expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Coupon has expired'
      });
    }

    // Check minimum order amount
    if (orderAmount < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount of ₹${coupon.minOrderAmount} required`
      });
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        message: 'Coupon usage limit reached'
      });
    }

    // Check per user limit
    const userUsageCount = await Order.countDocuments({
      userId,
      'couponUsed.code': code.toUpperCase()
    });

    if (userUsageCount >= coupon.perUserLimit) {
      return res.status(400).json({
        success: false,
        message: 'You have already used this coupon'
      });
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
      discountAmount = (orderAmount * coupon.discountValue) / 100;
      if (coupon.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
      }
    } else {
      discountAmount = coupon.discountValue;
    }

    discountAmount = Math.round(discountAmount);

    res.status(200).json({
      success: true,
      data: {
        couponId: coupon._id,
        code: coupon.code,
        discountAmount,
        finalAmount: orderAmount - discountAmount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
