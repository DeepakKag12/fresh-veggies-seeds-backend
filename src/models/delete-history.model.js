const mongoose = require('mongoose');

const deleteHistorySchema = new mongoose.Schema({
  entityType: {
    type: String,
    required: true,
    enum: ['Product', 'Category', 'Combo', 'Coupon', 'Banner', 'Order', 'User'],
    index: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  entityName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  deletedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: 'Administrator' },
    email: { type: String, default: '' }
  },
  deletionReason: {
    type: String,
    default: 'Manual administrative deletion'
  },
  recoveryStatus: {
    type: String,
    enum: ['Recoverable', 'Restored', 'Permanently Deleted'],
    default: 'Recoverable',
    index: true
  },
  snapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  restoredAt: {
    type: Date,
    default: null
  },
  restoredBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    email: String
  },
  permanentlyDeletedAt: {
    type: Date,
    default: null
  },
  permanentlyDeletedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    email: String
  }
}, {
  timestamps: true
});

deleteHistorySchema.index({ entityType: 1, recoveryStatus: 1, createdAt: -1 });
deleteHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('DeleteHistory', deleteHistorySchema);
