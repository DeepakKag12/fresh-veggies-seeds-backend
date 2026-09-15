const Category = require('../models/Category');
const cacheService = require('../utils/cacheService');
const { serverError } = require('../utils/respond');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    const cached = cacheService.get('categories:all');
    if (cached) {
      return res.status(200).json(cached);
    }

    const categories = await Category.find({ isActive: true })
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
    const category = await Category.findById(req.params.id)
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
    const category = await Category.findByIdAndUpdate(
      req.params.id,
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

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → updateCategory');
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    cacheService.invalidate('categories:');
    cacheService.invalidate('products:');

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'categoryController.js → deleteCategory');
  }
};
