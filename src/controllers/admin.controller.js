const User = require('../models/user.model');
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const Review = require('../models/review.model');
const Settings = require('../models/settings.model');
const auditService = require('../services/audit.service');
const statsCache = require('../utils/stats-cache.util');
const { serverError } = require('../utils/respond.util');

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

    // ── Real Date Boundaries ──────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayEnd = new Date(today.getTime() - 1);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

    // Real orders = COD (always real) OR Online/UPI with payment confirmed/refunded
    const realOrder = { $or: [{ paymentMode: 'COD' }, { paymentStatus: { $in: ['Paid', 'Refunded'] } }] };

    // ── Run all queries concurrently using consolidated aggregations ─────────
    const [
      totalOrders, totalUsers, totalProducts,
      statusAgg,
      failedPayments, lowStockProducts, outOfStockProducts, pendingReviews,
      todayOrders, yesterdayOrders, monthOrders, lastMonthOrders,
      todayUsers, yesterdayUsers, monthUsers, lastMonthUsers,
      urgentOrders,
      revAggList
    ] = await Promise.all([
      Order.countDocuments(realOrder),
      User.countDocuments({ role: 'customer' }),
      Product.countDocuments({ isDeleted: { $ne: true } }),

      // Single aggregation to get counts for all statuses in 1 query
      Order.aggregate([
        { $match: realOrder },
        { $group: { _id: '$orderStatus', count: { $sum: 1 } } }
      ]),

      Order.countDocuments({ paymentStatus: 'Failed' }),
      Product.countDocuments({ isDeleted: { $ne: true }, stock: { $gt: 0, $lte: lowStockCutoff } }),
      Product.countDocuments({ isDeleted: { $ne: true }, stock: { $lte: 0 } }),
      Review.countDocuments({ isApproved: false, status: { $ne: 'rejected' } }),

      // Real order counts over time
      Order.countDocuments({ ...realOrder, createdAt: { $gte: today } }),
      Order.countDocuments({ ...realOrder, createdAt: { $gte: yesterday, $lte: yesterdayEnd } }),
      Order.countDocuments({ ...realOrder, createdAt: { $gte: monthStart } }),
      Order.countDocuments({ ...realOrder, createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),

      // Real customer counts over time
      User.countDocuments({ role: 'customer', createdAt: { $gte: today } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: yesterday, $lte: yesterdayEnd } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: monthStart } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),

      // Urgent orders requiring immediate action
      Order.find({ ...realOrder, orderStatus: { $in: ['Pending', 'CancellationRequested'] } })
        .populate('userId', 'name email phone')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // Consolidated single aggregation for all real revenue figures
      Order.aggregate([
        { $match: { paymentStatus: { $in: ['Paid', 'Refunded'] } } },
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalAmount', 0] }
            },
            onlineRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'Online'] }] }, '$totalAmount', 0] }
            },
            codRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'COD'] }] }, '$totalAmount', 0] }
            },
            refundedAmount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'Refunded'] }, '$totalAmount', 0] }
            },
            todayRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $gte: ['$createdAt', today] }] }, '$totalAmount', 0] }
            },
            yesterdayRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $gte: ['$createdAt', yesterday] }, { $lte: ['$createdAt', yesterdayEnd] }] }, '$totalAmount', 0] }
            },
            todayOnlineRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'Online'] }, { $gte: ['$createdAt', today] }] }, '$totalAmount', 0] }
            },
            todayCODRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'COD'] }, { $gte: ['$createdAt', today] }] }, '$totalAmount', 0] }
            },
            monthRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $gte: ['$createdAt', monthStart] }] }, '$totalAmount', 0] }
            },
            lastMonthRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $gte: ['$createdAt', lastMonthStart] }, { $lte: ['$createdAt', lastMonthEnd] }] }, '$totalAmount', 0] }
            },
            monthOnlineRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'Online'] }, { $gte: ['$createdAt', monthStart] }] }, '$totalAmount', 0] }
            },
            monthCODRevenue: {
              $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'COD'] }, { $gte: ['$createdAt', monthStart] }] }, '$totalAmount', 0] }
            },
          }
        }
      ]),
    ]);

    // Map status counts from single aggregation
    const statusMap = {};
    if (Array.isArray(statusAgg)) {
      statusAgg.forEach((statusItem) => {
        if (statusItem._id) statusMap[statusItem._id] = statusItem.count;
      });
    }

    const pendingOrders        = statusMap['Pending'] || 0;
    const confirmedOrders      = statusMap['Confirmed'] || 0;
    const packedOrders         = statusMap['Packed'] || 0;
    const shippedOrders        = statusMap['Shipped'] || 0;
    const deliveredOrders      = statusMap['Delivered'] || 0;
    const cancelledOrders      = statusMap['Cancelled'] || 0;
    const cancellationRequests = statusMap['CancellationRequested'] || 0;

    // Extract revenue from consolidated aggregation
    const rev = (revAggList && revAggList.length > 0) ? revAggList[0] : {};

    const totalRevenue       = rev.totalRevenue || 0;
    const todayRevenue       = rev.todayRevenue || 0;
    const yesterdayRevenue   = rev.yesterdayRevenue || 0;
    const monthRevenue       = rev.monthRevenue || 0;
    const lastMonthRevenue   = rev.lastMonthRevenue || 0;

    // Real mathematical percentage calculations (Zero hardcoding)
    const revenueMoMTrend = lastMonthRevenue > 0
      ? Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : (monthRevenue > 0 ? 100 : 0);

    const revenueDoDTrend = yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : (todayRevenue > 0 ? 100 : 0);

    const ordersMoMTrend = lastMonthOrders > 0
      ? Math.round(((monthOrders - lastMonthOrders) / lastMonthOrders) * 100)
      : (monthOrders > 0 ? 100 : 0);

    const ordersDoDTrend = yesterdayOrders > 0
      ? Math.round(((todayOrders - yesterdayOrders) / yesterdayOrders) * 100)
      : (todayOrders > 0 ? 100 : 0);

    const usersMoMTrend = lastMonthUsers > 0
      ? Math.round(((monthUsers - lastMonthUsers) / lastMonthUsers) * 100)
      : (monthUsers > 0 ? 100 : 0);

    const usersDoDTrend = yesterdayUsers > 0
      ? Math.round(((todayUsers - yesterdayUsers) / yesterdayUsers) * 100)
      : (todayUsers > 0 ? 100 : 0);

    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const monthAov = monthOrders > 0 ? Math.round(monthRevenue / monthOrders) : 0;
    const lastMonthAov = lastMonthOrders > 0 ? Math.round(lastMonthRevenue / lastMonthOrders) : 0;
    const aovMoMTrend = lastMonthAov > 0
      ? Math.round(((monthAov - lastMonthAov) / lastMonthAov) * 100)
      : (monthAov > 0 ? 100 : 0);

    const payload = {
      success: true,
      data: {
        // Counts
        totalOrders, totalUsers, totalProducts,
        pendingOrders, confirmedOrders, packedOrders, shippedOrders,
        deliveredOrders, cancelledOrders, cancellationRequests,
        failedPayments, lowStockProducts, outOfStockProducts, pendingReviews,
        todayOrders, yesterdayOrders, monthOrders, lastMonthOrders,
        todayUsers, yesterdayUsers, monthUsers, lastMonthUsers,
        actionRequiredCount: pendingOrders + cancellationRequests,
        urgentOrders,
        // Revenue (only from paid orders)
        totalRevenue,
        onlineRevenue:      rev.onlineRevenue || 0,
        codRevenue:         rev.codRevenue || 0,
        refundedAmount:     rev.refundedAmount || 0,
        // Today & Yesterday
        todayRevenue,
        yesterdayRevenue,
        todayOnlineRevenue: rev.todayOnlineRevenue || 0,
        todayCODRevenue:    rev.todayCODRevenue || 0,
        // Monthly breakdown
        monthRevenue,
        lastMonthRevenue,
        monthOnlineRevenue: rev.monthOnlineRevenue || 0,
        monthCODRevenue:    rev.monthCODRevenue || 0,
        // AOV
        avgOrderValue,
        monthAov,
        lastMonthAov,
        // Real Computed Trends (MoM & DoD)
        revenueMoMTrend,
        revenueDoDTrend,
        ordersMoMTrend,
        ordersDoDTrend,
        usersMoMTrend,
        usersDoDTrend,
        aovMoMTrend,
      }
    };

    // Staggered TTL with Jitter (prevents synchronous cache stampedes)
    statsCache.set('admin:stats', payload, statsCache.TTL_TIERS?.REALTIME_STATS || 20_000);
    res.status(200).json(payload);
  } catch (error) {
    return serverError(res, error, 'adminController.js → getDashboardStats');
  }
};

// @desc    Get all users with customer 360 order spend and order count aggregation
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));

    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const role = typeof req.query.role === 'string' ? req.query.role.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    const matchQuery = {};
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matchQuery.$or = [
        { name:  { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      matchQuery.role = role;
    }

    if (status && status !== 'all') {
      if (status === 'active') matchQuery.isActive = true;
      if (status === 'suspended' || status === 'inactive') matchQuery.isActive = false;
    }

    // Dynamic sort configuration
    const sortConfig = {};
    if (sortBy === 'totalSpend' || sortBy === 'lifetimeSpend') {
      sortConfig.totalSpend = sortOrder;
    } else if (sortBy === 'totalOrders' || sortBy === 'orderCount') {
      sortConfig.totalOrders = sortOrder;
    } else if (sortBy === 'name') {
      sortConfig.name = sortOrder;
    } else {
      sortConfig.createdAt = sortOrder;
    }
    // Secondary deterministic sort
    sortConfig._id = -1;

    const aggregationPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'orders',
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $or: [
                        { $eq: ['$userId', '$$uid'] },
                        { $eq: ['$userId', { $toString: '$$uid' }] }
                      ]
                    },
                    {
                      $or: [
                        { $eq: ['$paymentMode', 'COD'] },
                        { $in: ['$paymentStatus', ['Paid', 'Refunded']] }
                      ]
                    }
                  ]
                }
              }
            },
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalSpend: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$orderStatus', 'Cancelled'] },
                          { $ne: ['$paymentStatus', 'Refunded'] }
                        ]
                      },
                      '$totalAmount',
                      0
                    ]
                  }
                },
                lastOrderDate: { $max: '$createdAt' }
              }
            }
          ],
          as: 'orderStats'
        }
      },
      {
        $addFields: {
          stats: { $arrayElemAt: ['$orderStats', 0] }
        }
      },
      {
        $project: {
          name: 1,
          email: 1,
          phone: 1,
          role: 1,
          isActive: 1,
          emailVerified: 1,
          createdAt: 1,
          lastLogin: 1,
          addresses: 1,
          address: 1,
          totalOrders: { $ifNull: ['$stats.totalOrders', 0] },
          orderCount: { $ifNull: ['$stats.totalOrders', 0] },
          totalSpend: { $round: [{ $ifNull: ['$stats.totalSpend', 0] }, 2] },
          lifetimeSpend: { $round: [{ $ifNull: ['$stats.totalSpend', 0] }, 2] },
          lastOrderDate: '$stats.lastOrderDate'
        }
      },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $sort: sortConfig },
            { $skip: (page - 1) * limit },
            { $limit: limit }
          ]
        }
      }
    ];

    const result = await User.aggregate(aggregationPipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const users = result[0]?.data || [];

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      data: users
    });
  } catch (error) {
    console.error('getAllUsers error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

// @desc    Get single user Customer 360 profile with complete order history and addresses
// @route   GET /api/admin/users/:id
// @access  Private/Admin
exports.getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires -emailVerificationToken -otpToken')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Fetch complete user order history
    const orders = await Order.find({
      $or: [
        { userId: user._id },
        { userId: user._id.toString() }
      ]
    })
      .sort({ createdAt: -1 })
      .lean();

    // Compute Customer 360 CRM statistics
    const realOrders = orders.filter(
      (o) => o.paymentMode === 'COD' || ['Paid', 'Refunded'].includes(o.paymentStatus)
    );
    const nonCancelledOrders = realOrders.filter(
      (o) => o.orderStatus !== 'Cancelled' && o.paymentStatus !== 'Refunded'
    );
    const totalOrders = realOrders.length;
    const totalSpend = nonCancelledOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
    const averageOrderValue = totalOrders > 0 ? (totalSpend / totalOrders) : 0;
    const firstOrderDate = realOrders.length > 0 ? realOrders[realOrders.length - 1].createdAt : null;
    const lastOrderDate = realOrders.length > 0 ? realOrders[0].createdAt : null;

    // Normalised delivery addresses list
    const addresses = Array.isArray(user.addresses) && user.addresses.length > 0
      ? user.addresses
      : (user.address && user.address.street ? [user.address] : []);

    const analytics = {
      totalOrders,
      orderCount: totalOrders,
      totalSpend: Math.round(totalSpend * 100) / 100,
      lifetimeSpend: Math.round(totalSpend * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      firstOrderDate,
      lastOrderDate
    };

    res.status(200).json({
      success: true,
      data: {
        ...user,
        user,
        addresses,
        analytics,
        totalOrders,
        orderCount: totalOrders,
        totalSpend: Math.round(totalSpend * 100) / 100,
        lifetimeSpend: Math.round(totalSpend * 100) / 100,
        orders
      }
    });
  } catch (error) {
    console.error('getUserDetails error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch customer profile.' });
  }
};

// @desc    Toggle user account status (Active / Suspended)
// @route   PUT /api/admin/users/:id/status
// @access  Private/Admin
exports.updateUserStatus = async (req, res) => {
  try {
    let isActive;
    if (typeof req.body.isActive === 'boolean') {
      isActive = req.body.isActive;
    } else if (typeof req.body.status === 'string') {
      isActive = req.body.status.toLowerCase() === 'active';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid status provided. Please specify isActive (boolean) or status ("active"/"suspended").'
      });
    }

    // Super-admin protection: Admin cannot suspend their own account
    if (req.params.id === req.user._id.toString() && !isActive) {
      return res.status(400).json({
        success: false,
        message: 'You cannot suspend your own administrative account.'
      });
    }

    const target = await User.findById(req.params.id).select('name email role isActive tokenVersion');
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Last admin protection: cannot suspend the last active administrator
    if (target.role === 'admin' && !isActive) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot suspend the last remaining active administrator.'
        });
      }
    }

    const updateQuery = { $set: { isActive } };
    // Immediately invalidate active sessions if suspended
    if (!isActive) {
      updateQuery.$inc = { tokenVersion: 1 };
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateQuery,
      { new: true, runValidators: true }
    ).select('name email phone role isActive createdAt lastLogin');

    // Audit log entry
    auditService.logAction({
      req,
      action: 'UPDATE',
      entityType: 'User',
      entityId: updatedUser._id,
      entityName: updatedUser.name,
      details: {
        action: isActive ? 'ACTIVATED' : 'SUSPENDED',
        previousStatus: target.isActive ? 'Active' : 'Suspended',
        newStatus: isActive ? 'Active' : 'Suspended'
      }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: `Account for ${updatedUser.name} has been ${isActive ? 'activated' : 'suspended'}.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('updateUserStatus error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update user status.' });
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

    // Audit log
    auditService.logAction({
      req,
      action: 'ROLE_CHANGE',
      entityType: 'User',
      entityId: user._id,
      entityName: user.name,
      details: { previousRole: target.role, newRole: role }
    }).catch(() => {});

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

      auditService.logAction({
        req,
        action: 'UPDATE',
        entityType: 'User',
        entityId: user._id,
        entityName: user.name,
        details: { action: 'DEACTIVATED', reason: 'User has existing orders' }
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: `${user.name} has ${orderCount} order(s), so the account was deactivated rather than deleted to preserve order history.`,
        data: { deactivated: true, orderCount }
      });
    }

    await auditService.logDeletion({
      req,
      entityType: 'User',
      entityId: user._id,
      entityName: user.name,
      deletionReason: 'Account removed by administrator',
      snapshot: user.toObject()
    });

    await User.findByIdAndDelete(user._id);
    res.status(200).json({ success: true, message: 'User deleted successfully', data: { deactivated: false } });
  } catch (error) {
    console.error('deleteUser error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
};

// ─── Helper: Build standard date range ────────────────────────────────────────
const getDateRange = (period = '30days', year, month) => {
  let startDate, endDate = new Date();
  const now = new Date();
  const p = (period || '').toLowerCase();

  if (p === 'today' || p === '1d') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (p === '7days' || p === '7d') {
    startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
  } else if (p === '30days' || p === '30d') {
    startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
  } else if (p === '90days' || p === '90d') {
    startDate = new Date(); startDate.setDate(startDate.getDate() - 90);
  } else if (p === 'thismonth') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (p === 'lastmonth') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else if (p === 'specificmonth' && year && month) {
    const y = parseInt(year), m = parseInt(month) - 1;
    startDate = new Date(y, m, 1);
    endDate   = new Date(y, m + 1, 0, 23, 59, 59);
  } else if (p === 'yearly' || p === '1y' || p === 'thisyear') {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else {
    startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
  }

  return { startDate, endDate };
};

// ─── Helper: Populate zero-revenue days in time series rather than skipping ──────
const fillZeroRevenueDays = (rawDaily = [], startDate, endDate = new Date()) => {
  const map = new Map();
  rawDaily.forEach(item => {
    if (item._id) map.set(item._id, item);
  });

  const filled = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;

    if (map.has(dateKey)) {
      filled.push(map.get(dateKey));
    } else {
      filled.push({
        _id: dateKey,
        date: dateKey,
        revenue: 0,
        onlineRevenue: 0,
        codRevenue: 0,
        orders: 0,
        onlineOrders: 0,
        codOrders: 0
      });
    }
    current.setDate(current.getDate() + 1);
  }

  return filled;
};

// @desc    Get dedicated revenue dashboard data (financial metrics, payouts, ledger)
// @route   GET /api/admin/revenue
// @access  Private/Admin
exports.getRevenueOverview = async (req, res) => {
  try {
    const period = req.query.timeframe || req.query.period || '30days';
    const { year, month } = req.query;
    const cacheKey = `admin:revenue:${period}:${year || ''}:${month || ''}`;

    const data = await statsCache.remember(
      cacheKey,
      statsCache.TTL_TIERS?.REVENUE_ANALYTICS || 150_000,
      async () => {
      const { startDate, endDate } = getDateRange(period, year, month);
      const now = new Date();
      const baseMatch = { paymentStatus: 'Paid', createdAt: { $gte: startDate, $lte: endDate } };
      const periodOrderMatch = { createdAt: { $gte: startDate, $lte: endDate } };

      const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

      // Run all aggregation queries in parallel
      const [
        financialAgg,
        dailyRevenue,
        monthlyRevenue,
        paymentSplit,
        categoryRevenue,
        topCustomers,
        recentTransactions
      ] = await Promise.all([
        // 1. Core Financial KPI Aggregation
        Order.aggregate([
          { $match: periodOrderMatch },
          {
            $group: {
              _id: null,
              grossRevenue: {
                $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalAmount', 0] }
              },
              onlineRevenue: {
                $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'Online'] }] }, '$totalAmount', 0] }
              },
              codRevenue: {
                $sum: { $cond: [{ $and: [{ $eq: ['$paymentStatus', 'Paid'] }, { $eq: ['$paymentMode', 'COD'] }] }, '$totalAmount', 0] }
              },
              refundedAmount: {
                $sum: { $cond: [{ $eq: ['$paymentStatus', 'Refunded'] }, '$totalAmount', { $ifNull: ['$refund.refundAmount', 0] }] }
              },
              paidOrdersCount: {
                $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, 1, 0] }
              },
              refundedOrdersCount: {
                $sum: { $cond: [{ $eq: ['$paymentStatus', 'Refunded'] }, 1, { $cond: [{ $gt: [{ $ifNull: ['$refund.refundAmount', 0] }, 0] }, 1, 0] }] }
              }
            }
          }
        ]),

        // 2. Daily Revenue Trend (Indexed on { paymentStatus: 1, createdAt: -1 })
        Order.aggregate([
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
        ]),

        // 3. 12-Month Revenue Summary (For yearly comparisons)
        Order.aggregate([
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
        ]),

        // 4. Payment Split Breakdown
        Order.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: '$paymentMode',
              revenue:       { $sum: '$totalAmount' },
              orders:        { $sum: 1 },
              avgOrderValue: { $avg: '$totalAmount' }
            }
          }
        ]),

        // 5. Category Revenue & Profitability
        Order.aggregate([
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
        ]),

        // 6. Top Customers by Revenue (Indexed on userId + paymentStatus)
        Order.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: '$userId',
              totalSpent: { $sum: '$totalAmount' },
              orderCount: { $sum: 1 }
            }
          },
          { $sort: { totalSpent: -1 } },
          { $limit: 8 },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'user'
            }
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              name: { $ifNull: ['$user.name', 'Guest Customer'] },
              email: { $ifNull: ['$user.email', 'N/A'] },
              phone: { $ifNull: ['$user.phone', ''] },
              totalSpent: 1,
              orderCount: 1
            }
          }
        ]),

        // 7. Recent Financial Transactions Ledger (Projections for slimming payload)
        Order.find({ paymentStatus: { $in: ['Paid', 'Refunded'] }, createdAt: { $gte: startDate, $lte: endDate } })
          .select('_id orderNumber userId totalAmount paymentMode paymentStatus refund createdAt')
          .populate('userId', 'name email phone')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean()
      ]);

      const fin = financialAgg[0] || {};
      const grossRevenue = fin.grossRevenue || 0;
      const onlineRevenue = fin.onlineRevenue || 0;
      const codRevenue = fin.codRevenue || 0;
      const refundedAmount = fin.refundedAmount || 0;
      const paidOrdersCount = fin.paidOrdersCount || 0;
      const refundedOrdersCount = fin.refundedOrdersCount || 0;

      // Estimated Payment Gateway processing fee (~2% on Online/UPI payments)
      const estimatedGatewayFees = Math.round(onlineRevenue * 0.02);
      const netRevenue = Math.max(0, grossRevenue - refundedAmount - estimatedGatewayFees);
      const avgOrderValue = paidOrdersCount > 0 ? Math.round(grossRevenue / paidOrdersCount) : 0;

      // Transform ledger items
      const ledger = (recentTransactions || []).map((t) => {
        const isOnline = t.paymentMode === 'Online';
        const fee = isOnline && t.paymentStatus === 'Paid' ? Math.round(t.totalAmount * 0.02) : 0;
        const net = t.paymentStatus === 'Refunded' ? 0 : Math.max(0, t.totalAmount - fee);
        return {
          _id: t._id,
          orderNumber: t.orderNumber,
          customerName: t.userId?.name || 'Customer',
          customerEmail: t.userId?.email || '',
          customerPhone: t.userId?.phone || '',
          date: t.createdAt,
          paymentMode: t.paymentMode,
          paymentStatus: t.paymentStatus,
          grossAmount: t.totalAmount,
          gatewayFee: fee,
          netAmount: net,
          refundStatus: t.refund?.refundStatus || (t.paymentStatus === 'Refunded' ? 'Processed' : null)
        };
      });

      return {
        period,
        kpis: {
          grossRevenue,
          netRevenue,
          onlineRevenue,
          codRevenue,
          refundedAmount,
          estimatedGatewayFees,
          avgOrderValue,
          paidOrdersCount,
          refundedOrdersCount
        },
        dailyRevenue: fillZeroRevenueDays(dailyRevenue, startDate, endDate),
        monthlyRevenue,
        paymentSplit,
        categoryRevenue,
        topCustomers,
        recentTransactions: ledger
      };
    });

    res.set('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return serverError(res, error, 'adminController.js → getRevenueOverview');
  }
};

// @desc    Get user behavior, operations & product velocity analytics
// @route   GET /api/admin/analytics
// @access  Private/Admin
exports.getSalesAnalytics = async (req, res) => {
  try {
    const period = req.query.timeframe || req.query.period || '30days';
    const { year, month } = req.query;
    const cacheKey = `admin:analytics:${period}:${year || ''}:${month || ''}`;

    const data = await statsCache.remember(
      cacheKey,
      statsCache.TTL_TIERS?.BEHAVIOR_ANALYTICS || 360_000,
      async () => {
      const { startDate, endDate } = getDateRange(period, year, month);
      const now = new Date();
      const baseMatch = { paymentStatus: 'Paid', createdAt: { $gte: startDate, $lte: endDate } };
      const periodMatch = { createdAt: { $gte: startDate, $lte: endDate } };
      const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

      // Run all aggregation pipelines concurrently
      const [
        dailyRevenue,
        monthlyRevenue,
        paymentSplit,
        topProducts,
        categoryRevenue,
        fulfillmentFunnel,
        hourlyDistribution,
        geographicDistribution,
        lowStockRisk
      ] = await Promise.all([
        // 1. Daily revenue trend
        Order.aggregate([
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
        ]),

        // 2. 12-month trend
        Order.aggregate([
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
        ]),

        // 3. Payment split
        Order.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: '$paymentMode',
              revenue:       { $sum: '$totalAmount' },
              orders:        { $sum: 1 },
              avgOrderValue: { $avg: '$totalAmount' }
            }
          }
        ]),

        // 4. Top selling products with lean projection
        Order.aggregate([
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
              stock: '$productDoc.stock',
              totalSold: 1,
              revenue: 1
            }
          }
        ]),

        // 5. Category distribution
        Order.aggregate([
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
        ]),

        // 6. Order Fulfillment Funnel & Conversion Rates
        Order.aggregate([
          { $match: periodMatch },
          {
            $group: {
              _id: '$orderStatus',
              count: { $sum: 1 },
              totalVolume: { $sum: '$totalAmount' }
            }
          }
        ]),

        // 7. Peak Shopping / Ordering Hours Heatmap (Hour 0 to 23)
        Order.aggregate([
          { $match: periodMatch },
          {
            $group: {
              _id: { $hour: { date: '$createdAt', timezone: '+05:30' } },
              orderCount: { $sum: 1 },
              volume: { $sum: '$totalAmount' }
            }
          },
          { $sort: { _id: 1 } }
        ]),

        // 8. Geographical Distribution (Top States across India)
        Order.aggregate([
          { $match: { ...baseMatch, 'shippingAddress.state': { $exists: true, $ne: '' } } },
          {
            $group: {
              _id: '$shippingAddress.state',
              orderCount: { $sum: 1 },
              revenue: { $sum: '$totalAmount' }
            }
          },
          { $sort: { revenue: -1 } },
          { $limit: 10 }
        ]),

        // 9. Stock Depletion & Velocity Risk Check
        Product.find({ isActive: true, isDeleted: { $ne: true }, stock: { $lte: 15 } })
          .select('name stock price categoryId images')
          .populate('categoryId', 'name')
          .sort({ stock: 1 })
          .limit(8)
          .lean()
      ]);

      // Calculate funnel summary
      let totalAllOrders = 0;
      let deliveredOrders = 0;
      let cancelledOrders = 0;
      let inTransitOrders = 0;

      (fulfillmentFunnel || []).forEach((f) => {
        totalAllOrders += f.count;
        if (f._id === 'Delivered') deliveredOrders += f.count;
        else if (f._id === 'Cancelled' || f._id === 'CancellationRequested') cancelledOrders += f.count;
        else inTransitOrders += f.count;
      });

      const fulfillmentRate = totalAllOrders > 0 ? Math.round((deliveredOrders / totalAllOrders) * 100) : 0;
      const cancellationRate = totalAllOrders > 0 ? Math.round((cancelledOrders / totalAllOrders) * 100) : 0;

      return {
        period,
        dailyRevenue: fillZeroRevenueDays(dailyRevenue, startDate, endDate),
        monthlyRevenue,
        paymentSplit,
        topProducts,
        categoryRevenue,
        // Behavioral & Operational Metrics
        operational: {
          totalOrders: totalAllOrders,
          deliveredOrders,
          cancelledOrders,
          inTransitOrders,
          fulfillmentRate,
          cancellationRate,
          fulfillmentFunnel,
          hourlyDistribution,
          geographicDistribution,
          lowStockRisk
        }
      };
    });

    res.set('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ success: true, data });
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
    const cacheKey = `admin:lowstock:${threshold}`;

    const lowStock = await statsCache.remember(
      cacheKey,
      statsCache.TTL_TIERS?.LOW_STOCK || 35_000,
      async () => {
        const products = await Product.find({
          isActive: true,
          isDeleted: { $ne: true }
        })
          .populate('categoryId', 'name')
          .lean();

        return products
          .map((p) => {
            if (Array.isArray(p.packages) && p.packages.length > 0) {
              const totalStock = p.packages.reduce((sum, pkg) => sum + (Number(pkg.stock) || 0), 0);
              return { ...p, stock: totalStock };
            }
            return p;
          })
          .filter((p) => (p.stock ?? 0) <= threshold)
          .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
      }
    );

    res.status(200).json({
      success: true,
      count: (lowStock || []).length,
      data: lowStock || []
    });
  } catch (error) {
    return serverError(res, error, 'adminController.js → getLowStockProducts');
  }
};
