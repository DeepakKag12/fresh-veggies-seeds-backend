const Combo = require('../models/combo.model');
const auditService = require('../services/audit.service');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// @desc    Get all combos
// @route   GET /api/combos
// @access  Public
exports.getCombos = async (req, res) => {
  try {
    const cached = cacheService.get('combos:all');
    if (cached) {
      return res.status(200).json(cached);
    }

    const combos = await Combo.find({ isActive: true, isDeleted: { $ne: true } })
      .populate('includedProducts.productId', 'name price images')
      .sort({ createdAt: -1 })
      .lean();

    const payload = {
      success: true,
      count: combos.length,
      data: combos
    };

    cacheService.set('combos:all', payload, 2 * 60 * 1000); // 2 min TTL

    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'comboController.js → getCombos');
  }
};

// @desc    Get single combo
// @route   GET /api/combos/:id
// @access  Public
exports.getCombo = async (req, res) => {
  try {
    const cacheKey = `combos:${req.params.id}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const combo = await Combo.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('includedProducts.productId', 'name price images description')
      .lean();

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    const payload = {
      success: true,
      data: combo
    };

    cacheService.set(cacheKey, payload, 2 * 60 * 1000);

    res.status(200).json(payload);
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

    cacheService.invalidate('combos:');

    await auditService.logAction({
      actor: req.user,
      action: 'CREATE',
      entityType: 'Combo',
      entityId: combo._id,
      entityName: combo.name,
      details: { name: combo.name, price: combo.price },
      ipAddress: req.ip
    });

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
    const combo = await Combo.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      req.body,
      { new: true, runValidators: true }
    );

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    cacheService.invalidate('combos:');

    await auditService.logAction({
      actor: req.user,
      action: 'UPDATE',
      entityType: 'Combo',
      entityId: combo._id,
      entityName: combo.name,
      details: req.body,
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      data: combo
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → updateCombo');
  }
};

// @desc    Delete combo (Soft delete with recovery ledger)
// @route   DELETE /api/combos/:id
// @access  Private/Admin
exports.deleteCombo = async (req, res) => {
  try {
    const combo = await Combo.findOne({ _id: req.params.id, isDeleted: { $ne: true } });

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    combo.isDeleted = true;
    combo.isActive = false;
    combo.deletedAt = new Date();
    combo.deletedBy = req.user ? req.user._id : null;
    combo.deletionReason = req.body?.reason || 'Combo removed by administrator';
    await combo.save();

    await auditService.logDeletion({
      actor: req.user,
      entityType: 'Combo',
      entityId: combo._id,
      entityName: combo.name,
      snapshot: combo.toObject(),
      reason: combo.deletionReason,
      ipAddress: req.ip
    });

    cacheService.invalidate('combos:');

    res.status(200).json({
      success: true,
      message: 'Combo moved to Delete History. It can be safely restored at any time.'
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → deleteCombo');
  }
};
