const Combo = require('../models/Combo');
const { serverError } = require('../utils/respond');

// @desc    Get all combos
// @route   GET /api/combos
// @access  Public
exports.getCombos = async (req, res) => {
  try {
    const combos = await Combo.find({ isActive: true })
      .populate('includedProducts.productId', 'name price images')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: combos.length,
      data: combos
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → getCombos');
  }
};

// @desc    Get single combo
// @route   GET /api/combos/:id
// @access  Public
exports.getCombo = async (req, res) => {
  try {
    const combo = await Combo.findById(req.params.id)
      .populate('includedProducts.productId', 'name price images description')
      .lean();

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    res.status(200).json({
      success: true,
      data: combo
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → getCombo');
  }
};

// @desc    Create combo
// @route   POST /api/combos
// @access  Private/Admin
exports.createCombo = async (req, res) => {
  try {
    const combo = await Combo.create(req.body);

    res.status(201).json({
      success: true,
      data: combo
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → createCombo');
  }
};

// @desc    Update combo
// @route   PUT /api/combos/:id
// @access  Private/Admin
exports.updateCombo = async (req, res) => {
  try {
    const combo = await Combo.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    res.status(200).json({
      success: true,
      data: combo
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → updateCombo');
  }
};

// @desc    Delete combo
// @route   DELETE /api/combos/:id
// @access  Private/Admin
exports.deleteCombo = async (req, res) => {
  try {
    const combo = await Combo.findByIdAndDelete(req.params.id);

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Combo deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → deleteCombo');
  }
};
