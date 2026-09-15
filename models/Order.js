const mongoose = require('mongoose');
const Counter  = require('./Counter');

const orderSchema = new mongoose.Schema({
  // Human-readable identifier shown to customers and used by support.
  // A raw ObjectId is unreadable over the phone and leaks row ordering.
  // Assigned in a pre-validate hook; sparse so pre-existing orders stay valid.
  orderNumber: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderItems: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'orderItems.productType',
      required: true
    },
    productType: {
      type: String,
      required: true,
      enum: ['Product', 'Combo']
    },
    name: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product.packages'
    },
    image: String
  }],
  shippingAddress: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' }
  },
  paymentMode: {
    type: String,
    required: true,
    enum: ['COD', 'Online', 'UPI'],
    default: 'COD'
  },
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Failed', 'Refunded'],
    default: 'Pending'
  },
  paymentDetails: {
    transactionId: String,
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    paidAt: Date
  },
  itemsPrice: {
    type: Number,
    required: true,
    default: 0
  },
  shippingPrice: {
    type: Number,
    required: true,
    default: 0
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  codExtraCharge: {
    type: Number,
    default: 0
  },
  onlineDiscount: {
    type: Number,
    default: 0
  },
  couponUsed: {
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon'
    },
    code: String,
    discountAmount: Number
  },
  totalAmount: {
    type: Number,
    required: true,
    default: 0
  },
  orderStatus: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'CancellationRequested'],
    default: 'Pending'
  },
  // Shipping & Tracking Details
  shipping: {
    courierName: {
      type: String,
      default: 'DTDC'
    },
    awbNumber: String, // Air Waybill Number (Tracking Number)
    trackingUrl: String,
    shippedAt: Date,
    estimatedDelivery: Date,
    trackingHistory: [{
      status: String,
      location: String,
      timestamp: Date,
      remarks: String
    }]
  },
  deliveredAt: Date,
  cancelledAt: Date,
  cancellationRequest: {
    reason: String,
    requestedAt: Date,
    previousStatus: String,
    rejectedAt: Date,
    rejectionReason: String
  },
  refund: {
    refundId: String,
    refundAmount: Number,
    refundStatus: {
      type: String,
      enum: ['Pending', 'Processed', 'Failed']
    },
    refundedAt: Date,
    reason: String
  },
  notes: String,
  // Append-only audit trail of every status change: who made it, when, and why.
  // Previously a status change overwrote the field with no record, so there was
  // no way to answer "who cancelled this order and when".
  statusHistory: [{
    status:    { type: String, required: true },
    from:      String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note:      String
  }],
  // Set to true once stock has been decremented for this order.
  // Prevents double-decrement if webhook + verifyPayment both fire.
  stockDecremented: {
    type: Boolean,
    default: false
  },
  // Set once stock has been returned to inventory after a cancellation, so a
  // repeated cancel/refund event can never credit the same units twice.
  stockRestored: {
    type: Boolean,
    default: false
  },
  // Populated when an order was confirmed for more units than were actually in
  // stock. Non-empty means the order needs manual reconciliation by an admin.
  stockIssues: [{
    name:      String,
    required:  Number,
    available: Number,
    at:        Date
  }]
}, {
  timestamps: true
});

// ─── Order number generation ─────────────────────────────────────────────────
// Format: FV-YYYYMMDD-XXXX, where XXXX is that day's sequence.
//
// The sequence comes from an atomic counter rather than a countDocuments(): two
// checkouts completing in the same instant would otherwise read the same count,
// generate the same number, and the second would die on the unique index —
// failing an order whose payment had already gone through.
orderSchema.pre('validate', async function (next) {
  if (this.orderNumber) return next();

  try {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq   = await Counter.next(`order-${stamp}`);
    this.orderNumber = `FV-${stamp}-${String(seq).padStart(4, '0')}`;
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Indexes ─────────────────────────────────────────────────────────────────
// Mirror the real query shapes: a customer's order list, the admin list filtered
// by status, and the payment lookups done by verify + webhook.
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, paymentMode: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'paymentDetails.razorpayOrderId': 1 });
orderSchema.index({ 'paymentDetails.razorpayPaymentId': 1 });
orderSchema.index({ paymentMode: 1, paymentStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
