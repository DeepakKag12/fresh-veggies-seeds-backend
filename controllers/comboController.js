const Combo = require('../models/Combo');

// @desc    Get all combos
// @route   GET /api/combos
// @access  Public
exports.getCombos = async (req, res) => {
  try {
    const combos = await Combo.find({ isActive: true })
      .populate('includedProducts.productId', 'name price images')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: combos.length,
      data: combos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single combo
// @route   GET /api/combos/:id
// @access  Public
exports.getCombo = async (req, res) => {
  try {
    const combo = await Combo.findById(req.params.id)
      .populate('includedProducts.productId', 'name price images description');

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
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
