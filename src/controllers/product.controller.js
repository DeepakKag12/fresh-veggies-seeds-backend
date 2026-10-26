const mongoose = require('mongoose');
const Product = require('../models/product.model');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

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

    const query = { isDeleted: { $ne: true } };

    // Public storefront only sees active products; admin can see inactive ones too
    if (req.user?.role !== 'admin') {
      query.isActive = true;
    }

    // Filter by category — value is a plain string (ObjectId); never an object.
    // An unparseable id used to reach Mongoose and throw a CastError, which the
    // catch below turned into a 500: anyone could trigger a server error with a
    // crafted URL like ?category=x. A malformed id simply matches nothing.
    if (category) {
      const Category = require('../models/category.model');
      const catLower = category.toLowerCase();
      if (mongoose.Types.ObjectId.isValid(category)) {
        const catDoc = await Category.findById(category).lean();
        if (catDoc) {
          const docSlug = (catDoc.slug || '').toLowerCase();
          const docName = (catDoc.name || '').toLowerCase();
          if (docSlug === 'seeds' || docName.includes('seed')) {
            const seedCats = await Category.find({
              $or: [
                { _id: category },
                { slug: { $in: ['seeds', 'vegetable-seeds', 'flower-seeds'] } },
                { name: { $regex: /seeds/i } }
              ]
            }).select('_id').lean();
            query.categoryId = { $in: seedCats.map(c => c._id) };
          } else if (docSlug === 'pots' || docName.includes('pot') || docName.includes('planter')) {
            const potCats = await Category.find({
              $or: [
                { _id: category },
                { slug: { $in: ['pots', 'planters', 'grow-bags'] } },
                { name: { $regex: /pot|planter|grow bag/i } }
              ]
            }).select('_id').lean();
            query.categoryId = { $in: potCats.map(c => c._id) };
          } else if (docSlug === 'soils' || docSlug === 'soil' || docSlug === 'fertilizers' || docSlug === 'fertilisers' || docName.includes('soil') || docName.includes('fertil')) {
            const soilCats = await Category.find({
              $or: [
                { _id: category },
                { slug: { $in: ['soils', 'soil', 'fertilizers', 'fertilisers', 'soil-fertilizers'] } },
                { name: { $regex: /soil|fertil/i } }
              ]
            }).select('_id').lean();
            query.categoryId = { $in: soilCats.map(c => c._id) };
          } else if (docSlug === 'garden-tools' || docSlug === 'tools' || docName.includes('tool')) {
            const toolCats = await Category.find({
              $or: [
                { _id: category },
                { slug: { $in: ['tools', 'garden-tools'] } },
                { name: { $regex: /tool/i } }
              ]
            }).select('_id').lean();
            query.categoryId = { $in: toolCats.map(c => c._id) };
          } else {
            query.categoryId = category;
          }
        } else {
          query.categoryId = category;
        }
      } else {
        if (catLower === 'seeds' || catLower.includes('seed')) {
          const seedCats = await Category.find({
            $or: [
              { slug: { $in: ['seeds', 'vegetable-seeds', 'flower-seeds'] } },
              { name: { $regex: /seeds/i } }
            ]
          }).select('_id').lean();
          query.categoryId = { $in: seedCats.map(c => c._id) };
        } else if (catLower === 'pots' || catLower === 'planters' || catLower.includes('pot') || catLower.includes('planter')) {
          const potCats = await Category.find({
            $or: [
              { slug: { $in: ['pots', 'planters', 'grow-bags'] } },
              { name: { $regex: /pot|planter|grow bag/i } }
            ]
          }).select('_id').lean();
          query.categoryId = { $in: potCats.map(c => c._id) };
        } else if (catLower === 'soils' || catLower === 'soil' || catLower.includes('fertil') || catLower.includes('soil')) {
          const soilCats = await Category.find({
            $or: [
              { slug: { $in: ['soils', 'soil', 'fertilizers', 'fertilisers', 'soil-fertilizers'] } },
              { name: { $regex: /soil|fertil/i } }
            ]
          }).select('_id').lean();
          query.categoryId = { $in: soilCats.map(c => c._id) };
        } else if (catLower === 'tools' || catLower === 'garden-tools' || catLower.includes('tool')) {
          const toolCats = await Category.find({
            $or: [
              { slug: { $in: ['tools', 'garden-tools'] } },
              { name: { $regex: /tool/i } }
            ]
          }).select('_id').lean();
          query.categoryId = { $in: toolCats.map(c => c._id) };
        } else {
          const catDoc = await Category.findOne({
            $or: [
              { slug: catLower },
              { name: new RegExp(`^${category}$`, 'i') },
              { name: new RegExp(category, 'i') }
            ]
          }).select('_id').lean();
          if (catDoc) {
            query.categoryId = catDoc._id;
          } else {
            return res.status(200).json({
              success: true, count: 0, total: 0, totalPages: 0, currentPage: 1, data: [],
            });
          }
        }
      }
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

    const lowstock = req.query.lowstock === 'true';
    const outofstock = req.query.outofstock === 'true';

    const conditions = [];

    // Search by name (with fuzzy matching for misspellings)
    if (search) {
      // Escape special regex characters to prevent ReDoS
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      const searchWords = escaped.split(' ').filter(w => w.length > 0);

      const regexPatterns = searchWords.map(word => new RegExp(word, 'i'));

      conditions.push({
        $or: [
          { name: { $regex: escaped, $options: 'i' } },
          { description: { $regex: escaped, $options: 'i' } },
          ...regexPatterns.map(pattern => ({ name: pattern })),
          ...regexPatterns.map(pattern => ({ description: pattern }))
        ]
      });
    }

    // Filter by low stock or out of stock
    if (lowstock) {
      const Settings = require('../models/settings.model');
      const settings = await Settings.findOne().lean();
      const cutoff = settings?.inventory?.lowStockThreshold ?? 10;
      conditions.push({
        $or: [
          { stock: { $gt: 0, $lte: cutoff } },
          { 'packages.stock': { $gt: 0, $lte: cutoff } }
        ]
      });
    } else if (outofstock) {
      conditions.push({
        $or: [
          { stock: { $lte: 0 } },
          { 'packages.stock': { $lte: 0 } }
        ]
      });
    }

    if (conditions.length > 0) {
      query.$and = conditions;
    }

    // Sorting — whitelist only; never allow arbitrary field injection
    let sortOption = {};
    if (sort === 'price-low') sortOption.price = 1;
    else if (sort === 'price-high') sortOption.price = -1;
    else if (sort === 'newest') sortOption.createdAt = -1;
    else sortOption.createdAt = -1;

    // ── In-Memory Cache Lookup ───────────────────────────────────────────────
    const roleKey = req.user?.role === 'admin' ? 'admin' : 'public';
    const stockKey = lowstock ? 'low' : outofstock ? 'out' : 'all';
    const cacheKey = `products:list:${roleKey}:${stockKey}:${category || 'all'}:${season || 'all'}:${search ? encodeURIComponent(search.toLowerCase()) : 'none'}:${sort || 'default'}:${page}:${limit}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

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

    const payload = {
      success: true,
      count: products.length,
      total: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      data: products.map(enrichProductStock)
    };

    // 60-second fast in-memory cache (auto-invalidated on mutations and stock changes)
    cacheService.set(cacheKey, payload, 60 * 1000);

    res.status(200).json(payload);
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

    const cacheKey = `products:id:${req.params.id}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const product = await Product.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    })
      .populate('categoryId', 'name slug')
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const payload = {
      success: true,
      data: enrichProductStock(product)
    };

    cacheService.set(cacheKey, payload, 60 * 1000); // 60s fast memory cache

    res.status(200).json(payload);
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

    const auditService = require('../services/audit.service');
    auditService.logAction({
      req,
      action: 'CREATE',
      entityType: 'Product',
      entityId: product._id,
      entityName: product.name,
      details: { price: product.price, stock: product.stock, categoryId: product.categoryId }
    }).catch(() => {});

    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');
    cacheService.invalidate('categories:');
    cacheService.invalidate('admin:');

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
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      req.body,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const auditService = require('../services/audit.service');
    auditService.logAction({
      req,
      action: req.body.stock !== undefined ? 'STOCK_CHANGE' : req.body.price !== undefined ? 'PRICE_CHANGE' : 'UPDATE',
      entityType: 'Product',
      entityId: product._id,
      entityName: product.name,
      details: {
        updatedFields: Object.keys(req.body),
        price: product.price,
        stock: product.stock
      }
    }).catch(() => {});

    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');
    cacheService.invalidate('categories:');
    cacheService.invalidate('admin:');

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
    const Combo = require('../models/combo.model');
    const inCombos = await Combo.countDocuments({
      'includedProducts.productId': req.params.id,
      isDeleted: { $ne: true }
    });
    if (inCombos > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete product: it is included in ${inCombos} active combo(s). Please remove it from combo package(s) first.`
      });
    }

    const product = await Product.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const deletionReason = req.body?.reason || req.query?.reason || 'Manual administrative deletion';
    product.isDeleted = true;
    product.isActive = false;
    product.deletedAt = new Date();
    product.deletedBy = req.user?._id;
    product.deletionReason = deletionReason;
    await product.save();

    // Record in DeleteHistory recovery ledger & AuditLog
    const auditService = require('../services/audit.service');
    await auditService.logDeletion({
      req,
      entityType: 'Product',
      entityId: product._id,
      entityName: product.name,
      deletionReason,
      snapshot: product.toObject()
    });

    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');
    cacheService.invalidate('categories:');
    cacheService.invalidate('admin:');

    res.status(200).json({
      success: true,
      message: `Product "${product.name}" moved to Delete History. It can be restored anytime.`
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
    const cached = cacheService.get('products:featured');
    if (cached) {
      return res.status(200).json(cached);
    }

    const products = await Product.find({ isActive: true, isDeleted: { $ne: true } })
      .sort({ rating: -1 })
      .limit(8)
      .populate('categoryId', 'name slug')
      .lean();

    const payload = {
      success: true,
      count: products.length,
      data: products.map(enrichProductStock)
    };

    cacheService.set('products:featured', payload, 2 * 60 * 1000); // 2 min TTL

    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'productController.js → getFeaturedProducts');
  }
};
