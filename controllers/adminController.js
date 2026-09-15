const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Settings = require('../models/Settings');
const statsCache = require('../utils/statsCache');
const { serverError } = require('../utils/respond');

// @desc    Get dashboard stats
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getDashboardStats = async (req, res) => {
  try {
    // The dashboard auto-refreshes every 30s; a 20s TTL keeps the figures
    // effectively live while collapsing repeat loads into one set of queries.
    const cached = statsCache.get('admin:stats');
    if (cached) return res.status(200).json(cached);

    // ── Load dynamic store settings ──────────────────────────────────────────
    const settings = await Settings.getSingleton().catch(() => null);
    const lowStockCutoff = settings?.inventory?.lowStockThreshold ?? 10;

    // ── Date helpers ─────────────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);

    // Real orders = COD (always real) OR Online/UPI with payment confirmed/refunded
    const realOrder = { $or: [{ paymentMode: 'COD' }, { paymentStatus: { $in: ['Paid', 'Refunded'] } }] };

    // ── Run all queries in parallel ───────────────────────────────────────────
    const [
      totalOrders, totalUsers, totalProducts,
      pendingOrders, confirmedOrders, packedOrders, shippedOrders,
      deliveredOrders, cancelledOrders, cancellationRequests,
      failedPayments, lowStockProducts, outOfStockProducts, pendingReviews,
      todayOrders, todayUsers,
      urgentOrders,
      revAll, revOnline, revCOD, revRefunded,
      revToday, revTodayOnline, revTodayCOD,
      revMonth, revLastMonth,
      revMonthOnline, revMonthCOD
    ] = await Promise.all([
      Order.countDocuments(realOrder),
      User.countDocuments({ role: 'customer' }),
      Product.countDocuments(),

      Order.countDocuments({ ...realOrder, orderStatus: 'Pending'               }),
      Order.countDocuments({ ...realOrder, orderStatus: 'Confirmed'             }),
      Order.countDocuments({ ...realOrder, orderStatus: 'Packed'                }),
      Order.countDocuments({ ...realOrder, orderStatus: 'Shipped'               }),
      Order.countDocuments({ ...realOrder, orderStatus: 'Delivered'             }),
      Order.countDocuments({ ...realOrder, orderStatus: 'Cancelled'             }),
      Order.countDocuments({ ...realOrder, orderStatus: 'CancellationRequested' }),
      Order.countDocuments({ paymentStatus: 'Failed' }),
      Product.countDocuments({ stock: { $gt: 0, $lte: lowStockCutoff } }),
      Product.countDocuments({ stock: { $lte: 0 } }),
      Review.countDocuments({ isApproved: false, status: { $ne: 'rejected' } }),
      Order.countDocuments({ ...realOrder, createdAt: { $gte: today } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: today } }),

      // Urgent orders requiring immediate action
      Order.find({ ...realOrder, orderStatus: { $in: ['Pending', 'CancellationRequested'] } })
        .populate('userId', 'name email phone')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // ── Revenue: only Paid orders ─────────────────────────────────────────
      Order.aggregate([{ $match: { paymentStatus: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', paymentMode: 'Online' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', paymentMode: 'COD' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Refunded' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),

      // ── Today revenue ─────────────────────────────────────────────────────
      Order.aggregate([{ $match: { paymentStatus: 'Paid', createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', paymentMode: 'Online', createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', paymentMode: 'COD', createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),

      // ── This month revenue ────────────────────────────────────────────────
      Order.aggregate([{ $match: { paymentStatus: 'Paid', createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', paymentMode: 'Online', createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Order.aggregate([{ $match: { paymentStatus: 'Paid', paymentMode: 'COD', createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    ]);

    const g = (agg) => (agg.length > 0 ? agg[0].total : 0);

    const payload = {
      success: true,
      data: {
        // Counts
        totalOrders, totalUsers, totalProducts,
        pendingOrders, confirmedOrders, packedOrders, shippedOrders,
        deliveredOrders, cancelledOrders, cancellationRequests,
        failedPayments, lowStockProducts, outOfStockProducts, pendingReviews,
        todayOrders, todayUsers,
        actionRequiredCount: pendingOrders + cancellationRequests,
        urgentOrders,
        // Revenue (only from paid orders)
        totalRevenue:       g(revAll),
        onlineRevenue:      g(revOnline),
        codRevenue:         g(revCOD),
        refundedAmount:     g(revRefunded),
        // Today
        todayRevenue:       g(revToday),
        todayOnlineRevenue: g(revTodayOnline),
        todayCODRevenue:    g(revTodayCOD),
        // This month
        monthRevenue:       g(revMonth),
        lastMonthRevenue:   g(revLastMonth),
        monthOnlineRevenue: g(revMonthOnline),
        monthCODRevenue:    g(revMonthCOD),
      }
    };

    statsCache.set('admin:stats', payload, 20_000);
    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'adminController.js → getDashboardStats');
  }
};

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));

    // Whitelisted projection. This previously returned whole user documents,
    // which include the reset-password, email-verification and OTP token
    // hashes plus the saved cart and last login IP — none of which any client
    // needs, and all of which are useful to an attacker who gets admin access.
    const SAFE_FIELDS = 'name email phone role isActive emailVerified createdAt lastLogin';

    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const query = {};
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name:  { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select(SAFE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: users
    });
  } catch (error) {
    console.error('getAllUsers error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// @desc    Update user role
// @route   PUT /api/admin/users/:id/role
// @access  Private/Admin
exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;

    if (!['admin', 'customer'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be admin or customer.' });
    }

    // An admin demoting themselves instantly loses access to this endpoint —
    // and if they were the only admin, nobody can ever restore it.
    if (req.params.id === req.user._id.toString() && role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'You cannot remove your own admin role. Ask another admin to do it.'
      });
    }

    const target = await User.findById(req.params.id).select('role');
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Never let the store end up with zero admins.
    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the last remaining admin.'
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    ).select('name email phone role isActive');

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('updateUserRole error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update user role.' });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const user = await User.findById(req.params.id).select('role name');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot delete the last remaining admin.' });
      }
    }

    // A customer with orders is never hard-deleted: their orders reference
    // userId, and removing the row leaves every one of them pointing at a
    // document that no longer exists — breaking order history, revenue reports
    // and the admin order list. Deactivate instead, which blocks login while
    // keeping the financial record intact.
    const orderCount = await Order.countDocuments({ userId: user._id });
    if (orderCount > 0) {
      await User.updateOne(
        { _id: user._id },
        { $set: { isActive: false }, $inc: { tokenVersion: 1 } }  // also ends their sessions
      );
      return res.status(200).json({
        success: true,
        message: `${user.name} has ${orderCount} order(s), so the account was deactivated rather than deleted to preserve order history.`,
        data: { deactivated: true, orderCount }
      });
    }

    await User.findByIdAndDelete(user._id);
    res.status(200).json({ success: true, message: 'User deleted successfully', data: { deactivated: false } });
  } catch (error) {
    console.error('deleteUser error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
};

// @desc    Get sales analytics
// @route   GET /api/admin/analytics
// @access  Private/Admin
exports.getSalesAnalytics = async (req, res) => {
  try {
    const { period = '30days', year, month } = req.query;

    // ── Build date range ──────────────────────────────────────────────────────
    let startDate, endDate = new Date();
    const now = new Date();

    if (period === '7days') {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30days') {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
    } else if (period === '90days') {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 90);
    } else if (period === 'thismonth') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'lastmonth') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (period === 'specificmonth' && year && month) {
      // ?period=specificmonth&year=2026&month=2  (1-based month)
      const y = parseInt(year), m = parseInt(month) - 1;
      startDate = new Date(y, m, 1);
      endDate   = new Date(y, m + 1, 0, 23, 59, 59);
    } else if (period === 'yearly') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
    }

    const baseMatch = { paymentStatus: 'Paid', createdAt: { $gte: startDate, $lte: endDate } };

    // ── Daily/Monthly revenue with Online vs COD split ────────────────────────
    const groupByFormat = (period === 'yearly' || period === 'specificmonth' && false)
      ? '%Y-%m-%d'
      : period === 'yearly' ? '%Y-%m' : '%Y-%m-%d';

    const dailyRevenue = await Order.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue:       { $sum: '$totalAmount' },
          onlineRevenue: { $sum: { $cond: [{ $eq: ['$paymentMode', 'Online'] }, '$totalAmount', 0] } },
          codRevenue:    { $sum: { $cond: [{ $eq: ['$paymentMode', 'COD']    }, '$totalAmount', 0] } },
          orders:        { $sum: 1 },
          onlineOrders:  { $sum: { $cond: [{ $eq: ['$paymentMode', 'Online'] }, 1, 0] } },
          codOrders:     { $sum: { $cond: [{ $eq: ['$paymentMode', 'COD']    }, 1, 0] } },
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Last 12 months summary (always returned for the monthly bar chart) ───
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const monthlyRevenue = await Order.aggregate([
      { $match: { paymentStatus: 'Paid', createdAt: { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue:       { $sum: '$totalAmount' },
          onlineRevenue: { $sum: { $cond: [{ $eq: ['$paymentMode', 'Online'] }, '$totalAmount', 0] } },
          codRevenue:    { $sum: { $cond: [{ $eq: ['$paymentMode', 'COD']    }, '$totalAmount', 0] } },
          orders:        { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Payment mode totals for selected period ───────────────────────────────
    const paymentSplit = await Order.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$paymentMode',
          revenue:  { $sum: '$totalAmount' },
          orders:   { $sum: 1 },
          avgOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    // ── Top selling products ──────────────────────────────────────────────────
    const topProducts = await Order.aggregate([
      { $match: baseMatch },
      { $unwind: '$orderItems' },
      {
        $group: {
          _id: '$orderItems.product',
          totalSold: { $sum: '$orderItems.quantity' },
          revenue:   { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productDoc'
        }
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          _id: 1,
          name: '$productDoc.name',
          totalSold: 1,
          revenue: 1
        }
      }
    ]);

    // Revenue by category — only from paid orders
    const categoryRevenue = await Order.aggregate([
      { $match: baseMatch },
      { $unwind: '$orderItems' },
      {
        $lookup: {
          from: 'products',
          localField: 'orderItems.product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.categoryId',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category.name',
          revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } },
          orders:  { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period,
        dailyRevenue,
        monthlyRevenue,
        paymentSplit,
        topProducts,
        categoryRevenue
      }
    });
  } catch (error) {
    return serverError(res, error, 'adminController.js → getSalesAnalytics');
  }
};

// @desc    Get low stock products
// @route   GET /api/admin/lowstock
// @access  Private/Admin
exports.getLowStockProducts = async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 10;
    
    const products = await Product.find({
      isActive: true
    })
      .populate('categoryId', 'name')
      .lean();

    const lowStock = products
      .map((p) => {
        if (Array.isArray(p.packages) && p.packages.length > 0) {
          const totalStock = p.packages.reduce((sum, pkg) => sum + (Number(pkg.stock) || 0), 0);
          return { ...p, stock: totalStock };
        }
        return p;
      })
      .filter((p) => (p.stock ?? 0) < threshold)
      .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));

    res.status(200).json({
      success: true,
      count: lowStock.length,
      data: lowStock
    });
  } catch (error) {
    return serverError(res, error, 'adminController.js → getLowStockProducts');
  }
};
