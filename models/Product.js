const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required']
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: 0
  },
  originalPrice: {
    type: Number,
    min: 0
  },
  discount: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  weight: {
    type: String,
    enum: ['5g', '8g', '10g', '20g', '50g', '100g', '120g', '150g', '250g', '300g', '500g', '600g', '800g', '1kg', '1.2kg', '2kg', '5kg', '10kg']
  },
  // Package variants for seed products with different quantities and prices
  packages: [{
    quantity: {
      type: String,
      required: true,
      default: '50 Seeds'
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    stock: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  stock: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    required: [true, 'Description is required']
  },
  images: [{
    type: String
  }],
  features: [{
    type: String
  }],
  howToGrow: {
    type: String
  },
  season: {
    type: String,
    enum: ['Summer', 'Winter', 'Spring', 'Autumn', 'All Season', 'Monsoon']
  },
  isCombo: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  numReviews: {
    type: Number,
    default: 0
  },
  featured: {
    type: Boolean,
    default: false
  },
  trending: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// ─── Indexes ─────────────────────────────────────────────────────────────────
// Every public listing filters on isActive and then sorts, so each of these
// mirrors one real query shape. Without them Mongo collection-scans the whole
// catalogue on every cache miss.
productSchema.index({ isActive: 1, createdAt: -1 });               // default + "newest" sort
productSchema.index({ isActive: 1, categoryId: 1, createdAt: -1 });// category filter
productSchema.index({ isActive: 1, price: 1 });                    // price-low / price-high sorts
productSchema.index({ isActive: 1, rating: -1 });                  // GET /products/featured
// Search scans name/description/features. Without this the regex $or was a
// full collection scan on every keystroke-driven search request.
productSchema.index({ name: 'text', description: 'text', features: 'text' });
productSchema.index({ isActive: 1, featured: 1, createdAt: -1 });  // homepage "most loved"
productSchema.index({ isActive: 1, stock: 1 });                    // low-stock admin view                  // GET /products/featured

module.exports = mongoose.model('Product', productSchema);
