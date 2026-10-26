const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    sender: {
      type: String,
      enum: ['customer', 'admin'],
      required: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    senderName: {
      type: String,
      required: true,
      trim: true
    },
    text: {
      type: String,
      default: '',
      trim: true
    },
    attachment: {
      url: { type: String, default: null },
      fileType: { type: String, default: 'image' },
      fileName: { type: String, default: '' },
      fileSize: { type: Number, default: 0 }
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read'],
      default: 'sent',
      index: true
    },
    clientMsgId: {
      type: String,
      default: null,
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
    readAt: {
      type: Date,
      default: null
    },
    deliveredAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
