const Combo = require('../models/combo.model');
const auditService = require('../services/audit.service');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// @desc    Get all combos
// @route   GET /api/combos
// @access  Public
const mongoose = require('mongoose');

// Helper to normalize and validate included products in combos
const normalizeIncludedProducts = (rawProducts) => {
  if (!Array.isArray(rawProducts)) return [];
  const map = new Map();
  for (const item of rawProducts) {
    if (!item) continue;
    const rawId = item.productId?._id || item.productId || item.id;
    if (!rawId) continue;
    const idStr = rawId.toString();
    if (!mongoose.Types.ObjectId.isValid(idStr)) continue;
    const qty = Math.max(1, parseInt(item.quantity) || 1);
    // If the same product was selected multiple times, merge quantities
    if (map.has(idStr)) {
      map.set(idStr, map.get(idStr) + qty);
    } else {
      map.set(idStr, qty);
    }
  }
  return Array.from(map.entries()).map(([productId, quantity]) => ({
    productId,
    quantity
  }));
};

// Helper to compute bundle stock dependency and price economics (Amazon / HelloFresh benchmark)
const enrichComboWithStockAndEconomics = (combo) => {
  if (!combo) return combo;

  const items = Array.isArray(combo.includedProducts) ? combo.includedProducts : [];

  let computedOriginalPrice = 0;
  let childOutOfStock = false;
  let missingOrOutItemName = null;
  const childStocks = [];

  items.forEach((item) => {
    const p = item.productId;
    const reqQty = Math.max(1, parseInt(item.quantity) || 1);

    if (!p || p.isDeleted || p.isActive === false) {
      childOutOfStock = true;
      missingOrOutItemName = p ? p.name : 'Discontinued Item';
      childStocks.push(0);
      return;
    }

    const price = typeof p.price === 'number' ? p.price : 0;
    computedOriginalPrice += price * reqQty;

    const availableStock = typeof p.stock === 'number' ? p.stock : 0;
    const maxSets = Math.floor(availableStock / reqQty);
    childStocks.push(maxSets);

    if (maxSets <= 0) {
      childOutOfStock = true;
      missingOrOutItemName = p.name;
    }
  });

  const originalPrice =
    typeof combo.originalPrice === 'number' && combo.originalPrice > 0
      ? combo.originalPrice
      : computedOriginalPrice > 0
      ? computedOriginalPrice
      : combo.price;

  const savings = Math.max(0, originalPrice - combo.price);
  const savingsPct = originalPrice > 0 ? Math.round((savings / originalPrice) * 100) : 0;

  const maxFromChildren = childStocks.length > 0 ? Math.min(...childStocks) : 0;
  const nominalStock = typeof combo.stock === 'number' ? combo.stock : 0;
  const effectiveStock = Math.min(nominalStock, maxFromChildren);

  const isAvailable = combo.isActive && !combo.isDeleted && effectiveStock > 0 && !childOutOfStock;

  return {
    ...combo,
    originalPrice,
    computedOriginalPrice,
    savings,
    savingsPct,
    discount: savingsPct,
    effectiveStock,
    dynamicStock: maxFromChildren,
    needsReview: Boolean(combo.needsReview || (childOutOfStock && !missingOrOutItemName?.includes('out of stock'))),
    reviewReason: combo.reviewReason || (childOutOfStock ? `Constituent product "${missingOrOutItemName}" requires attention` : ''),
    isAvailable,
    availabilityStatus: isAvailable
      ? effectiveStock <= 5
        ? `Only ${effectiveStock} left`
        : 'In Stock'
      : 'Temporarily Unavailable',
    unavailableReason: childOutOfStock
      ? `Temporarily Unavailable ("${missingOrOutItemName}" is out of stock)`
      : effectiveStock <= 0
      ? 'Out of Stock'
      : null,
  };
};

// @desc    Get all combos
// @route   GET /api/combos
// @access  Public
exports.getCombos = async (req, res) => {
  try {
    const isAll = req.query.all === 'true' || req.user?.role === 'admin';
    const noCache = req.query.nocache === 'true' || req.headers['cache-control'] === 'no-cache';
    const cacheKey = isAll ? 'combos:all:admin' : 'combos:all:public';
    const cached = cacheService.get(cacheKey);
    if (!noCache && cached) {
      return res.status(200).json(cached);
    }

    const query = { isDeleted: { $ne: true } };
    if (!isAll) {
      query.isActive = true;
    }

    const combos = await Combo.find(query)
      .populate('includedProducts.productId', 'name price originalPrice images stock isActive isDeleted')
      .sort({ createdAt: -1 })
      .lean();

    const enriched = combos.map(enrichComboWithStockAndEconomics);

    const payload = {
      success: true,
      count: enriched.length,
      data: enriched
    };

    cacheService.set(cacheKey, payload, 2 * 60 * 1000); // 2 min TTL

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
    const noCache = req.query.nocache === 'true' || req.headers['cache-control'] === 'no-cache';
    const cacheKey = `combos:${req.params.id}`;
    const cached = cacheService.get(cacheKey);
    if (!noCache && cached) {
      return res.status(200).json(cached);
    }

    const combo = await Combo.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate('includedProducts.productId', 'name price originalPrice images description stock isActive isDeleted')
      .lean();

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    const payload = {
      success: true,
      data: enrichComboWithStockAndEconomics(combo)
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
    const comboPayload = { ...req.body };

    const normalized = normalizeIncludedProducts(comboPayload.includedProducts);
    if (normalized.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'A combo bundle must contain at least 2 distinct products.'
      });
    }

    // Validate that all referenced products exist
    const Product = require('../models/product.model');
    const productIds = normalized.map(p => p.productId);
    const existingProducts = await Product.find({
      _id: { $in: productIds },
      isDeleted: { $ne: true }
    });

    if (existingProducts.length !== productIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more selected products do not exist or have been removed.'
      });
    }

    // Dynamic bundle inventory calculation based on child product stock
    let minSets = Infinity;
    let computedOriginalPrice = 0;
    for (const item of normalized) {
      const prod = existingProducts.find(p => p._id.toString() === item.productId.toString());
      const stock = typeof prod?.stock === 'number' ? prod.stock : 0;
      const maxSets = Math.floor(stock / item.quantity);
      if (maxSets < minSets) minSets = maxSets;
      computedOriginalPrice += (prod?.price || 0) * item.quantity;
    }
    const dynamicStock = minSets === Infinity ? 0 : minSets;

    comboPayload.includedProducts = normalized;
    comboPayload.dynamicStock = dynamicStock;
    if (comboPayload.stock === undefined || comboPayload.stock === null || comboPayload.stock === '') {
      comboPayload.stock = dynamicStock;
    } else {
      comboPayload.stock = Math.min(parseInt(comboPayload.stock) || 0, dynamicStock);
    }

    if (!comboPayload.originalPrice || Number(comboPayload.originalPrice) === 0) {
      comboPayload.originalPrice = computedOriginalPrice;
    }
    if (comboPayload.originalPrice > 0 && comboPayload.price) {
      comboPayload.discount = Math.max(0, Math.round(((comboPayload.originalPrice - comboPayload.price) / comboPayload.originalPrice) * 100));
    }

    comboPayload.needsReview = false;
    comboPayload.reviewReason = '';

    const combo = await Combo.create(comboPayload);

    cacheService.invalidate('combos:');

    await auditService.logAction({
      actor: req.user,
      action: 'CREATE',
      entityType: 'Combo',
      entityId: combo._id,
      entityName: combo.name,
      details: { name: combo.name, price: combo.price, dynamicStock },
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
    const updatePayload = { ...req.body };

    if (updatePayload.includedProducts !== undefined) {
      const normalized = normalizeIncludedProducts(updatePayload.includedProducts);
      if (normalized.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'A combo bundle must contain at least 2 distinct products.'
        });
      }

      // Validate that all referenced products exist
      const Product = require('../models/product.model');
      const productIds = normalized.map(p => p.productId);
      const existingProducts = await Product.find({
        _id: { $in: productIds },
        isDeleted: { $ne: true }
      });

      if (existingProducts.length !== productIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more selected products do not exist or have been removed.'
        });
      }

      // Dynamic bundle inventory calculation based on child product stock
      let minSets = Infinity;
      let computedOriginalPrice = 0;
      for (const item of normalized) {
        const prod = existingProducts.find(p => p._id.toString() === item.productId.toString());
        const stock = typeof prod?.stock === 'number' ? prod.stock : 0;
        const maxSets = Math.floor(stock / item.quantity);
        if (maxSets < minSets) minSets = maxSets;
        computedOriginalPrice += (prod?.price || 0) * item.quantity;
      }
      const dynamicStock = minSets === Infinity ? 0 : minSets;

      updatePayload.includedProducts = normalized;
      updatePayload.dynamicStock = dynamicStock;
      if (updatePayload.stock === undefined || updatePayload.stock === null || updatePayload.stock === '') {
        updatePayload.stock = dynamicStock;
      } else {
        updatePayload.stock = Math.min(parseInt(updatePayload.stock) || 0, dynamicStock);
      }

      if (!updatePayload.originalPrice || Number(updatePayload.originalPrice) === 0) {
        updatePayload.originalPrice = computedOriginalPrice;
      }
      if (updatePayload.originalPrice > 0 && updatePayload.price) {
        updatePayload.discount = Math.max(0, Math.round(((updatePayload.originalPrice - updatePayload.price) / updatePayload.originalPrice) * 100));
      }
    }

    if (updatePayload.dismissReview || req.body.clearReview) {
      updatePayload.needsReview = false;
      updatePayload.reviewReason = '';
    }

    const combo = await Combo.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      updatePayload,
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

// @desc    Dismiss combo review alert
// @route   PUT /api/combos/:id/dismiss-review
// @access  Private/Admin
exports.dismissReview = async (req, res) => {
  try {
    const combo = await Combo.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { needsReview: false, reviewReason: '' },
      { new: true }
    );

    if (!combo) {
      return res.status(404).json({
        success: false,
        message: 'Combo not found'
      });
    }

    cacheService.invalidate('combos:');

    res.status(200).json({
      success: true,
      message: 'Combo review alert cleared',
      data: combo
    });
  } catch (error) {
    return serverError(res, error, 'comboController.js → dismissReview');
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
