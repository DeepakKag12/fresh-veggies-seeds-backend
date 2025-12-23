const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Review = require('../models/Review');

// @desc    Get dashboard stats
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getDashboardStats = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalUsers = await User.countDocuments({ role: 'customer' });
    const totalProducts = await Product.countDocuments();
    
    const revenueData = await Order.aggregate([
      { $match: { orderStatus: { $ne: 'Cancelled' } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    
    const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

    const pendingOrders = await Order.countDocuments({ orderStatus: 'Pending' });
    const deliveredOrders = await Order.countDocuments({ orderStatus: 'Delivered' });
    const lowStockProducts = await Product.countDocuments({ stock: { $lt: 10 } });
    const pendingReviews = await Review.countDocuments({ isApproved: false });

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = await Order.countDocuments({ createdAt: { $gte: today } });
    const todayRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: today }, orderStatus: { $ne: 'Cancelled' } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalOrders,
        totalUsers,
        totalProducts,
        totalRevenue,
        pendingOrders,
        deliveredOrders,
        lowStockProducts,
        pendingReviews,
        todayOrders,
        todayRevenue: todayRevenue.length > 0 ? todayRevenue[0].total : 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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
    const { period = '7days' } = req.query;
    
    let startDate = new Date();
    if (period === '7days') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30days') {
      startDate.setDate(startDate.getDate() - 30);
    } else if (period === '90days') {
      startDate.setDate(startDate.getDate() - 90);
    }

    // Daily revenue
    const dailyRevenue = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          orderStatus: { $ne: 'Cancelled' }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Top selling products
    const topProducts = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          orderStatus: { $ne: 'Cancelled' }
        }
      },
      { $unwind: '$orderItems' },
      {
        $group: {
          _id: '$orderItems.productId',
          quantity: { $sum: '$orderItems.quantity' },
          revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' }
    ]);

    // Revenue by category
    const categoryRevenue = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          orderStatus: { $ne: 'Cancelled' }
        }
      },
      { $unwind: '$orderItems' },
      {
        $lookup: {
          from: 'products',
          localField: 'orderItems.productId',
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
          orders: { $sum: 1 }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        dailyRevenue,
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
