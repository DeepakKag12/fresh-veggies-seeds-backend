const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed', 'flat', 'PERCENTAGE', 'FLAT'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0
  },
  minOrderAmount: {
    type: Number,
    default: 0
  },
  minOrderValue: {
    type: Number,
    default: undefined
  },
  maxDiscountAmount: {
    type: Number,
    default: null
  },
  maxDiscount: {
    type: Number,
    default: undefined
  },
  usageLimit: {
    type: Number,
    default: null
  },
  usedCount: {
    type: Number,
    default: 0
  },
  perUserLimit: {
    type: Number,
    default: 1
  },
  usedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    usedAt: {
      type: Date,
      default: Date.now
    },
    discountAmount: {
      type: Number,
      default: 0
    }
  }],
  startDate: {
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date,
    required: false
  },
  endDate: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  applicableCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  deletionReason: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Normalize aliases and values before validation
couponSchema.pre('validate', function(next) {
  if (this.endDate && !this.expiryDate) {
    this.expiryDate = this.endDate;
  } else if (this.expiryDate && !this.endDate) {
    this.endDate = this.expiryDate;
  }
  if (!this.expiryDate && !this.endDate) {
    // Default to 30 days from now if not specified
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);
    this.expiryDate = in30Days;
    this.endDate = in30Days;
  }

  if (typeof this.discountType === 'string') {
    const lower = this.discountType.toLowerCase();
    if (lower === 'flat') this.discountType = 'fixed';
    else if (lower === 'percentage') this.discountType = 'percentage';
    else if (lower === 'fixed') this.discountType = 'fixed';
  }

  if (this.minOrderValue != null && (this.minOrderAmount === undefined || this.minOrderAmount === 0)) {
    this.minOrderAmount = this.minOrderValue;
  }
  if (this.maxDiscount != null && this.maxDiscountAmount == null) {
    this.maxDiscountAmount = this.maxDiscount;
  }

  next();
});

// Index for faster queries
couponSchema.index({ expiryDate: 1 });
couponSchema.index({ endDate: 1 });
couponSchema.index({ code: 1, isActive: 1 });
couponSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
couponSchema.index({ isActive: 1, startDate: 1, expiryDate: 1 });
couponSchema.index({ 'usedBy.user': 1 });
couponSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Coupon', couponSchema);
