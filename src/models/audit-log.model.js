const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: 'System' },
    email: { type: String, default: 'system@local' },
    role: { type: String, default: 'admin' }
  },
  action: {
    type: String,
    required: true,
    enum: [
      'CREATE',
      'UPDATE',
      'SOFT_DELETE',
      'RESTORE',
      'PERMANENT_DELETE',
      'STATUS_CHANGE',
      'STOCK_CHANGE',
      'PRICE_CHANGE',
      'ROLE_CHANGE',
      'CANCEL_APPROVE',
      'CANCEL_REJECT',
      'SETTINGS_UPDATE'
    ],
    index: true
  },
  entityType: {
    type: String,
    required: true,
    enum: ['Product', 'Category', 'Combo', 'Coupon', 'Banner', 'Order', 'User', 'Settings', 'Review'],
    index: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  entityName: {
    type: String,
    default: ''
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

auditLogSchema.index({ entityType: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
