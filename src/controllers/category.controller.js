const Category = require('../models/category.model');
const auditService = require('../services/audit.service');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// Slugify helper
const slugify = (text) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
};

// Collision detection: e.g. leafy-greens -> leafy-greens-1 -> leafy-greens-2
const generateUniqueSlug = async (name, excludeId = null, customSlug = '') => {
  const base = (customSlug || name || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');

  const baseSlug = base || `category-${Date.now()}`;
  let candidateSlug = baseSlug;
  let counter = 1;

  while (true) {
    const query = {
      slug: candidateSlug,
      isDeleted: { $ne: true }
    };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    const match = await Category.findOne(query);
    if (!match) {
      return candidateSlug;
    }
    candidateSlug = `${baseSlug}-${counter}`;
    counter++;
  }
};

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    const includeAll = req.query.all === 'true';
    const cacheKey = includeAll ? 'categories:admin:all' : 'categories:all';

    return await cacheService.sendCachedResponse(req, res, cacheKey, async () => {
      const filter = includeAll
        ? { isDeleted: { $ne: true } }
        : { isActive: true, isDeleted: { $ne: true } };
      const categories = await Category.find(filter)
        .populate('parentCategory', 'name slug')
        .sort({ order: 1, name: 1 })
        .lean();

      // Aggregate product counts per category
      const Product = require('../models/product.model');
      const counts = await Product.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$categoryId', count: { $sum: 1 } } }
      ]);
      const countMap = {};
      counts.forEach(c => {
        if (c._id) {
          countMap[c._id.toString()] = c.count;
        }
      });

      const categoriesWithCount = categories.map((cat, idx) => ({
        ...cat,
        order: typeof cat.order === 'number' && cat.order !== 0 ? cat.order : (idx + 1),
        productCount: countMap[cat._id.toString()] || 0
      }));

      // Sort categories: respect order field if set, fallback to default order list, then alphabetical
      const defaultOrder = ['Vegetable Seeds', 'Flower Seeds', 'Grow Bags', 'Soil & Fertilizers', 'Tools', 'Herbs'];
      const sortedCategories = categoriesWithCount.sort((a, b) => {
        const orderA = typeof a.order === 'number' && a.order !== 0 ? a.order : null;
        const orderB = typeof b.order === 'number' && b.order !== 0 ? b.order : null;
        if (orderA !== null && orderB !== null && orderA !== orderB) {
          return orderA - orderB;
        }
        if (orderA !== null && orderB === null) return -1;
        if (orderB !== null && orderA === null) return 1;

        const indexA = defaultOrder.indexOf(a.name);
        const indexB = defaultOrder.indexOf(b.name);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        count: sortedCategories.length,
        data: sortedCategories
      };
    }, cacheService.TTL_TIERS?.STORE_CATALOG || 60_000);
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

    const Product = require('../models/product.model');
    const productCount = await Product.countDocuments({
      categoryId: category._id,
      isDeleted: { $ne: true }
    });

    res.status(200).json({
      success: true,
      data: {
        ...category,
        productCount
      }
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
    const rawName = (req.body.name || '').trim();
    if (!rawName) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check for existing active category with identical name
    const escapedName = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingActive = await Category.findOne({
      name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
      isDeleted: { $ne: true }
    });

    if (existingActive) {
      return res.status(400).json({
        success: false,
        message: `A category named "${rawName}" already exists.`
      });
    }

    // Generate unique slug with collision detection (leafy-greens-1, etc.)
    const uniqueSlug = await generateUniqueSlug(rawName, null, req.body.slug);

    // Check if category previously existed and was soft-deleted — reactivate it cleanly
    const softDeleted = await Category.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${escapedName}$`, 'i') } },
        { slug: uniqueSlug }
      ],
      isDeleted: true
    });

    let category;
    if (softDeleted) {
      softDeleted.name = rawName;
      softDeleted.slug = uniqueSlug;
      softDeleted.description = req.body.description !== undefined ? req.body.description : softDeleted.description;
      softDeleted.icon = req.body.icon !== undefined ? req.body.icon : softDeleted.icon;
      softDeleted.image = req.body.image !== undefined ? req.body.image : softDeleted.image;
      softDeleted.order = req.body.order !== undefined ? req.body.order : softDeleted.order;
      softDeleted.isActive = req.body.isActive !== undefined ? req.body.isActive : true;
      softDeleted.showInCircle = req.body.showInCircle !== false;
      softDeleted.isDeleted = false;
      softDeleted.deletedAt = null;
      softDeleted.deletedBy = null;
      softDeleted.deletionReason = '';
      category = await softDeleted.save();
    } else {
      let nextOrder = req.body.order;
      if (nextOrder === undefined || nextOrder === null) {
        const lastCat = await Category.findOne({ isDeleted: { $ne: true } }).sort({ order: -1 }).select('order');
        nextOrder = (lastCat?.order || 0) + 1;
      }

      category = await Category.create({
        ...req.body,
        name: rawName,
        slug: uniqueSlug,
        order: nextOrder
      });
    }

    cacheService.invalidate('categories:');
    cacheService.invalidate('products:');

    // Audit log
    await auditService.logAction({
      actor: req.user,
      action: 'CREATE',
      entityType: 'Category',
      entityId: category._id,
      entityName: category.name,
      details: { name: category.name, slug: category.slug, order: category.order },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A category with this name or slug already exists.'
      });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }
    return serverError(res, error, 'categoryController.js → createCategory');
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
  try {
    const rawName = req.body.name ? req.body.name.trim() : undefined;
    if (req.body.name !== undefined && !rawName) {
      return res.status(400).json({
        success: false,
        message: 'Category name cannot be empty'
      });
    }

    // Check for duplicate name in other categories
    if (rawName) {
      const escapedName = rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicate = await Category.findOne({
        _id: { $ne: req.params.id },
        name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
        isDeleted: { $ne: true }
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: `Another category named "${rawName}" already exists.`
        });
      }
    }

    if (req.body.slug !== undefined || rawName) {
      const existingDoc = await Category.findById(req.params.id);
      const targetName = rawName || existingDoc?.name || '';
      req.body.slug = await generateUniqueSlug(targetName, req.params.id, req.body.slug);
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
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A category with this name or slug already exists.'
      });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }
    return serverError(res, error, 'categoryController.js → updateCategory');
  }
};

// @desc    Reorder category hierarchy
// @route   PUT /api/categories/reorder
// @access  Private/Admin
exports.reorderCategories = async (req, res) => {
  try {
    const { categoryIds, items } = req.body;

    if (Array.isArray(categoryIds) && categoryIds.length > 0) {
      const bulkOps = categoryIds.map((id, index) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { order: index + 1 } }
        }
      }));
      await Category.bulkWrite(bulkOps);
    } else if (Array.isArray(items) && items.length > 0) {
      const bulkOps = items.map((item, index) => ({
        updateOne: {
          filter: { _id: item.id || item._id },
          update: { $set: { order: typeof item.order === 'number' ? item.order : index + 1 } }
        }
      }));
      await Category.bulkWrite(bulkOps);
    } else {
      return res.status(400).json({
        success: false,
        message: 'categoryIds array or items array is required for reordering'
      });
    }

    cacheService.invalidate('categories:');
    cacheService.invalidate('products:');

    // Audit log
    await auditService.logAction({
      actor: req.user,
      action: 'UPDATE',
      entityType: 'Category',
      details: { action: 'REORDER_CATEGORIES' },
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Category hierarchy reordered successfully'
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → reorderCategories');
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
        message: `Cannot delete category with ${associatedProducts} assigned products. Reassign products first.`
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

