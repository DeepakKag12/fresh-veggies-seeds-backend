const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true
  },
  slug: {
    type: String,
    required: true,
    lowercase: true
  },
  order: {
    type: Number,
    default: 0
  },
  parentCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  description: {
    type: String,
    trim: true
  },
  image: {
    type: String
  },
  icon: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  showInCircle: {
    type: Boolean,
    default: true
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

// Safe slug generation utility
const slugify = (text) => {
  if (!text) return '';
  const slug = text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
  return slug || `category-${Date.now()}`;
};

// Create slug before validating so required: true never blocks creation
categorySchema.pre('validate', function(next) {
  if (this.name && !this.slug) {
    this.slug = slugify(this.name);
  }
  next();
});

// Safety net: ensure slug is also populated before save
categorySchema.pre('save', function(next) {
  if (this.name && !this.slug) {
    this.slug = slugify(this.name);
  }
  next();
});

// Safeguard hook: prevent deletion if active products are still assigned
categorySchema.pre('findOneAndDelete', async function(next) {
  try {
    const query = this.getQuery();
    const doc = await this.model.findOne(query);
    if (doc) {
      const Product = mongoose.models.Product || mongoose.model('Product');
      const assignedProducts = await Product.countDocuments({
        categoryId: doc._id,
        isDeleted: { $ne: true }
      });
      if (assignedProducts > 0) {
        const error = new Error(`Cannot delete category with ${assignedProducts} assigned products. Reassign products first.`);
        error.statusCode = 400;
        return next(error);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Mirrors GET /api/categories: filter on isActive, sort by name/order asc.
categorySchema.index({ isActive: 1, order: 1, name: 1 });
categorySchema.index({ order: 1 });
categorySchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
categorySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

module.exports = mongoose.model('Category', categorySchema);
