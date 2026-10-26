const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    guestId: {
      type: String,
      default: null,
      index: true
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
      default: 'Guest Shopper'
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    customerPhone: {
      type: String,
      trim: true,
      default: ''
    },
    lastMessage: {
      text: { type: String, default: '' },
      sender: { type: String, enum: ['customer', 'admin'], default: 'customer' },
      createdAt: { type: Date, default: Date.now },
      status: { type: String, enum: ['pending', 'sent', 'delivered', 'read'], default: 'sent' },
      hasAttachment: { type: Boolean, default: false }
    },
    unreadAdminCount: {
      type: Number,
      default: 0
    },
    unreadCustomerCount: {
      type: Number,
      default: 0
    },
    isOnline: {
      type: Boolean,
      default: false
    },
    lastSeen: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['active', 'archived', 'closed'],
      default: 'active',
      index: true
    },
    orderContext: {
      type: new mongoose.Schema(
        {
          orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
          orderNumber: { type: String, default: '' },
          totalAmount: { type: Number, default: 0 },
          orderStatus: { type: String, default: '' }
        },
        { _id: false }
      ),
      default: null
    },
    tags: [
      {
        type: String,
        trim: true
      }
    ]
  },
  {
    timestamps: true
  }
);

conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
