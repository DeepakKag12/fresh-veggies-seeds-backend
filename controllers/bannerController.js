const Banner = require('../models/Banner');
const cacheService = require('../utils/cacheService');
const { serverError } = require('../utils/respond');

// @desc    Get all banners (Admin)
// @route   GET /api/banners/admin
// @access  Private/Admin
exports.getAllBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ position: 1, order: 1 }).lean();

    res.status(200).json({
      success: true,
      count: banners.length,
      data: banners
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → getAllBanners');
  }
};

// @desc    Get active banners
// @route   GET /api/banners/active
// @access  Public
exports.getActiveBanners = async (req, res) => {
  try {
    const { position } = req.query;
    const cacheKey = `banners:active:${position || 'all'}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const now = new Date();

    const query = {
      isActive: true,
      startDate: { $lte: now },
      $or: [
        { endDate: { $gte: now } },
        { endDate: null }
      ]
    };

    if (position) {
      query.position = position;
    }

    const banners = await Banner.find(query).sort({ order: 1 }).lean();

    // Increment view count asynchronously in the background so it never delays the HTTP response
    if (banners.length > 0) {
      Banner.updateMany(
        { _id: { $in: banners.map(b => b._id) } },
        { $inc: { viewCount: 1 } }
      ).catch((err) => console.error('Banner viewCount update error:', err.message));
    }

    const payload = {
      success: true,
      count: banners.length,
      data: banners
    };

    // Cache in memory for 5 minutes
    cacheService.set(cacheKey, payload, 5 * 60 * 1000);

    res.status(200).json(payload);
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
    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
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

    res.status(200).json({
      success: true,
      data: banner
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → updateBanner');
  }
};

// @desc    Delete banner
// @route   DELETE /api/banners/:id
// @access  Private/Admin
exports.deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    cacheService.invalidate('banners:');

    res.status(200).json({
      success: true,
      message: 'Banner deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'bannerController.js → deleteBanner');
  }
};
