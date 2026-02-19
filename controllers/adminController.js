const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Review = require('../models/Review');

// @desc    Get dashboard stats
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getDashboardStats = async (req, res) => {
  try {
    // ── Date helpers ─────────────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);

    // ── Run all queries in parallel ───────────────────────────────────────────
    const [
      totalOrders, totalUsers, totalProducts,
      pendingOrders, confirmedOrders, shippedOrders,
      deliveredOrders, cancelledOrders, cancellationRequests,
      failedPayments, lowStockProducts, pendingReviews,
      todayOrders,
      revAll, revOnline, revCOD, revRefunded,
      revToday, revTodayOnline, revTodayCOD,
      revMonth, revLastMonth,
      revMonthOnline, revMonthCOD
    ] = await Promise.all([
      Order.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Product.countDocuments(),

      Order.countDocuments({ orderStatus: 'Pending' }),
      Order.countDocuments({ orderStatus: 'Confirmed' }),
      Order.countDocuments({ orderStatus: 'Shipped' }),
      Order.countDocuments({ orderStatus: 'Delivered' }),
      Order.countDocuments({ orderStatus: 'Cancelled' }),
      Order.countDocuments({ orderStatus: 'CancellationRequested' }),
      Order.countDocuments({ paymentStatus: 'Failed' }),
      Product.countDocuments({ stock: { $lt: 10 } }),
      Review.countDocuments({ isApproved: false }),
      Order.countDocuments({ createdAt: { $gte: today } }),

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

    res.status(200).json({
      success: true,
      data: {
        // Counts
        totalOrders, totalUsers, totalProducts,
        pendingOrders, confirmedOrders, shippedOrders,
        deliveredOrders, cancelledOrders, cancellationRequests,
        failedPayments, lowStockProducts, pendingReviews,
        todayOrders,
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
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get low stock products
// @route   GET /api/admin/lowstock
// @access  Private/Admin
exports.getLowStockProducts = async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 10;
    
    const products = await Product.find({
      stock: { $lt: threshold },
      isActive: true
    })
      .populate('categoryId', 'name')
      .sort({ stock: 1 });

    res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
