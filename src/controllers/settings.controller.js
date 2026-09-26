const Settings = require('../models/settings.model');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

const isSuperAdmin = (user) => {
  const configured = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!configured) {
    // In local development or if unset, any admin can view advanced settings
    return process.env.NODE_ENV !== 'production';
  }
  return (user?.email || '').trim().toLowerCase() === configured;
};

// @desc    Get public store settings (cached)
// @route   GET /api/settings
// @access  Public
exports.getPublicSettings = async (req, res) => {
  try {
    const cached = cacheService.get('settings:public');
    if (cached) {
      return res.status(200).json(cached);
    }

    const settings = await Settings.getSingleton();
    const payload = {
      success: true,
      data: {
        store: settings.store,
        delivery: {
          freeDeliveryThreshold: settings.delivery.freeDeliveryThreshold,
          deliveryCharge: settings.delivery.deliveryCharge,
          minOrderAmount: settings.delivery.minOrderAmount,
          codAvailable: settings.delivery.codAvailable,
          codMaxOrder: settings.delivery.codMaxOrder,
          deliveryTime: settings.delivery.deliveryTime,
        },
        orders: {
          allowCustomerCancellation: settings.orders?.allowCustomerCancellation ?? true,
          cancellationAllowedUntil: settings.orders?.cancellationAllowedUntil || 'Before Shipped',
          autoCancelUnpaidOrders: settings.orders?.autoCancelUnpaidOrders ?? true,
          unpaidOrderTimeoutMinutes: settings.orders?.unpaidOrderTimeoutMinutes ?? 30,
        },
        inventory: {
          lowStockThreshold: settings.inventory?.lowStockThreshold ?? 10,
          showOnlyXLeft: settings.inventory?.showOnlyXLeft ?? true,
          allowBackorders: settings.inventory?.allowBackorders ?? false,
          autoHideOutOfStock: settings.inventory?.autoHideOutOfStock ?? false,
        },
        payments: {
          onlinePaymentEnabled: settings.payments.onlinePaymentEnabled,
          codEnabled: settings.payments.codEnabled,
          codMinOrder: settings.payments.codMinOrder,
          codMaxOrder: settings.payments.codMaxOrder,
          codExtraCharge: settings.payments.codExtraCharge ?? 0,
          onlineDiscountType: settings.payments.onlineDiscountType || 'percentage',
          onlineDiscountValue: settings.payments.onlineDiscountValue ?? 0,
          onlineDiscountMaxLimit: settings.payments.onlineDiscountMaxLimit ?? 100,
        },
      },
    };

    cacheService.set('settings:public', payload, 5 * 60 * 1000); // 5 min TTL
    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'settingsController → getPublicSettings');
  }
};

// @desc    Get full admin settings & super-admin readiness
// @route   GET /api/settings/admin
// @access  Private/Admin
exports.getAdminSettings = async (req, res) => {
  try {
    const settings = await Settings.getSingleton();
    const superAdmin = isSuperAdmin(req.user);

    const advancedInfo = {
      isSuperAdmin: superAdmin,
      nodeEnv: process.env.NODE_ENV || 'development',
      services: {
        razorpay: { configured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) },
        webhook: { configured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET) },
        brevoSmtp: { configured: Boolean(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS) },
        twilio: { configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_API_KEY) },
        dtdc: { configured: Boolean(process.env.DTDC_API_KEY && process.env.DTDC_CUSTOMER_ID) },
        cloudinary: { configured: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) },
      },
    };

    res.status(200).json({
      success: true,
      data: {
        settings,
        advanced: advancedInfo,
      },
    });
  } catch (error) {
    return serverError(res, error, 'settingsController → getAdminSettings');
  }
};

// @desc    Update a settings section or all settings
// @route   PUT /api/settings/admin/:section
// @access  Private/Admin
exports.updateSettingsSection = async (req, res) => {
  try {
    const { section } = req.params;
    const updateData = req.body;

    const validSections = ['store', 'delivery', 'orders', 'inventory', 'payments', 'notifications'];
    if (section !== 'all' && !validSections.includes(section)) {
      return res.status(400).json({ success: false, message: `Invalid settings section: ${section}` });
    }

    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    if (section === 'all') {
      validSections.forEach((s) => {
        if (updateData[s]) {
          const current = settings[s]?.toObject ? settings[s].toObject() : (settings[s] || {});
          settings[s] = { ...current, ...updateData[s] };
          settings.markModified(s);
        }
      });
    } else {
      const current = settings[section]?.toObject ? settings[section].toObject() : (settings[section] || {});
      settings[section] = { ...current, ...updateData };
      settings.markModified(section);
    }

    await settings.save();
    Settings.invalidateCache();
    cacheService.invalidate('settings:');
    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');

    res.status(200).json({
      success: true,
      message: `${section.charAt(0).toUpperCase() + section.slice(1)} settings saved successfully`,
      data: settings,
    });
  } catch (error) {
    return serverError(res, error, 'settingsController → updateSettingsSection');
  }
};

// @desc    Reset a settings section to defaults
// @route   POST /api/settings/admin/reset/:section
// @access  Private/Admin
exports.resetSettingsSection = async (req, res) => {
  try {
    const { section } = req.params;
    const defaults = Settings.getDefaults();

    const validSections = ['store', 'delivery', 'orders', 'inventory', 'payments', 'notifications'];
    if (section !== 'all' && !validSections.includes(section)) {
      return res.status(400).json({ success: false, message: `Invalid settings section: ${section}` });
    }

    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create(defaults);
    } else {
      if (section === 'all') {
        validSections.forEach((s) => {
          settings[s] = defaults[s];
        });
      } else {
        settings[section] = defaults[section];
      }
      await settings.save();
    }

    Settings.invalidateCache();
    cacheService.invalidate('settings:');
    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');

    res.status(200).json({
      success: true,
      message: `${section.charAt(0).toUpperCase() + section.slice(1)} settings reset to defaults`,
      data: settings,
    });
  } catch (error) {
    return serverError(res, error, 'settingsController → resetSettingsSection');
  }
};
