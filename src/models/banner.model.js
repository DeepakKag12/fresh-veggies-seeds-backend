const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  imageUrl: {
    type: String,
    required: true
  },
  mobileImageUrl: {
    type: String
  },
  linkUrl: {
    type: String
  },
  linkType: {
    type: String,
    enum: ['product', 'category', 'external', 'none'],
    default: 'none'
  },
  position: {
    type: String,
    enum: ['hero', 'top', 'middle', 'bottom', 'sidebar'],
    default: 'hero'
  },
  order: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  clickCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
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

// Index for faster queries
bannerSchema.index({ isActive: 1, position: 1, order: 1 });
bannerSchema.index({ isActive: 1, startDate: 1, order: 1 });
bannerSchema.index({ position: 1, order: 1 });
bannerSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Banner', bannerSchema);
