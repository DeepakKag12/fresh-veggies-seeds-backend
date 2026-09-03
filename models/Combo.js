const mongoose = require('mongoose');

const comboSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Combo name is required'],
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: [true, 'Combo price is required'],
    min: 0
  },
  originalPrice: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  includedProducts: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      default: 1
    }
  }],
  images: [{
    type: String
  }],
  comboType: {
    type: String,
    enum: ['Small', 'Medium', 'Kitchen Garden', 'Terrace Garden', 'Growing Kit', 'Custom'],
    default: 'Custom'
  },
  stock: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  features: [{
    type: String
  }]
}, {
  timestamps: true
});

// Mirrors GET /api/combos: filter on isActive, sort by createdAt desc.
comboSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Combo', comboSchema);
