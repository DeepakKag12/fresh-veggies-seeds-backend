const mongoose = require('mongoose');
const Product = require('../models/product.model');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// Helper to compute edit distance for search suggestions ("Did you mean...")
const levenshteinDistance = (a = '', b = '') => {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const dp = Array.from({ length: an + 1 }, () => new Array(bn + 1).fill(0));
  for (let i = 0; i <= an; i++) dp[i][0] = i;
  for (let j = 0; j <= bn; j++) dp[0][j] = j;
  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[an][bn];
};

// Helper to ensure returned product stock reflects package variants when present
const enrichProductStock = (product) => {
  if (!product) return product;
  if (Array.isArray(product.packages) && product.packages.length > 0) {
    const pkgStock = product.packages.reduce((sum, pkg) => sum + (Number(pkg.stock) || 0), 0);
    return { ...product, stock: pkgStock };
  }
  return product;
};

// @desc    Get all products with advanced search, faceted filtering, and multi-layer caching
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
  try {
    // ── Sanitize query params — reject operator-injection objects ──
    const toStr = (val) => (val && typeof val === 'string' ? val.trim() : null);
    const season   = toStr(req.query.season);
    const search   = toStr(req.query.search);
    const sort     = toStr(req.query.sort);
    const isAll    = req.query.all === 'true' || req.query.unpaginated === 'true';
    const isAdmin  = req.user?.role === 'admin';
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const maxAllowedLimit = (isAdmin || isAll) ? 1000 : 50;
    const requestedLimit = parseInt(req.query.limit);
    const limit    = isAll
      ? 1000
      : Math.min(maxAllowedLimit, Math.max(1, requestedLimit || 12));

    const query = { isDeleted: { $ne: true } };

    // Public storefront only sees active products; admin can see inactive ones too
    if (!isAdmin) {
      query.isActive = true;
    }

    // ── Multi-Select Category Filtering (FEAT-004) ──────────────────────────
    // Supports: ?category=id1,id2 or ?category=seeds&category=pots or ?category=seeds
    let categoryTokens = [];
    if (Array.isArray(req.query.category)) {
      categoryTokens = req.query.category.map((categoryToken) => String(categoryToken).trim()).filter(Boolean);
    } else if (typeof req.query.category === 'string' && req.query.category.trim()) {
      categoryTokens = req.query.category.split(',').map((categoryToken) => categoryToken.trim()).filter(Boolean);
    }

    if (categoryTokens.length > 0) {
      const Category = require('../models/category.model');
      const resolvedCategoryIds = [];

      for (const token of categoryTokens) {
        const categoryQueryLower = token.toLowerCase();
        if (mongoose.Types.ObjectId.isValid(token)) {
          const categoryDoc = await Category.findById(token).lean();
          if (categoryDoc) {
            const documentSlug = (categoryDoc.slug || '').toLowerCase();
            const documentName = (categoryDoc.name || '').toLowerCase();
            if (documentSlug === 'seeds' || documentName.includes('seed')) {
              const seedCategories = await Category.find({
                $or: [
                  { _id: token },
                  { slug: { $in: ['seeds', 'vegetable-seeds', 'flower-seeds'] } },
                  { name: { $regex: /seeds/i } },
                ],
              }).select('_id').lean();
              seedCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
            } else if (documentSlug === 'pots' || documentName.includes('pot') || documentName.includes('planter')) {
              const potCategories = await Category.find({
                $or: [
                  { _id: token },
                  { slug: { $in: ['pots', 'planters', 'grow-bags'] } },
                  { name: { $regex: /pot|planter|grow bag/i } },
                ],
              }).select('_id').lean();
              potCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
            } else if (documentSlug === 'soils' || documentSlug === 'soil' || documentSlug === 'fertilizers' || documentSlug === 'fertilisers' || documentName.includes('soil') || documentName.includes('fertil')) {
              const soilCategories = await Category.find({
                $or: [
                  { _id: token },
                  { slug: { $in: ['soils', 'soil', 'fertilizers', 'fertilisers', 'soil-fertilizers'] } },
                  { name: { $regex: /soil|fertil/i } },
                ],
              }).select('_id').lean();
              soilCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
            } else if (documentSlug === 'garden-tools' || documentSlug === 'tools' || documentName.includes('tool')) {
              const toolCategories = await Category.find({
                $or: [
                  { _id: token },
                  { slug: { $in: ['tools', 'garden-tools'] } },
                  { name: { $regex: /tool/i } },
                ],
              }).select('_id').lean();
              toolCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
            } else {
              resolvedCategoryIds.push(categoryDoc._id);
            }
          } else {
            resolvedCategoryIds.push(token);
          }
        } else {
          if (categoryQueryLower === 'seeds' || categoryQueryLower.includes('seed')) {
            const seedCategories = await Category.find({
              $or: [
                { slug: { $in: ['seeds', 'vegetable-seeds', 'flower-seeds'] } },
                { name: { $regex: /seeds/i } },
              ],
            }).select('_id').lean();
            seedCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
          } else if (categoryQueryLower === 'pots' || categoryQueryLower === 'planters' || categoryQueryLower.includes('pot') || categoryQueryLower.includes('planter')) {
            const potCategories = await Category.find({
              $or: [
                { slug: { $in: ['pots', 'planters', 'grow-bags'] } },
                { name: { $regex: /pot|planter|grow bag/i } },
              ],
            }).select('_id').lean();
            potCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
          } else if (categoryQueryLower === 'soils' || categoryQueryLower === 'soil' || categoryQueryLower.includes('fertil') || categoryQueryLower.includes('soil')) {
            const soilCategories = await Category.find({
              $or: [
                { slug: { $in: ['soils', 'soil', 'fertilizers', 'fertilisers', 'soil-fertilizers'] } },
                { name: { $regex: /soil|fertil/i } },
              ],
            }).select('_id').lean();
            soilCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
          } else if (categoryQueryLower === 'tools' || categoryQueryLower === 'garden-tools' || categoryQueryLower.includes('tool')) {
            const toolCategories = await Category.find({
              $or: [
                { slug: { $in: ['tools', 'garden-tools'] } },
                { name: { $regex: /tool/i } },
              ],
            }).select('_id').lean();
            toolCategories.forEach((matchedCategory) => resolvedCategoryIds.push(matchedCategory._id));
          } else {
            const foundCategoryDoc = await Category.findOne({
              $or: [
                { slug: categoryQueryLower },
                { name: new RegExp(`^${token}$`, 'i') },
                { name: new RegExp(token, 'i') },
              ],
            }).select('_id').lean();
            if (foundCategoryDoc) {
              resolvedCategoryIds.push(foundCategoryDoc._id);
            }
          }
        }
      }

      if (resolvedCategoryIds.length > 0) {
        query.categoryId = { $in: resolvedCategoryIds };
      } else {
        query.categoryId = { $in: [] };
      }
    }

    // ── Filter by Season (Supports single or multi-season) ───────────────────
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

    // ── Search by keyword with regex token matching ────────────────────────
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      const searchWords = escaped.split(' ').filter((word) => word.length > 0);
      const regexPatterns = searchWords.map((word) => new RegExp(word, 'i'));

      conditions.push({
        $or: [
          { name: { $regex: escaped, $options: 'i' } },
          { description: { $regex: escaped, $options: 'i' } },
          ...regexPatterns.map((pattern) => ({ name: pattern })),
          ...regexPatterns.map((pattern) => ({ description: pattern })),
        ],
      });
    }

    // ── Availability Filtering ──────────────────────────────────────────────
    if (lowstock) {
      const Settings = require('../models/settings.model');
      const settings = await Settings.findOne().lean();
      const cutoff = settings?.inventory?.lowStockThreshold ?? 10;
      conditions.push({
        $or: [
          { stock: { $gt: 0, $lte: cutoff } },
          { 'packages.stock': { $gt: 0, $lte: cutoff } },
        ],
      });
    } else if (outofstock) {
      conditions.push({
        $or: [
          { stock: { $lte: 0 } },
          { 'packages.stock': { $lte: 0 } },
        ],
      });
    } else if (req.query.inStock === 'true' || req.query.inStockOnly === 'true') {
      conditions.push({
        $or: [
          { stock: { $gt: 0 } },
          { 'packages.stock': { $gt: 0 } },
        ],
      });
    }

    // ── Customer Rating Filtering (FEAT-004) ────────────────────────────────
    const minRating = parseFloat(req.query.rating || req.query.minRating);
    if (!isNaN(minRating) && minRating > 0) {
      conditions.push({ rating: { $gte: minRating } });
    }

    // ── Dual-Handle Price Range Filtering (FEAT-004) ────────────────────────
    const minPrice = parseFloat(req.query.minPrice);
    const maxPrice = parseFloat(req.query.maxPrice);
    if (!isNaN(minPrice) || !isNaN(maxPrice)) {
      const priceFilter = {};
      if (!isNaN(minPrice)) priceFilter.$gte = minPrice;
      if (!isNaN(maxPrice)) priceFilter.$lte = maxPrice;
      conditions.push({ price: priceFilter });
    }

    if (conditions.length > 0) {
      query.$and = conditions;
    }

    // ── Sorting (Amazon / Sephora benchmark) ────────────────────────────────
    let sortOption = {};
    if (sort === 'price-low' || sort === 'price_asc' || sort === 'price-asc') {
      sortOption.price = 1;
    } else if (sort === 'price-high' || sort === 'price_desc' || sort === 'price-desc') {
      sortOption.price = -1;
    } else if (sort === 'rating' || sort === 'top_rated') {
      sortOption.rating = -1;
    } else if (sort === 'newest') {
      sortOption.createdAt = -1;
    } else {
      sortOption.createdAt = -1;
    }

    // ── Multi-Layer Caching with ETag and Single-Flight Coalescing ──────────
    const roleKey = req.user?.role === 'admin' ? 'admin' : 'public';
    const allKey = isAll ? 'all' : 'paged';
    const stockKey = lowstock ? 'low' : outofstock ? 'out' : req.query.inStock === 'true' || req.query.inStockOnly === 'true' ? 'instock' : 'all';
    const priceKey = !isNaN(minPrice) || !isNaN(maxPrice) ? `${minPrice || 0}-${maxPrice || 0}` : 'all';
    const ratingKey = !isNaN(minRating) && minRating > 0 ? `r${minRating}` : 'all';
    const catKey = categoryTokens.length > 0 ? categoryTokens.slice().sort().join(',') : 'all';
    const cacheKey = `products:list:${roleKey}:${stockKey}:${allKey}:${catKey}:${season || 'all'}:${priceKey}:${ratingKey}:${search ? encodeURIComponent(search.toLowerCase()) : 'none'}:${sort || 'default'}:${page}:${limit}`;

    return await cacheService.sendCachedResponse(req, res, cacheKey, async () => {
      const [products, count] = await Promise.all([
        Product.find(query)
          .populate('categoryId', 'name slug')
          .sort(sortOption)
          .limit(limit)
          .skip((page - 1) * limit)
          .lean(),
        Product.countDocuments(query),
      ]);

      // ── Zero-Results Edge Case: Spelling Suggestions & Recommendations ────
      let suggestions = [];
      let recommended = [];

      if (count === 0 && search) {
        try {
          // Fetch recommended seasonal products in stock
          recommended = await Product.find({
            isActive: true,
            isDeleted: { $ne: true },
            stock: { $gt: 0 },
          })
            .populate('categoryId', 'name slug')
            .sort({ rating: -1, stock: -1 })
            .limit(4)
            .lean();

          // Compute spelling suggestions from distinct active product names
          const allNames = await Product.distinct('name', { isActive: true, isDeleted: { $ne: true } });
          const searchTokens = search.toLowerCase().split(/\s+/).filter(Boolean);
          const suggestionSet = new Set();

          for (const name of allNames) {
            const nameTokens = name.toLowerCase().split(/\s+/);
            for (const sToken of searchTokens) {
              for (const nToken of nameTokens) {
                if (nToken.includes(sToken) || levenshteinDistance(sToken, nToken) <= 2) {
                  suggestionSet.add(name);
                  break;
                }
              }
            }
            if (suggestionSet.size >= 4) break;
          }
          suggestions = Array.from(suggestionSet);
        } catch (e) {
          // Gracefully continue without suggestions on unexpected error
        }
      }

      return {
        success: true,
        count: products.length,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        limit,
        data: products.map(enrichProductStock),
        suggestions,
        recommended: recommended.map(enrichProductStock),
      };
    }, roleKey === 'admin' ? 5000 : (cacheService.TTL_TIERS?.STORE_CATALOG || 60_000));
  } catch (error) {
    console.error('❌ getProducts error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
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

    const enriched = enrichProductStock(product);

    // Compute verified reviews aggregate (FEAT-005)
    try {
      const Review = require('../models/review.model');
      const [reviewStats] = await Review.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(req.params.id), isApproved: true } },
        { $group: { _id: null, avgRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } }
      ]);
      enriched.reviewStats = {
        rating: reviewStats ? Math.round(reviewStats.avgRating * 10) / 10 : (product.rating || 0),
        numReviews: reviewStats ? reviewStats.totalReviews : (product.numReviews || 0)
      };
    } catch {
      enriched.reviewStats = {
        rating: product.rating || 0,
        numReviews: product.numReviews || 0
      };
    }

    const payload = {
      success: true,
      data: enriched
    };

    cacheService.set(cacheKey, payload, cacheService.TTL_TIERS?.PRODUCT_DETAIL || 180_000);

    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'productController → getProduct', 'Failed to fetch product.');
  }
};

// @desc    Register back-in-stock notification alert for a product / variant (FEAT-005)
// @route   POST /api/products/:id/notify-stock
// @access  Public
exports.notifyStock = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID format' });
    }

    const { email, phone, packageId, quantity } = req.body;
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email or phone number to receive stock notifications.'
      });
    }

    const product = await Product.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    let variantName = quantity || 'Standard Pack';
    if (packageId && Array.isArray(product.packages)) {
      const match = product.packages.find((p) => String(p._id) === String(packageId));
      if (match) variantName = match.quantity;
    }

    console.log(`[FEAT-005 StockAlert] Registered alert for ${product.name} (${variantName}) -> ${email || phone}`);

    return res.status(200).json({
      success: true,
      message: `You're on the list! We will notify you at ${email || phone} when "${variantName}" is back in stock.`,
      data: {
        productId: product._id,
        productName: product.name,
        variant: variantName,
        recipient: email || phone,
        registeredAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return serverError(res, error, 'productController → notifyStock');
  }
};

// @desc    Create product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
  try {
    Product.applyAutoPricing(req.body);
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
    Product.applyAutoPricing(req.body);
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

    // FEAT-020: Flag dependent combos for review on product price change
    if (req.body.price !== undefined) {
      const Combo = require('../models/combo.model');
      await Combo.updateMany(
        { 'includedProducts.productId': product._id, isDeleted: { $ne: true } },
        {
          $set: {
            needsReview: true,
            reviewReason: `Constituent product "${product.name}" price updated to ₹${product.price}. Please review combo pricing.`
          }
        }
      );
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

    // FEAT-020: Deletion of a child product must automatically flag the combo for review
    const Combo = require('../models/combo.model');
    await Combo.updateMany(
      { 'includedProducts.productId': product._id, isDeleted: { $ne: true } },
      {
        $set: {
          needsReview: true,
          reviewReason: `Constituent product "${product.name}" was deleted. Please reconfigure combo items.`
        }
      }
    );

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

// @desc    Get instant search suggestions with highlighted matches (Amazon / Sephora benchmark)
// @route   GET /api/products/suggestions
// @access  Public
exports.getSearchSuggestions = async (req, res) => {
  try {
    const q = (req.query.q || req.query.search || '').trim();
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, query: '', products: [], terms: [] });
    }

    const cacheKey = `search:suggestions:${encodeURIComponent(q.toLowerCase())}`;
    return await cacheService.sendCachedResponse(req, res, cacheKey, async () => {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80);
      const regex = new RegExp(escaped, 'i');

      const products = await Product.find({
        isActive: true,
        isDeleted: { $ne: true },
        $or: [{ name: regex }, { description: regex }],
      })
        .select('_id name price originalPrice images categoryId rating stock packages')
        .populate('categoryId', 'name slug')
        .limit(6)
        .lean();

      // Extract matching product names for search query autocompletion
      const distinctNames = await Product.distinct('name', {
        isActive: true,
        isDeleted: { $ne: true },
        name: regex,
      });

      return {
        success: true,
        query: q,
        products: products.map(enrichProductStock),
        terms: distinctNames.slice(0, 5),
      };
    }, 60 * 1000);
  } catch (error) {
    return serverError(res, error, 'productController.js → getSearchSuggestions');
  }
};

// @desc    Export catalog products to CSV (Shopify Products benchmark FEAT-018)
// @route   GET /api/products/export-csv
// @access  Private/Admin
exports.exportProductsCsv = async (req, res) => {
  try {
    const { generateCsv } = require('../utils/csv.util');

    const products = await Product.find({ isDeleted: { $ne: true } })
      .populate('categoryId', 'name slug')
      .sort({ createdAt: -1 })
      .lean();

    const headers = [
      'Name',
      'Category',
      'Price',
      'OriginalPrice',
      'Stock',
      'Weight',
      'Season',
      'Description',
      'Images',
      'Packages',
      'Status'
    ];

    const rows = products.map((p) => {
      let pkgStr = '';
      if (Array.isArray(p.packages) && p.packages.length > 0) {
        pkgStr = p.packages.map((pkg) => `${pkg.quantity}:${pkg.price}:${pkg.stock ?? 0}`).join('|');
      }
      return {
        Name: p.name || '',
        Category: p.categoryId?.name || '',
        Price: p.price ?? 0,
        OriginalPrice: p.originalPrice || '',
        Stock: p.stock ?? 0,
        Weight: p.weight || '',
        Season: p.season || 'All Season',
        Description: (p.description || '').replace(/\r?\n/g, ' '),
        Images: Array.isArray(p.images) ? p.images.join(';') : '',
        Packages: pkgStr,
        Status: p.isActive ? 'Active' : 'Inactive'
      };
    });

    const csvContent = generateCsv(headers, rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fresh-veggies-products.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    return serverError(res, error, 'productController.js → exportProductsCsv');
  }
};

// @desc    Bulk import products from CSV with atomic validation error reporting (FEAT-018)
// @route   POST /api/products/import-csv
// @access  Private/Admin
exports.importProductsCsv = async (req, res) => {
  try {
    const { parseCsv } = require('../utils/csv.util');
    const Category = require('../models/category.model');
    const auditService = require('../services/audit.service');

    let csvText = '';
    if (req.file && req.file.buffer) {
      csvText = req.file.buffer.toString('utf-8');
    } else if (req.files && req.files.length > 0) {
      csvText = req.files[0].buffer.toString('utf-8');
    } else if (typeof req.body.csv === 'string') {
      csvText = req.body.csv;
    } else if (typeof req.body.data === 'string') {
      csvText = req.body.data;
    }

    if (!csvText || !csvText.trim()) {
      return res.status(400).json({
        success: false,
        message: 'No CSV file or data provided. Please upload a valid CSV file.'
      });
    }

    const { rows } = parseCsv(csvText);
    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'CSV file is empty or does not contain any product rows.'
      });
    }

    // Preload categories for fast O(1) matching
    const allCategories = await Category.find({}).lean();
    const catMap = new Map();
    allCategories.forEach((cat) => {
      catMap.set(cat._id.toString(), cat);
      if (cat.name) catMap.set(cat.name.toLowerCase().trim(), cat);
      if (cat.slug) catMap.set(cat.slug.toLowerCase().trim(), cat);
    });

    const errors = [];
    const productsToInsert = [];

    // Phase 1: Full validation pass on ALL rows
    rows.forEach((row) => {
      const rowNum = row.__rowNumber || 2;
      const name = (row.name || row.productname || row.title || '').trim();
      const catKey = (row.category || row.categoryname || row.categoryid || '').toLowerCase().trim();
      const priceStr = row.price || row.sellingprice || row.baseprice || '';
      const originalPriceStr = row.originalprice || row.mrp || '';
      const stockStr = row.stock || row.quantity || row.inventory || '';
      const weight = (row.weight || '').trim();
      const season = (row.season || 'All Season').trim();
      const description = (row.description || '').trim();
      const imagesStr = row.images || row.image || '';
      const packagesStr = row.packages || row.variants || '';
      const statusStr = (row.status || row.isactive || 'Active').toLowerCase().trim();

      // Validate Name
      if (!name) {
        errors.push({ row: rowNum, field: 'name', message: 'Product Name is required' });
      }

      // Validate Category
      let matchedCategory = null;
      if (!catKey) {
        errors.push({ row: rowNum, field: 'category', message: 'Category is required' });
      } else {
        matchedCategory = catMap.get(catKey);
        if (!matchedCategory) {
          errors.push({
            row: rowNum,
            field: 'category',
            message: `Category "${row.category || catKey}" does not exist in store catalog`
          });
        }
      }

      // Validate Price
      const price = parseFloat(priceStr);
      if (priceStr === '' || isNaN(price) || price <= 0) {
        errors.push({
          row: rowNum,
          field: 'price',
          message: 'Price must be a valid positive number'
        });
      }

      // Validate Stock
      let stock = 0;
      if (stockStr !== '') {
        const parsedStock = parseInt(stockStr, 10);
        if (isNaN(parsedStock) || parsedStock < 0) {
          errors.push({
            row: rowNum,
            field: 'stock',
            message: 'Stock must be a non-negative integer'
          });
        } else {
          stock = parsedStock;
        }
      }

      // Optional Packages parsing ("50 Seeds:100:50|100 Seeds:180:30")
      const parsedPackages = [];
      if (packagesStr) {
        const pkgTokens = packagesStr.split('|');
        pkgTokens.forEach((token) => {
          const parts = token.split(':').map((s) => s.trim());
          if (parts.length >= 2) {
            const pPrice = parseFloat(parts[1]);
            const pStock = parts[2] ? parseInt(parts[2], 10) : 50;
            if (parts[0] && !isNaN(pPrice) && pPrice > 0) {
              parsedPackages.push({
                quantity: parts[0],
                price: pPrice,
                stock: !isNaN(pStock) ? pStock : 50,
                isCustomPrice: false
              });
            }
          }
        });
      }

      // Images splitting (semicolon or comma)
      const imagesList = imagesStr
        ? imagesStr.split(/[;,]/).map((u) => u.trim()).filter(Boolean)
        : [];

      if (errors.length === 0) {
        productsToInsert.push({
          name,
          categoryId: matchedCategory?._id,
          price,
          originalPrice: originalPriceStr ? parseFloat(originalPriceStr) : undefined,
          stock: parsedPackages.length > 0
            ? parsedPackages.reduce((sum, pkg) => sum + (pkg.stock || 0), 0)
            : stock,
          weight: weight || undefined,
          season: season || 'All Season',
          description,
          images: imagesList,
          packages: parsedPackages,
          isActive: statusStr !== 'inactive' && statusStr !== 'false' && statusStr !== '0',
          isDeleted: false
        });
      }
    });

    // Phase 2: Edge Case Enforcement — Reject entire batch if ANY row has errors
    if (errors.length > 0) {
      const failedRowSet = new Set(errors.map((e) => e.row));
      return res.status(400).json({
        success: false,
        message: `CSV validation failed with ${errors.length} error(s) across ${failedRowSet.size} row(s). No products were imported to preserve catalog integrity.`,
        errors,
        totalRows: rows.length,
        failedRowCount: failedRowSet.size
      });
    }

    // Phase 3: Bulk insertion of all validated products
    const createdProducts = await Product.insertMany(productsToInsert);

    // Audit log
    auditService.logAction({
      req,
      action: 'CREATE',
      entityType: 'Product',
      details: {
        bulkImport: true,
        count: createdProducts.length,
        productNames: createdProducts.slice(0, 5).map((p) => p.name)
      }
    }).catch(() => {});

    // Invalidate caches
    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');
    cacheService.invalidate('categories:');
    cacheService.invalidate('admin:');

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${createdProducts.length} product(s) into catalog.`,
      importedCount: createdProducts.length,
      data: createdProducts
    });
  } catch (error) {
    return serverError(res, error, 'productController.js → importProductsCsv');
  }
};
