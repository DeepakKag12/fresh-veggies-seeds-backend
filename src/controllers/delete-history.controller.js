const mongoose = require('mongoose');
const DeleteHistory = require('../models/delete-history.model');
const AuditLog = require('../models/audit-log.model');
const Product = require('../models/product.model');
const Category = require('../models/category.model');
const Combo = require('../models/combo.model');
const Coupon = require('../models/coupon.model');
const Banner = require('../models/banner.model');
const User = require('../models/user.model');
const Order = require('../models/order.model');
const auditService = require('../services/audit.service');
const cacheService = require('../utils/cache.util');
const statsCache = require('../utils/stats-cache.util');
const { serverError } = require('../utils/respond.util');

// @desc    Get paginated deletion history with filters & metrics
// @route   GET /api/admin/delete-history
// @access  Private/Admin
exports.getDeleteHistory = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { entityType, recoveryStatus, search, startDate, endDate } = req.query;

    const filter = {};

    if (entityType && entityType !== 'All') {
      filter.entityType = entityType;
    }

    if (recoveryStatus && recoveryStatus !== 'All') {
      filter.recoveryStatus = recoveryStatus;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { entityName: { $regex: q, $options: 'i' } },
        { 'deletedBy.name': { $regex: q, $options: 'i' } },
        { 'deletedBy.email': { $regex: q, $options: 'i' } },
        { deletionReason: { $regex: q, $options: 'i' } }
      ];
    }

    const [items, total, recoverableCount, restoredCount, permanentCount] = await Promise.all([
      DeleteHistory.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DeleteHistory.countDocuments(filter),
      DeleteHistory.countDocuments({ recoveryStatus: 'Recoverable' }),
      DeleteHistory.countDocuments({ recoveryStatus: 'Restored' }),
      DeleteHistory.countDocuments({ recoveryStatus: 'Permanently Deleted' })
    ]);

    res.status(200).json({
      success: true,
      data: items,
      count: items.length,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: page,
      metrics: {
        totalDeleted: total,
        recoverable: recoverableCount,
        restored: restoredCount,
        permanentlyDeleted: permanentCount
      }
    });
  } catch (error) {
    return serverError(res, error, 'deleteHistoryController.js → getDeleteHistory');
  }
};

// @desc    Get single deletion record snapshot
// @route   GET /api/admin/delete-history/:id
// @access  Private/Admin
exports.getDeleteRecord = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid deletion record ID' });
    }

    const record = await DeleteHistory.findById(id).lean();
    if (!record) {
      return res.status(404).json({ success: false, message: 'Deletion record not found' });
    }

    res.status(200).json({
      success: true,
      data: record
    });
  } catch (error) {
    return serverError(res, error, 'deleteHistoryController.js → getDeleteRecord');
  }
};

// @desc    Restore a soft-deleted record with conflict detection
// @route   POST /api/admin/delete-history/:id/restore
// @access  Private/Admin
exports.restoreDeletedRecord = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid deletion record ID' });
    }

    const record = await DeleteHistory.findById(id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Deletion record not found' });
    }

    if (record.recoveryStatus === 'Restored') {
      return res.status(400).json({
        success: false,
        message: `This ${record.entityType} has already been restored.`
      });
    }

    if (record.recoveryStatus === 'Permanently Deleted') {
      return res.status(400).json({
        success: false,
        message: `Cannot restore: this record was permanently deleted and cannot be recovered.`
      });
    }

    const { entityType, entityId, snapshot } = record;
    let restoredEntity = null;

    // ── Entity-Specific Restoration Logic & Conflict Checks ───
    if (entityType === 'Product') {
      // 1. Conflict check: active product with same name
      const nameConflict = await Product.findOne({
        name: snapshot.name,
        _id: { $ne: entityId },
        isDeleted: { $ne: true }
      });
      if (nameConflict) {
        return res.status(409).json({
          success: false,
          message: `Cannot restore product: an active product "${snapshot.name}" already exists.`
        });
      }

      // 2. Check category reference
      if (snapshot.categoryId) {
        const cat = await Category.findOne({
          _id: snapshot.categoryId,
          isDeleted: { $ne: true }
        });
        if (!cat) {
          return res.status(400).json({
            success: false,
            message: `Cannot restore product: its assigned category is deleted or inactive. Please restore the category first.`
          });
        }
      }

      // 3. Restore document
      restoredEntity = await Product.findByIdAndUpdate(
        entityId,
        {
          $set: {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            deletionReason: ''
          }
        },
        { new: true }
      );

      // If document was not found (e.g. edge-case cleaned), re-instantiate from snapshot
      if (!restoredEntity && snapshot) {
        const productData = { ...snapshot, _id: entityId, isDeleted: false, isActive: true, deletedAt: null };
        delete productData.__v;
        restoredEntity = await Product.create(productData);
      }

      cacheService.invalidate('products:');
      cacheService.invalidate('admin:');
      statsCache.invalidate('admin:');
    } else if (entityType === 'Category') {
      // Conflict check: active category with same name or slug
      const catConflict = await Category.findOne({
        $or: [{ name: snapshot.name }, { slug: snapshot.slug }],
        _id: { $ne: entityId },
        isDeleted: { $ne: true }
      });
      if (catConflict) {
        return res.status(409).json({
          success: false,
          message: `Cannot restore category: an active category with name "${snapshot.name}" or slug "${snapshot.slug}" already exists.`
        });
      }

      restoredEntity = await Category.findByIdAndUpdate(
        entityId,
        {
          $set: {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            deletionReason: ''
          }
        },
        { new: true }
      );

      if (!restoredEntity && snapshot) {
        const catData = { ...snapshot, _id: entityId, isDeleted: false, isActive: true, deletedAt: null };
        delete catData.__v;
        restoredEntity = await Category.create(catData);
      }

      cacheService.invalidate('categories:');
      cacheService.invalidate('products:');
    } else if (entityType === 'Combo') {
      const comboConflict = await Combo.findOne({
        name: snapshot.name,
        _id: { $ne: entityId },
        isDeleted: { $ne: true }
      });
      if (comboConflict) {
        return res.status(409).json({
          success: false,
          message: `Cannot restore combo: an active combo named "${snapshot.name}" already exists.`
        });
      }

      restoredEntity = await Combo.findByIdAndUpdate(
        entityId,
        {
          $set: {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            deletionReason: ''
          }
        },
        { new: true }
      );

      if (!restoredEntity && snapshot) {
        const comboData = { ...snapshot, _id: entityId, isDeleted: false, isActive: true, deletedAt: null };
        delete comboData.__v;
        restoredEntity = await Combo.create(comboData);
      }

      cacheService.invalidate('combos:');
    } else if (entityType === 'Coupon') {
      const couponConflict = await Coupon.findOne({
        code: snapshot.code?.toUpperCase(),
        _id: { $ne: entityId },
        isDeleted: { $ne: true }
      });
      if (couponConflict) {
        return res.status(409).json({
          success: false,
          message: `Cannot restore coupon: an active coupon with code "${snapshot.code}" already exists.`
        });
      }

      restoredEntity = await Coupon.findByIdAndUpdate(
        entityId,
        {
          $set: {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            deletionReason: ''
          }
        },
        { new: true }
      );

      if (!restoredEntity && snapshot) {
        const couponData = { ...snapshot, _id: entityId, isDeleted: false, isActive: true, deletedAt: null };
        delete couponData.__v;
        restoredEntity = await Coupon.create(couponData);
      }

      cacheService.invalidate('coupons:');
    } else if (entityType === 'Banner') {
      restoredEntity = await Banner.findByIdAndUpdate(
        entityId,
        {
          $set: {
            isDeleted: false,
            isActive: true,
            deletedAt: null,
            deletedBy: null,
            deletionReason: ''
          }
        },
        { new: true }
      );

      if (!restoredEntity && snapshot) {
        const bannerData = { ...snapshot, _id: entityId, isDeleted: false, isActive: true, deletedAt: null };
        delete bannerData.__v;
        restoredEntity = await Banner.create(bannerData);
      }

      cacheService.invalidate('banners:');
    } else if (entityType === 'User') {
      restoredEntity = await User.findByIdAndUpdate(
        entityId,
        { $set: { isActive: true } },
        { new: true }
      );
    } else if (entityType === 'Order') {
      const orderConflict = await Order.findById(entityId);
      if (orderConflict) {
        return res.status(409).json({
          success: false,
          message: 'Cannot restore order: an active order with this ID already exists.'
        });
      }
      if (snapshot) {
        const orderData = { ...snapshot };
        delete orderData.__v;
        restoredEntity = await Order.create(orderData);
        statsCache.invalidate('admin:');
        statsCache.invalidate('orders:');
      }
    }

    // 4. Update DeleteHistory recovery status & audit trail
    await auditService.logRestoration({
      req,
      deleteHistoryRecord: record,
      entityType,
      entityId,
      entityName: record.entityName
    });

    res.status(200).json({
      success: true,
      message: `Successfully restored ${entityType} "${record.entityName}"!`,
      data: restoredEntity
    });
  } catch (error) {
    return serverError(res, error, 'deleteHistoryController.js → restoreDeletedRecord');
  }
};

// @desc    Permanently delete a soft-deleted record from database
// @route   DELETE /api/admin/delete-history/:id/permanent
// @access  Private/Admin
exports.permanentlyDeleteRecord = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid deletion record ID' });
    }

    const record = await DeleteHistory.findById(id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Deletion record not found' });
    }

    if (record.recoveryStatus === 'Permanently Deleted') {
      return res.status(400).json({
        success: false,
        message: 'This record has already been permanently purged.'
      });
    }

    const { entityType, entityId } = record;

    // Purge underlying record from collection
    if (entityType === 'Product') {
      await Product.findByIdAndDelete(entityId);
      cacheService.invalidate('products:');
    } else if (entityType === 'Category') {
      await Category.findByIdAndDelete(entityId);
      cacheService.invalidate('categories:');
    } else if (entityType === 'Combo') {
      await Combo.findByIdAndDelete(entityId);
      cacheService.invalidate('combos:');
    } else if (entityType === 'Coupon') {
      await Coupon.findByIdAndDelete(entityId);
      cacheService.invalidate('coupons:');
    } else if (entityType === 'Banner') {
      await Banner.findByIdAndDelete(entityId);
      cacheService.invalidate('banners:');
    } else if (entityType === 'Order') {
      await Order.findByIdAndDelete(entityId);
      statsCache.invalidate('admin:');
      statsCache.invalidate('orders:');
    } else if (entityType === 'User') {
      await User.findByIdAndDelete(entityId);
    }

    // Clean up associated images from Cloudinary to prevent orphaned cloud storage bloat
    const snapshot = record.snapshot || record.entityData || {};
    try {
      const cloudinary = require('../config/cloudinary.config');
      const urls = [
        ...(Array.isArray(snapshot.images) ? snapshot.images : []),
        snapshot.image,
        snapshot.imageUrl,
        snapshot.desktopImage,
        snapshot.mobileImage,
      ].filter(Boolean);

      for (const rawUrl of urls) {
        if (typeof rawUrl === 'string' && rawUrl.includes('cloudinary.com')) {
          const match = rawUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
          if (match && match[1]) {
            await cloudinary.uploader.destroy(match[1]).catch(() => {});
          }
        }
      }
    } catch (cleanupErr) {
      console.warn('⚠️  Cloudinary cleanup skipped:', cleanupErr.message);
    }

    // Record permanent purge in audit trail
    await auditService.logPermanentDeletion({
      req,
      deleteHistoryRecord: record,
      entityType,
      entityId,
      entityName: record.entityName
    });

    res.status(200).json({
      success: true,
      message: `Permanently purged ${entityType} "${record.entityName}". It can no longer be restored.`
    });
  } catch (error) {
    return serverError(res, error, 'deleteHistoryController.js → permanentlyDeleteRecord');
  }
};

// @desc    Get paginated administrative audit logs
// @route   GET /api/admin/audit-logs
// @access  Private/Admin
exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { action, entityType, search, startDate, endDate } = req.query;

    const filter = {};

    if (action && action !== 'All') {
      filter.action = action;
    }

    if (entityType && entityType !== 'All') {
      filter.entityType = entityType;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { entityName: { $regex: q, $options: 'i' } },
        { 'actor.name': { $regex: q, $options: 'i' } },
        { 'actor.email': { $regex: q, $options: 'i' } }
      ];
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: logs,
      count: logs.length,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: page
    });
  } catch (error) {
    return serverError(res, error, 'deleteHistoryController.js → getAuditLogs');
  }
};

// @desc    Get audit logs summary statistics
// @route   GET /api/admin/audit-logs/stats
// @access  Private/Admin
exports.getAuditStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayCount, totalCount, actionBreakdown, entityBreakdown] = await Promise.all([
      AuditLog.countDocuments({ createdAt: { $gte: today } }),
      AuditLog.countDocuments(),
      AuditLog.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } }
      ]),
      AuditLog.aggregate([
        { $group: { _id: '$entityType', count: { $sum: 1 } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        todayActions: todayCount,
        totalActions: totalCount,
        actions: actionBreakdown.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
        entities: entityBreakdown.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {})
      }
    });
  } catch (error) {
    return serverError(res, error, 'deleteHistoryController.js → getAuditStats');
  }
};
