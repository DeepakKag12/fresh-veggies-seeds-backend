const Order = require('../models/Order');
const Product = require('../models/Product');
const Combo = require('../models/Combo');
const dtdcService = require('../services/dtdcService');
const razorpayService = require('../services/razorpayService');
const { validateOrderItems, validateShippingAddress } = require('../utils/orderValidation');

// ─── Delivery charge constants ───────────────────────────────────────────────
const FREE_DELIVERY_THRESHOLD = 300; // ₹
const DELIVERY_CHARGE = 50;          // ₹

// ─── Allowed order-status state machine ──────────────────────────────────────
// Only these forward/backward transitions are permitted for admin status updates
const ALLOWED_TRANSITIONS = {
  Pending:               ['Confirmed', 'Cancelled'],
  Confirmed:             ['Packed', 'Cancelled'],
  Packed:                ['Shipped', 'Cancelled'],
  Shipped:               ['Delivered'],
  Delivered:             [],            // terminal
  Cancelled:             [],            // terminal
  CancellationRequested: ['Confirmed', 'Packed', 'Shipped'], // admin reject restores
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch verified prices for each cart item directly from the database.
 * Returns { items, computedItemsPrice } or throws on bad input.
 */
async function buildVerifiedItems(orderItems) {
  const verifiedItems = [];
  let computedItemsPrice = 0;

  for (const item of orderItems) {
    if (!item.product || !item.productType || !item.quantity || item.quantity < 1) {
      throw new Error('Invalid order item structure');
    }

    let dbPrice;
    let dbName;
    let dbImage;

    if (item.productType === 'Product') {
      const product = await Product.findById(item.product).select('price name images isActive stock packages');
      if (!product || !product.isActive) throw new Error(`Product "${item.product}" not found or unavailable`);
      if (product.stock !== undefined && product.packages.length === 0 && product.stock < item.quantity) {
        throw new Error(`Insufficient stock for "${product.name}"`);
      }

      // If the item has a packageId, look up the package price
      if (item.packageId) {
        const pkg = product.packages.id(item.packageId);
        if (!pkg) throw new Error(`Package not found for "${product.name}"`);
        if (pkg.stock < item.quantity) throw new Error(`Insufficient package stock for "${product.name}"`);
        dbPrice = pkg.price;
      } else {
        dbPrice = product.price;
      }

      dbName  = product.name;
      dbImage = product.images?.[0] || '';
    } else if (item.productType === 'Combo') {
      const combo = await Combo.findById(item.product).select('price name images isActive');
      if (!combo || !combo.isActive) throw new Error(`Combo "${item.product}" not found or unavailable`);
      dbPrice = combo.price;
      dbName  = combo.name;
      dbImage = combo.images?.[0] || '';
    } else {
      throw new Error(`Unknown productType: ${item.productType}`);
    }

    verifiedItems.push({
      product:     item.product,
      productType: item.productType,
      name:        dbName,
      quantity:    item.quantity,
      price:       dbPrice, // always server-sourced price
      image:       dbImage,
      ...(item.packageId ? { packageId: item.packageId } : {})
    });
    computedItemsPrice += dbPrice * item.quantity;
  }

  return { verifiedItems, computedItemsPrice };
}

// @desc    Create new COD order (server-side price validation)
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    const { orderItems, shippingAddress, paymentMode, discountAmount = 0, couponUsed = null } = req.body;

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No order items provided' });
    }

    if (paymentMode === 'Online') {
      return res.status(400).json({
        success: false,
        message: 'Use POST /api/payments/create-order for online payments'
      });
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const itemsCheck = validateOrderItems(orderItems);
    if (!itemsCheck.valid) return res.status(400).json({ success: false, message: itemsCheck.message });

    const addrCheck = validateShippingAddress(shippingAddress);
    if (!addrCheck.valid) return res.status(400).json({ success: false, message: addrCheck.message });

    // ── Server-side price computation ─────────────────────────────────────────
    let verifiedItems, computedItemsPrice;
    try {
      ({ verifiedItems, computedItemsPrice } = await buildVerifiedItems(orderItems));
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    // ── Server-side delivery charge ───────────────────────────────────────────
    const shippingPrice = computedItemsPrice >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_CHARGE;

    // ── Apply discount (sanity-capped — cannot exceed items price) ────────────
    const safeDiscount = Math.min(Number(discountAmount) || 0, computedItemsPrice);
    const computedTotal = computedItemsPrice + shippingPrice - safeDiscount;

    const order = await Order.create({
      userId: req.user._id,
      orderItems: verifiedItems,
      shippingAddress,
      paymentMode: paymentMode || 'COD',
      paymentStatus: 'Pending',
      orderStatus: 'Pending',
      itemsPrice: computedItemsPrice,
      shippingPrice,
      discountAmount: safeDiscount,
      couponUsed: safeDiscount > 0 ? couponUsed : null,
      totalAmount: computedTotal
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

// @desc    Get all orders (Admin) — paginated
// @route   GET /api/orders
// @access  Private/Admin
exports.getAllOrders = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const skip   = (page - 1) * limit;

    // Whitelist status values — never pass raw query objects into Mongoose
    const VALID_STATUSES = ['Pending','Confirmed','Packed','Shipped','Delivered','Cancelled','CancellationRequested'];
    const rawStatus = req.query.status;
    const status = (typeof rawStatus === 'string' && VALID_STATUSES.includes(rawStatus)) ? rawStatus : null;

    const query = {};
    if (status) query.orderStatus = status;

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('userId', 'name email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: orders
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update order status (Admin) — enforces state machine
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderStatus } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const allowed = ALLOWED_TRANSITIONS[order.orderStatus] || [];
    if (!allowed.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from "${order.orderStatus}" to "${orderStatus}". Allowed: [${allowed.join(', ') || 'none'}]`
      });
    }

    order.orderStatus = orderStatus;

    if (orderStatus === 'Delivered') {
      order.deliveredAt = Date.now();
      // COD: mark paid on delivery
      if (order.paymentMode === 'COD') order.paymentStatus = 'Paid';
    }

    if (orderStatus === 'Cancelled') {
      order.cancelledAt = Date.now();
    }

    await order.save();

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Request order cancellation (user)
// @route   PUT /api/orders/:id/cancel
// @access  Private
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (['Delivered', 'Cancelled', 'CancellationRequested'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: order.orderStatus === 'CancellationRequested'
          ? 'Cancellation request already submitted. Awaiting admin approval.'
          : `Cannot request cancellation for a ${order.orderStatus.toLowerCase()} order.`
      });
    }

    const { reason } = req.body;

    order.cancellationRequest = {
      reason: reason || 'No reason provided',
      requestedAt: new Date(),
      previousStatus: order.orderStatus
    };
    order.orderStatus = 'CancellationRequested';

    await order.save();

    res.status(200).json({
      success: true,
      data: order,
      message: 'Cancellation request submitted. Admin will review and process it shortly.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Approve cancellation request + auto-refund (Admin)
// @route   PUT /api/orders/:id/approve-cancel
// @access  Private/Admin
exports.approveCancellation = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.orderStatus !== 'CancellationRequested') {
      return res.status(400).json({ success: false, message: 'No pending cancellation request for this order.' });
    }

    // ── Idempotency: already cancelled/refunded means someone hit this twice ──
    if (order.orderStatus === 'Cancelled') {
      return res.status(409).json({ success: false, message: 'Order is already cancelled.' });
    }
    if (order.refund?.refundStatus === 'Processed') {
      return res.status(409).json({ success: false, message: 'Refund already processed for this order.' });
    }

    // Cancel DTDC shipment if shipped
    if (order.shipping && order.shipping.awbNumber) {
      await dtdcService.cancelShipment(order.shipping.awbNumber).catch(err =>
        console.error('DTDC cancel error:', err.message)
      );
    }

    order.orderStatus = 'Cancelled';
    order.cancelledAt = new Date();

    // Auto-refund for online paid orders only — guarded against double-refund
    if (order.paymentMode === 'Online' && order.paymentStatus === 'Paid') {
      const paymentId = order.paymentDetails?.razorpayPaymentId;
      if (paymentId) {
        try {
          const refundResponse = await razorpayService.refundPayment(paymentId, order.totalAmount);
          if (refundResponse.success) {
            order.paymentStatus = 'Refunded';
            order.refund = {
              refundId: refundResponse.data.id,
              refundAmount: order.totalAmount,
              refundStatus: 'Processed',
              refundedAt: new Date(),
              reason: order.cancellationRequest?.reason || 'Admin approved cancellation'
            };
          } else {
            order.refund = {
              refundAmount: order.totalAmount,
              refundStatus: 'Failed',
              reason: refundResponse.message
            };
          }
        } catch (refundError) {
          console.error('Refund error:', refundError.message);
          order.refund = {
            refundAmount: order.totalAmount,
            refundStatus: 'Failed',
            reason: refundError.message
          };
        }
      }
    }

    await order.save();

    const refundMsg = order.refund?.refundStatus === 'Processed'
      ? ` Refund of ₹${order.totalAmount} initiated — credits in 5-7 business days.`
      : '';

    res.status(200).json({
      success: true,
      data: order,
      message: `Cancellation approved.${refundMsg}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reject cancellation request (Admin)
// @route   PUT /api/orders/:id/reject-cancel
// @access  Private/Admin
exports.rejectCancellation = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.orderStatus !== 'CancellationRequested') {
      return res.status(400).json({ success: false, message: 'No pending cancellation request for this order.' });
    }

    const { rejectionReason } = req.body;
    const previousStatus = order.cancellationRequest?.previousStatus || 'Confirmed';

    // Restore previous status and store rejection reason
    order.cancellationRequest.rejectedAt = new Date();
    order.cancellationRequest.rejectionReason = rejectionReason || 'Cancellation request rejected by admin.';
    order.orderStatus = previousStatus;

    await order.save();

    res.status(200).json({
      success: true,
      data: order,
      message: `Cancellation request rejected. Order restored to "${previousStatus}".`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
