const mongoose = require('mongoose');
const Product = require('../models/Product');
const statsCache = require('../utils/statsCache');
const { serverError } = require('../utils/respond');

// Helper to ensure returned product stock reflects package variants when present
const enrichProductStock = (product) => {
  if (!product) return product;
  if (Array.isArray(product.packages) && product.packages.length > 0) {
    const pkgStock = product.packages.reduce((sum, pkg) => sum + (Number(pkg.stock) || 0), 0);
    return { ...product, stock: pkgStock };
  }
  return product;
};

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
  try {
    // ── Sanitize query params — reject operator-injection objects (e.g. ?category[$ne]=x) ──
    const toStr = (val) => (val && typeof val === 'string' ? val.trim() : null);
    const category = toStr(req.query.category);
    const season   = toStr(req.query.season);
    const search   = toStr(req.query.search);
    const sort     = toStr(req.query.sort);
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12)); // max 50

    const query = { isActive: true };

    // Filter by category — value is a plain string (ObjectId); never an object.
    // An unparseable id used to reach Mongoose and throw a CastError, which the
    // catch below turned into a 500: anyone could trigger a server error with a
    // crafted URL like ?category=x. A malformed id simply matches nothing.
    if (category) {
      if (!mongoose.Types.ObjectId.isValid(category)) {
        return res.status(200).json({
          success: true, count: 0, total: 0, totalPages: 0, currentPage: 1, data: [],
        });
      }
      query.categoryId = category;
    }

    // Filter by season — plain string whitelist
    const ALLOWED_SEASONS = ['Summer', 'Winter', 'Spring', 'Autumn', 'All Season', 'AllSeason', 'Monsoon'];
    if (season && ALLOWED_SEASONS.includes(season)) {
      if (season === 'AllSeason' || season === 'All Season') {
        query.season = { $in: ['All Season', 'AllSeason'] };
      } else {
        query.season = season;
      }
    }

    // Search by name (with fuzzy matching for misspellings)
    if (search) {
      // Escape special regex characters to prevent ReDoS
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      const searchWords = escaped.split(' ').filter(w => w.length > 0);

      const regexPatterns = searchWords.map(word => new RegExp(word, 'i'));

      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        ...regexPatterns.map(pattern => ({ name: pattern })),
        ...regexPatterns.map(pattern => ({ description: pattern }))
      ];
    }

    // Sorting — whitelist only; never allow arbitrary field injection
    let sortOption = {};
    if (sort === 'price-low') sortOption.price = 1;
    else if (sort === 'price-high') sortOption.price = -1;
    else if (sort === 'newest') sortOption.createdAt = -1;
    else sortOption.createdAt = -1;

    // Run the page query and the total count concurrently — they are
    // independent, and serialising them doubled the latency of every miss.
    // .lean() returns plain objects instead of hydrated Mongoose documents:
    // these responses are only serialised to JSON, so the document wrapper was
    // pure overhead.
    const [products, count] = await Promise.all([
      Product.find(query)
        .populate('categoryId', 'name slug')
        .sort(sortOption)
        .limit(limit)
        .skip((page - 1) * limit)
        .lean(),
      Product.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      total: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      data: products.map(enrichProductStock)
    });
  } catch (error) {
    console.error('❌ getProducts error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res) => {
  try {
    // Validate MongoDB ObjectId
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format'
      });
    }

    const product = await Product.findById(req.params.id)
      .populate('categoryId', 'name slug')
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: enrichProductStock(product)
    });
  } catch (error) {
    return serverError(res, error, 'productController → getProduct', 'Failed to fetch product.');
  }
};

// @desc    Create product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
  try {
    if (req.body.packages && Array.isArray(req.body.packages) && req.body.packages.length > 0) {
      req.body.stock = req.body.packages.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
    }
    const product = await Product.create(req.body);

    statsCache.invalidate('admin:');
    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    return serverError(res, error, 'productController.js → createProduct');
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
  try {
    if (req.body.packages && Array.isArray(req.body.packages) && req.body.packages.length > 0) {
      req.body.stock = req.body.packages.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
    }
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    return serverError(res, error, 'productController.js → updateProduct');
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'productController.js → deleteProduct');
  }
};

// @desc    Get featured products
// @route   GET /api/products/featured
// @access  Public
exports.getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .sort({ rating: -1 })
      .limit(8)
      .populate('categoryId', 'name slug')
      .lean();

    res.status(200).json({
      success: true,
      count: products.length,
      data: products.map(enrichProductStock)
    });
  } catch (error) {
    return serverError(res, error, 'productController.js → getFeaturedProducts');
  }
};
