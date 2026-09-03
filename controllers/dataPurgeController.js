const bcryptModelsLoaded = true; // documentation marker; models below do the work
const Order    = require('../models/Order');
const Review   = require('../models/Review');
const Product  = require('../models/Product');
const Category = require('../models/Category');
const Combo    = require('../models/Combo');
const Coupon   = require('../models/Coupon');
const Banner   = require('../models/Banner');
const User     = require('../models/User');
const Counter  = require('../models/Counter');
const { serverError } = require('../utils/respond');

/**
 * Production preparation: remove seeded/test content.
 *
 * This is the most destructive operation in the system, so it is gated four
 * separate ways and each gate fails closed:
 *
 *   1. Signed in as an admin (route middleware).
 *   2. The caller's email matches SUPER_ADMIN_EMAIL. That lives in the
 *      environment rather than the database on purpose — someone who manages to
 *      flip a `role` field still cannot reach this.
 *   3. The caller re-enters their own password.
 *   4. The caller types an exact confirmation phrase.
 *
 * The acting super admin's own account is always preserved; wiping it would
 * lock the owner out of their own store.
 */
const CONFIRMATION_PHRASE = 'DELETE ALL DATA';

const isSuperAdmin = (user) => {
  const configured = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  // Unset means nobody qualifies — the capability is off until deliberately enabled.
  if (!configured) return false;
  return (user?.email || '').trim().toLowerCase() === configured;
};

// What the purge covers. Orders and reviews go first so nothing is left
// pointing at products that no longer exist.
const COLLECTIONS = [
  { name: 'orders',     model: Order },
  { name: 'reviews',    model: Review },
  { name: 'combos',     model: Combo },
  { name: 'coupons',    model: Coupon },
  { name: 'banners',    model: Banner },
  { name: 'products',   model: Product },
  { name: 'categories', model: Category },
];

// @desc    Preview what a purge would remove
// @route   GET /api/admin/purge-data/preview
// @access  Super admin
exports.previewPurge = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'This action is restricted to the super admin.' });
    }

    const counts = {};
    for (const { name, model } of COLLECTIONS) counts[name] = await model.countDocuments({});
    counts.users = await User.countDocuments({ _id: { $ne: req.user._id } });

    return res.status(200).json({
      success: true,
      data: {
        counts,
        preserved: { email: req.user.email, reason: 'Your own account is never removed.' },
        confirmationPhrase: CONFIRMATION_PHRASE,
      },
    });
  } catch (error) {
    return serverError(res, error, 'dataPurgeController → previewPurge');
  }
};

// @desc    Remove all catalogue, order and customer data
// @route   POST /api/admin/purge-data
// @access  Super admin + password + typed confirmation
exports.purgeData = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'This action is restricted to the super admin.' });
    }

    const { password, confirmation } = req.body || {};

    if (confirmation !== CONFIRMATION_PHRASE) {
      return res.status(400).json({
        success: false,
        message: `Type "${CONFIRMATION_PHRASE}" exactly to confirm.`,
      });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: 'Your password is required to confirm.' });
    }

    // Re-authenticate: a hijacked session alone must not be enough.
    const account = await User.findById(req.user._id).select('+password');
    if (!account || !(await account.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Password is incorrect.' });
    }

    const removed = {};
    for (const { name, model } of COLLECTIONS) {
      removed[name] = (await model.deleteMany({})).deletedCount || 0;
    }

    // Everyone except the operator. Their session stays valid, so they are not
    // locked out of the store they just cleared.
    removed.users = (await User.deleteMany({ _id: { $ne: req.user._id } })).deletedCount || 0;

    // Order numbers restart from 1 for the real store rather than continuing
    // from wherever the test data left off.
    await Counter.deleteMany({});

    console.warn(
      `⚠️  DATA PURGE by ${account.email} at ${new Date().toISOString()} — ` +
      Object.entries(removed).map(([k, v]) => `${k}:${v}`).join(' ')
    );

    return res.status(200).json({
      success: true,
      message: 'All test data removed. Your admin account was preserved.',
      data: { removed, preservedAccount: account.email },
    });
  } catch (error) {
    return serverError(res, error, 'dataPurgeController → purgeData');
  }
};
