const Order = require('../models/Order');
const Product = require('../models/Product');
const Combo = require('../models/Combo');
const dtdcService = require('../services/dtdcService');
const User = require('../models/User');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    const {
      orderItems,
      shippingAddress,
      paymentMode,
      itemsPrice,
      shippingPrice,
      totalAmount
    } = req.body;

    if (orderItems && orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No order items'
      });
    }

    const order = await Order.create({
      userId: req.user._id,
      orderItems,
      shippingAddress,
      paymentMode,
      itemsPrice,
      shippingPrice,
      totalAmount
    });

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get user orders
// @route   GET /api/orders/myorders
// @access  Private
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order belongs to user or user is admin
    if (order.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all orders (Admin)
// @route   GET /api/orders
// @access  Private/Admin
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update order status (Admin)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderStatus } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.orderStatus = orderStatus;

    if (orderStatus === 'Delivered') {
      order.deliveredAt = Date.now();
      order.paymentStatus = 'Paid';
    }

    if (orderStatus === 'Cancelled') {
      order.cancelledAt = Date.now();
    }

    await order.save();

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order belongs to user
    if (order.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Only allow cancellation if order is pending or confirmed
    if (order.orderStatus === 'Packed' || order.orderStatus === 'Shipped' || order.orderStatus === 'Delivered') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel order at this stage'
      });
    }

    // Cancel DTDC shipment if it exists
    if (order.shipping && order.shipping.awbNumber) {
      await dtdcService.cancelShipment(order.shipping.awbNumber);
    }

    order.orderStatus = 'Cancelled';
    order.cancelledAt = Date.now();
    await order.save();

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create DTDC shipment for order (Admin)
// @route   POST /api/orders/:id/ship
// @access  Private/Admin
exports.createShipment = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if already shipped
    if (order.shipping && order.shipping.awbNumber) {
      return res.status(400).json({
        success: false,
        message: 'Order already has a shipment'
      });
    }

    // Create DTDC shipment
    const shipmentResult = await dtdcService.createShipment(order);

    if (!shipmentResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create shipment',
        error: shipmentResult.error
      });
    }

    // Update order with shipping details
    order.shipping = {
      courierName: shipmentResult.courierName,
      awbNumber: shipmentResult.awbNumber,
      trackingUrl: shipmentResult.trackingUrl,
      shippedAt: new Date(),
      estimatedDelivery: shipmentResult.estimatedDelivery
    };
    order.orderStatus = 'Shipped';

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Shipment created successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Track order shipment
// @route   GET /api/orders/:id/track
// @access  Private
exports.trackOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order belongs to user or user is admin
    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to track this order'
      });
    }

    if (!order.shipping || !order.shipping.awbNumber) {
      return res.status(400).json({
        success: false,
        message: 'Order not yet shipped'
      });
    }

    // Get tracking info from DTDC
    const trackingResult = await dtdcService.trackShipment(order.shipping.awbNumber);

    if (trackingResult.success) {
      // Update order tracking history
      order.shipping.trackingHistory = trackingResult.statusHistory;
      await order.save();
    }

    res.status(200).json({
      success: true,
      tracking: trackingResult,
      order: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Check pincode serviceability
// @route   GET /api/orders/check-pincode/:pincode
// @access  Public
exports.checkPincodeServiceability = async (req, res) => {
  try {
    const { pincode } = req.params;

    const result = await dtdcService.checkPincodeServiceability(pincode);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
