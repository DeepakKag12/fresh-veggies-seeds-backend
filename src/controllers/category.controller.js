const Category = require('../models/category.model');
const auditService = require('../services/audit.service');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    const includeAll = req.query.all === 'true';
    const cacheKey = includeAll ? null : 'categories:all';
    if (cacheKey) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        return res.status(200).json(cached);
      }
    }

    const filter = includeAll
      ? { isDeleted: { $ne: true } }
      : { isActive: true, isDeleted: { $ne: true } };
    const categories = await Category.find(filter)
      .populate('parentCategory', 'name slug')
      .sort({ name: 1 }) // Sort alphabetically by name
      .lean();

    // Define desired order
    const order = ['Vegetable Seeds', 'Flower Seeds', 'Grow Bags', 'Soil & Fertilizers', 'Tools', 'Herbs'];

    // Sort categories based on the defined order
    const sortedCategories = categories.sort((a, b) => {
      const indexA = order.indexOf(a.name);
      const indexB = order.indexOf(b.name);

      // If both are in the order array, sort by their index
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      // If only a is in the array, it comes first
      if (indexA !== -1) return -1;
      // If only b is in the array, it comes first
      if (indexB !== -1) return 1;
      // If neither is in the array, maintain original order
      return 0;
    });

    const payload = {
      success: true,
      count: sortedCategories.length,
      data: sortedCategories
    };

    // Cache categories in memory for 5 minutes (auto-invalidated on admin mutations)
    cacheService.set('categories:all', payload, 5 * 60 * 1000);

    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'categoryController.js → getCategories');
  }
};

// @desc    Get single category
// @route   GET /api/categories/:id
// @access  Public
exports.getCategory = async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('parentCategory', 'name slug')
      .lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → getCategory');
  }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res) => {
  try {
    const category = await Category.create(req.body);

    cacheService.invalidate('categories:');
    cacheService.invalidate('products:');

    // Audit log
    await auditService.logAction({
      actor: req.user,
      action: 'CREATE',
      entityType: 'Category',
      entityId: category._id,
      entityName: category.name,
      details: { name: category.name, slug: category.slug },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → createCategory');
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
  try {
    // Sync slug with updated name if slug is not explicitly provided
    if (req.body.name && !req.body.slug) {
      req.body.slug = req.body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      req.body,
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    cacheService.invalidate('categories:');
    cacheService.invalidate('products:');

    // Audit log
    await auditService.logAction({
      actor: req.user,
      action: 'UPDATE',
      entityType: 'Category',
      entityId: category._id,
      entityName: category.name,
      details: req.body,
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → updateCategory');
  }
};

// @desc    Delete category (Soft delete with recovery ledger)
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
  try {
    const Product = require('../models/product.model');
    const associatedProducts = await Product.countDocuments({
      categoryId: req.params.id,
      isDeleted: { $ne: true }
    });
    if (associatedProducts > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category: ${associatedProducts} active product(s) are still assigned to it. Please reassign or delete them first.`
      });
    }

    const category = await Category.findOne({ _id: req.params.id, isDeleted: { $ne: true } });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    category.isDeleted = true;
    category.isActive = false;
    category.deletedAt = new Date();
    category.deletedBy = req.user ? req.user._id : null;
    category.deletionReason = req.body?.reason || 'Category removed by administrator';
    await category.save();

    // Ledger deletion & audit log
    await auditService.logDeletion({
      actor: req.user,
      entityType: 'Category',
      entityId: category._id,
      entityName: category.name,
      snapshot: category.toObject(),
      reason: category.deletionReason,
      ipAddress: req.ip
    });

    cacheService.invalidate('categories:');
    cacheService.invalidate('products:');

    res.status(200).json({
      success: true,
      message: 'Category moved to Delete History. It can be safely restored at any time.'
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → deleteCategory');
  }
};
