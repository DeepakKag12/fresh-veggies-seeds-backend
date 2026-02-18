const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
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
    image: String
  }],
  shippingAddress: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
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
    enum: ['Pending', 'Paid', 'Failed'],
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
  couponUsed: {
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
    enum: ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'],
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
  notes: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);
