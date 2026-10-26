const Banner = require('../models/banner.model');
const auditService = require('../services/audit.service');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// Helper to normalize banner images and guarantee valid, context-appropriate fallbacks
const normalizeBanner = (banner) => {
  if (!banner) return banner;
  let imageUrl = banner.imageUrl;
  let mobileImageUrl = banner.mobileImageUrl || banner.imageUrl;

  const isBroken = !imageUrl || imageUrl.includes('fresh-veggies/image/upload') || imageUrl.includes('via.placeholder') || imageUrl.includes('example.com');
  if (isBroken) {
    const titleLower = (banner.title || '').toLowerCase();
    if (titleLower.includes('monsoon') || titleLower.includes('rain')) {
      imageUrl = '/sandbox-assets/banners/monsoon_gardening.jpg';
      mobileImageUrl = '/sandbox-assets/banners/monsoon_gardening.jpg';
    } else if (titleLower.includes('fertilizer') || titleLower.includes('feed') || titleLower.includes('soil')) {
      imageUrl = '/sandbox-assets/banners/organic_fertilizer_promo.webp';
      mobileImageUrl = '/sandbox-assets/banners/organic_fertilizer_promo.webp';
    } else if (titleLower.includes('combo') || titleLower.includes('kit') || titleLower.includes('harvest') || titleLower.includes('diwali') || titleLower.includes('sale')) {
      imageUrl = '/sandbox-assets/hero/slide_3.webp';
      mobileImageUrl = '/sandbox-assets/hero/slide_3.webp';
    } else {
      imageUrl = '/sandbox-assets/hero/slide_1.webp';
      mobileImageUrl = '/sandbox-assets/hero/slide_1.webp';
    }
  }

  return {
    ...banner,
    imageUrl,
    mobileImageUrl,
  };
};

// @desc    Get all banners (Admin)
// @route   GET /api/banners/admin
// @access  Private/Admin
exports.getAllBanners = async (req, res) => {
  try {
    const banners = await Banner.find({ isDeleted: { $ne: true } })
      .sort({ order: 1, createdAt: -1 })
      .lean();

    const normalized = banners.map(normalizeBanner);

    res.status(200).json({
      success: true,
      count: normalized.length,
      data: normalized
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → getAllBanners');
  }
};

// @desc    Get active banners
// @route   GET /api/banners/active or GET /api/banners
// @access  Public
exports.getActiveBanners = async (req, res) => {
  try {
    const { position } = req.query;
    const cacheKey = `banners:active:${position || 'all'}`;

    return await cacheService.sendCachedResponse(req, res, cacheKey, async () => {
      const now = new Date();

      const query = {
        isActive: true,
        isDeleted: { $ne: true },
        $and: [
          {
            $or: [
              { startDate: { $lte: now } },
              { startDate: null },
              { startDate: { $exists: false } },
            ],
          },
          {
            $or: [
              { endDate: { $gte: now } },
              { endDate: null },
              { endDate: { $exists: false } },
            ],
          },
        ],
      };

      if (position && position !== 'all') {
        if (position === 'top' || position === 'hero') {
          query.position = { $in: ['hero', 'top'] };
        } else {
          query.position = position;
        }
      }

      const banners = await Banner.find(query).sort({ order: 1, createdAt: -1 }).lean();

      // Increment view count asynchronously in the background so it never delays the HTTP response
      if (banners.length > 0) {
        Banner.updateMany(
          { _id: { $in: banners.map(b => b._id) } },
          { $inc: { viewCount: 1 } }
        ).catch((err) => console.error('Banner viewCount update error:', err.message));
      }

      const normalized = banners.map(normalizeBanner);

      return {
        success: true,
        count: normalized.length,
        data: normalized
      };
    }, cacheService.TTL_TIERS?.STORE_CATALOG || 60_000);
  } catch (error) {
    return serverError(res, error, 'bannerController.js → getActiveBanners');
  }
};

// @desc    Track banner click
// @route   POST /api/banners/:id/click
// @access  Public
exports.trackBannerClick = async (req, res) => {
  try {
    // Non-blocking update or fast update
    await Banner.findByIdAndUpdate(
      req.params.id,
      { $inc: { clickCount: 1 } }
    );

    res.status(200).json({
      success: true,
      message: 'Click tracked'
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → trackBannerClick');
  }
};

// @desc    Create banner
// @route   POST /api/banners
// @access  Private/Admin
exports.createBanner = async (req, res) => {
  try {
    const banner = await Banner.create(req.body);

    cacheService.invalidate('banners:');

    await auditService.logAction({
      actor: req.user,
      action: 'CREATE',
      entityType: 'Banner',
      entityId: banner._id,
      entityName: banner.title || 'Banner',
      details: { title: banner.title, position: banner.position },
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: banner
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → createBanner');
  }
};

// @desc    Update banner
// @route   PUT /api/banners/:id
// @access  Private/Admin
exports.updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      req.body,
      { new: true, runValidators: true }
    );

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    cacheService.invalidate('banners:');

    await auditService.logAction({
      actor: req.user,
      action: 'UPDATE',
      entityType: 'Banner',
      entityId: banner._id,
      entityName: banner.title || 'Banner',
      details: req.body,
      ipAddress: req.ip
    });

    res.status(200).json({
      success: true,
      data: banner
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → updateBanner');
  }
};

// @desc    Bulk reorder banners sequence (FEAT-023)
// @route   PUT /api/banners/reorder
// @access  Private/Admin
exports.reorderBanners = async (req, res) => {
  try {
    const { bannerIds, items } = req.body;

    let updateOperations = [];

    if (Array.isArray(bannerIds) && bannerIds.length > 0) {
      updateOperations = bannerIds.map((id, index) => ({
        updateOne: {
          filter: { _id: id, isDeleted: { $ne: true } },
          update: { $set: { order: index } }
        }
      }));
    } else if (Array.isArray(items) && items.length > 0) {
      updateOperations = items.map((item, index) => ({
        updateOne: {
          filter: { _id: item.id || item._id, isDeleted: { $ne: true } },
          update: { $set: { order: typeof item.order === 'number' ? item.order : index } }
        }
      }));
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide bannerIds array or items array for reordering.'
      });
    }

    if (updateOperations.length > 0) {
      await Banner.bulkWrite(updateOperations);
    }

    cacheService.invalidate('banners:');

    const updatedBanners = await Banner.find({ isDeleted: { $ne: true } })
      .sort({ order: 1, createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      message: 'Banners reordered successfully',
      data: updatedBanners
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → reorderBanners');
  }
};

// @desc    Delete banner (Soft delete with recovery ledger)
// @route   DELETE /api/banners/:id
// @access  Private/Admin
exports.deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findOne({ _id: req.params.id, isDeleted: { $ne: true } });

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    banner.isDeleted = true;
    banner.isActive = false;
    banner.deletedAt = new Date();
    banner.deletedBy = req.user ? req.user._id : null;
    banner.deletionReason = req.body?.reason || 'Banner removed by administrator';
    await banner.save();

    await auditService.logDeletion({
      actor: req.user,
      entityType: 'Banner',
      entityId: banner._id,
      entityName: banner.title || 'Banner',
      snapshot: banner.toObject(),
      reason: banner.deletionReason,
      ipAddress: req.ip
    });

    cacheService.invalidate('banners:');

    res.status(200).json({
      success: true,
      message: 'Banner moved to Delete History. It can be safely restored at any time.'
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → deleteBanner');
  }
};
