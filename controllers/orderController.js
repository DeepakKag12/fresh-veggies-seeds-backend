const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const dtdcService = require('../services/dtdcService');
const razorpayService = require('../services/razorpayService');
const stockService = require('../services/stockService');
const { validateOrderItems, validateShippingAddress } = require('../utils/orderValidation');
const couponService = require('../services/couponService');
const { buildVerifiedItems } = require('../services/pricingService');
const notify        = require('../services/orderNotificationService');
const statsCache = require('../utils/statsCache');
const { serverError } = require('../utils/respond');

// Pricing rules and the status state machine are shared with paymentController
// so COD and online checkouts can never price or transition differently.
const {
  computeShippingPrice,
  getShippingRules,
  ALLOWED_TRANSITIONS,
  SHIPPABLE_STATUSES,
} = require('../config/orderConfig');
const Settings = require('../models/Settings');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const saveAddressToUser = async (userId, shippingAddress) => {
  try {
    if (!userId || !shippingAddress || !shippingAddress.street) return;
    const user = await User.findById(userId);
    if (!user) return;

    if (!user.addresses) user.addresses = [];

    // Check if address already exists (same street and pincode)
    const exists = user.addresses.some(
      a => (a.street || '').trim().toLowerCase() === (shippingAddress.street || '').trim().toLowerCase() &&
           (a.pincode || '').trim() === (shippingAddress.pincode || '').trim()
    );

    const isFirst = user.addresses.length === 0;

    if (!exists) {
      user.addresses.push({
        name: shippingAddress.name || user.name,
        phone: shippingAddress.phone || user.phone,
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state,
        pincode: shippingAddress.pincode,
        country: shippingAddress.country || 'India',
        isDefault: isFirst,
        createdAt: new Date()
      });
    }

    // Update user.address to the latest shipping address if user.address is empty or this is first address
    if (!user.address?.street || isFirst) {
      user.address = {
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state,
        pincode: shippingAddress.pincode,
        country: shippingAddress.country || 'India'
      };
    }

    // Update user name if currently default
    if (shippingAddress.name && (!user.name || user.name.startsWith('Customer '))) {
      user.name = shippingAddress.name;
    }

    // Save optional email if not yet set on profile and not already registered to another user
    if (shippingAddress.email && !user.email) {
      const emailCandidate = shippingAddress.email.trim().toLowerCase();
      const existingUserWithEmail = await User.findOne({ email: emailCandidate, _id: { $ne: user._id } });
      if (!existingUserWithEmail) {
        user.email = emailCandidate;
      }
    }

    await user.save({ validateBeforeSave: false });
  } catch (err) {
    console.error('Error saving address to user profile:', err.message);
  }
};

// @desc    Create new COD order (server-side price validation)
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    // NOTE: couponCode, never a discount amount. The discount is computed
    // server-side from the code — see couponService.
    const { orderItems, shippingAddress, paymentMode, couponCode = null } = req.body;

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
      // Availability problems are a conflict with current stock (409), not a
      // malformed request (400) — the client sent something perfectly valid.
      const outOfStock = /sold out|left of/i.test(e.message);
      return res.status(outOfStock ? 409 : 400).json({ success: false, message: e.message });
    }

    // ── Load dynamic store rules ─────────────────────────────────────────────
    const rules = await getShippingRules();

    // Minimum basket requirement
    if (rules.minOrderAmount && computedItemsPrice < rules.minOrderAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount is ₹${rules.minOrderAmount}. Current items total is ₹${computedItemsPrice}.`
      });
    }

    // COD availability check
    if ((paymentMode === 'COD' || !paymentMode) && !rules.codAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Cash on Delivery is currently disabled. Please choose Online Payment.'
      });
    }

    // ── Server-side delivery charge ───────────────────────────────────────────
    const shippingPrice = computeShippingPrice(computedItemsPrice, rules.freeDeliveryThreshold, rules.deliveryCharge);

    // ── Coupon: validated and priced on the server, then claimed ──────────────
    let discountAmount = 0;
    let couponUsed = null;
    try {
      ({ discountAmount, couponUsed } = await couponService.applyCouponToOrder(
        couponCode, computedItemsPrice, req.user._id
      ));
    } catch (e) {
      if (e.isCouponError) return res.status(400).json({ success: false, message: e.message });
      throw e;
    }

    const codExtraCharge = (paymentMode === 'COD' || !paymentMode) ? (rules.codExtraCharge || 0) : 0;
    const computedTotal = computedItemsPrice + shippingPrice + codExtraCharge - discountAmount;

    // COD maximum limit check
    if ((paymentMode === 'COD' || !paymentMode) && rules.codMaxOrder && computedTotal > rules.codMaxOrder) {
      if (couponUsed?.couponId) await couponService.releaseCoupon(couponUsed.couponId).catch(() => {});
      return res.status(400).json({
        success: false,
        message: `Cash on Delivery is only available for orders up to ₹${rules.codMaxOrder}. Please use Online Payment.`
      });
    }

    // ── Reserve stock atomically, before the order exists ─────────────────────
    // buildVerifiedItems only *checks* availability. Two customers racing for
    // the last unit both passed that check and both got an order. Claiming the
    // units here means the database picks exactly one winner and the other is
    // told it is sold out straight away, instead of finding out at confirmation.
    try {
      await stockService.reserveStock(verifiedItems);
    } catch (e) {
      // Give back anything the coupon claim already took.
      if (couponUsed?.couponId) {
        await couponService.releaseCoupon(couponUsed.couponId).catch(() => {});
      }
      return res.status(e.statusCode || 409).json({ success: false, message: e.message });
    }

    let order;
    try {
      order = await Order.create({
        userId: req.user._id,
        orderItems: verifiedItems,
        shippingAddress,
        paymentMode: paymentMode || 'COD',
        paymentStatus: 'Pending',
        orderStatus: 'Pending',
        itemsPrice: computedItemsPrice,
        shippingPrice,
        discountAmount,
        codExtraCharge,
        couponUsed,
        totalAmount: Math.max(0, computedTotal),
        // Units were claimed above, so confirmation must not take them twice.
        stockDecremented: true,
        statusHistory: [{ status: 'Pending', changedAt: new Date(), note: 'Order placed' }]
      });

      // Invalidate admin stats cache so dashboard reflects new order immediately
      statsCache.invalidate('admin:');
    } catch (createErr) {
      // The coupon use was claimed before the order existed — hand it back so a
      // failed insert does not silently burn one of the customer's allowance.
      if (couponUsed?.couponId) await couponService.releaseCoupon(couponUsed.couponId).catch(() => {});
      // Return reserved stock so inventory does not leak on database insertion error.
      await stockService.restoreReservedStock(verifiedItems).catch((e) =>
        console.error('⚠️  Failed to restore reserved stock on order create failure:', e.message)
      );
      throw createErr;
    }

    // ── Save address to user profile for future orders ───────────────────────
    saveAddressToUser(req.user._id, shippingAddress).catch(() => {});

    // ── Notify (fire-and-forget: a mail outage must not fail a placed order) ──
    notify.sendOrderConfirmation(order, req.user).catch((e) =>
      console.error('⚠️  Order confirmation email failed:', e.message));
    notify.notifyAdminNewOrder(order, req.user).catch((e) =>
      console.error('⚠️  Admin new-order alert failed:', e.message));

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    return serverError(res, error, 'orderController.js → createOrder');
  }
};

// @desc    Get user orders
// @route   GET /api/orders/myorders
// @access  Private
exports.getMyOrders = async (req, res) => {
  try {
    // Same real-order filter as getAllOrders:
    // COD orders are always real; Online orders only shown if payment succeeded/refunded
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const filter = {
      userId: req.user._id,
      $or: [
        { paymentMode: 'COD' },
        { paymentStatus: { $in: ['Paid', 'Refunded'] } }
      ]
    };

    // Paginated: a long-standing customer previously got every order they had
    // ever placed in one unbounded response.
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
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
    return serverError(res, error, 'orderController.js → getMyOrders');
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone')
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order belongs to user or user is admin
    const orderUserId = order.userId?._id ? order.userId._id.toString() : (order.userId?.toString() || '');
    if (orderUserId !== req.user._id.toString() && req.user.role !== 'admin') {
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
    return serverError(res, error, 'orderController.js → getOrder');
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

    // Whitelist status values — support case-insensitivity & special filters
    const VALID_STATUSES = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'CancellationRequested'];
    const rawStatus = (req.query.status || '').trim();
    const rawPaymentStatus = (req.query.paymentStatus || '').trim();
    const rawPeriod = (req.query.period || '').trim().toLowerCase();
    const search = (req.query.search || '').trim();

    let matchedStatus = null;
    let isActionRequired = false;

    if (rawStatus) {
      if (rawStatus.toLowerCase() === 'action_required' || rawStatus.toLowerCase() === 'actionrequired') {
        isActionRequired = true;
      } else {
        matchedStatus = VALID_STATUSES.find((s) => s.toLowerCase() === rawStatus.toLowerCase()) || null;
      }
    }

    // Real orders: COD (always real) OR Online/UPI where payment succeeded (unless specifically filtering for Failed)
    let baseFilter;
    if (rawPaymentStatus.toLowerCase() === 'failed') {
      baseFilter = { paymentStatus: 'Failed' };
    } else {
      baseFilter = {
        $or: [
          { paymentMode: 'COD' },
          { paymentStatus: { $in: ['Paid', 'Refunded'] } }
        ]
      };
    }

    const query = { ...baseFilter };

    if (isActionRequired) {
      query.orderStatus = { $in: ['Pending', 'CancellationRequested'] };
    } else if (matchedStatus) {
      query.orderStatus = matchedStatus;
    }

    if (rawPaymentStatus && rawPaymentStatus.toLowerCase() !== 'failed') {
      query.paymentStatus = rawPaymentStatus;
    }

    if (rawPeriod === 'today') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: startOfToday };
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { orderNumber: searchRegex },
          { 'shippingAddress.name': searchRegex },
          { 'shippingAddress.phone': searchRegex },
          { 'shippingAddress.city': searchRegex },
        ]
      });
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('userId', 'name email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
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
    return serverError(res, error, 'orderController.js → getAllOrders');
  }
};

// @desc    Update order status (Admin) — allows admin to change status from anywhere
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderStatus, note } = req.body;

    const VALID_STATUSES = [
      'Pending',
      'Confirmed',
      'Packed',
      'Shipped',
      'Delivered',
      'Cancelled',
      'CancellationRequested'
    ];

    if (!orderStatus || !VALID_STATUSES.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order status "${orderStatus}". Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const previousStatus = order.orderStatus;
    if (previousStatus === orderStatus) {
      return res.status(200).json({
        success: true,
        data: order,
        message: `Order is already ${orderStatus}`
      });
    }

    order.orderStatus = orderStatus;

    // Append-only audit trail — who moved this order, when, from what, and why.
    order.statusHistory.push({
      status:    orderStatus,
      from:      previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      note || `Status updated from ${previousStatus} to ${orderStatus} by admin`
    });

    // Delivered handling
    if (orderStatus === 'Delivered') {
      order.deliveredAt = Date.now();
      // COD: payment collected upon delivery
      if (order.paymentMode === 'COD') {
        order.paymentStatus = 'Paid';
      }
    }

    // Cancelled handling
    if (orderStatus === 'Cancelled') {
      order.cancelledAt = Date.now();
    } else if (previousStatus === 'Cancelled') {
      // Admin revived a previously cancelled order
      order.cancelledAt = undefined;
      // If stock had been restored when it was cancelled, reset flags so stock can re-commit
      if (order.stockRestored) {
        order.stockRestored = false;
        order.stockDecremented = false;
      }
    }

    // If order was in CancellationRequested and admin changed status directly:
    if (previousStatus === 'CancellationRequested' && orderStatus !== 'Cancelled') {
      if (!order.cancellationRequest) order.cancellationRequest = {};
      order.cancellationRequest.rejectedAt = Date.now();
      order.cancellationRequest.rejectionReason = note || `Status updated to ${orderStatus} by admin`;
    }

    // statsCache.invalidate('admin:'); // moved

    await order.save();
    statsCache.invalidate('admin:');

    // ── Inventory Side Effects ───────────────────────────────────────────────
    // If moving to any status where stock should be committed (and not already committed):
    if (['Confirmed', 'Packed', 'Shipped', 'Delivered'].includes(orderStatus)) {
      stockService.decrementStockAfterConfirm(order).catch((err) =>
        console.error('⚠️  Stock decrement error:', err.message)
      );
    }

    // If moving to Cancelled, return stock and release any coupon
    if (orderStatus === 'Cancelled') {
      stockService.restoreStockAfterCancel(order).catch((err) =>
        console.error('⚠️  Stock restore error:', err.message)
      );
      if (order.couponUsed?.couponId) {
        couponService.releaseCoupon(order.couponUsed.couponId).catch((err) =>
          console.error('⚠️  Coupon release error:', err.message)
        );
      }
    }

    // ── Notify Customer ───────────────────────────────────────────────────────
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendStatusUpdate(order, customer, orderStatus).catch((err) =>
      console.error('⚠️  Status update notification failed:', err.message)
    );

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    return serverError(res, error, 'orderController.js → updateOrderStatus');
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

    // ── Check store cancellation settings ────────────────────────────────────
    const settings = await Settings.getSingleton().catch(() => null);
    if (settings && !settings.orders.allowCustomerCancellation) {
      return res.status(400).json({
        success: false,
        message: 'Online cancellation requests are currently disabled. Please contact customer support.'
      });
    }

    const cutoff = settings?.orders?.cancellationAllowedUntil || 'Before Shipped';
    if (cutoff === 'Before Packed' && ['Packed', 'Shipped', 'Delivered'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Order cancellation is only allowed before the order is packed.'
      });
    }

    if (cutoff === 'Before Shipped' && ['Shipped', 'Delivered'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Order cancellation is not permitted once the order has been shipped.'
      });
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
    order.statusHistory.push({
      status:    'CancellationRequested',
      from:      order.cancellationRequest.previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      order.cancellationRequest.reason
    });

    await order.save();

    // Notify the admin that a cancellation request has arrived (fire-and-forget).
    const customer = await User.findById(order.userId).select('name email phone');
    notify.notifyAdminCancellationRequest(order, customer).catch((err) =>
      console.error('⚠️  Cancellation-request admin notification failed:', err.message)
    );

    res.status(200).json({
      success: true,
      data: order,
      message: 'Cancellation request submitted. Admin will review and process it shortly.'
    });
    // Invalidate admin stats cache due to order status change (cancellation request)
    statsCache.invalidate('admin:');
  } catch (error) {
    return serverError(res, error, 'orderController.js → cancelOrder');
  }
};

// @desc    Approve cancellation request + auto-refund (Admin)
// @route   PUT /api/orders/:id/approve-cancel
// @access  Private/Admin
exports.approveCancellation = async (req, res) => {
  try {
    // ── Atomic claim: transition orderStatus AND lock the refund slot in one op ─
    // This prevents two simultaneous admin clicks from both calling Razorpay.
    const order = await Order.findOneAndUpdate(
      {
        _id:         req.params.id,
        orderStatus: { $in: ['CancellationRequested', 'Cancelled'] },
        $or: [
          { 'refund.refundStatus': { $exists: false } },
          { 'refund.refundStatus': 'Failed' },
          { 'refund.refundStatus': null }
        ]
      },
      { $set: {
          orderStatus:              'Cancelled',
          cancelledAt:              new Date(),
          'refund.refundStatus':    'Pending',
          'refund.refundAmount':    0
      }},
      { new: true }
    );

    if (!order) {
      const existing = await Order.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Order not found' });
      if (!['CancellationRequested', 'Cancelled'].includes(existing.orderStatus))
        return res.status(400).json({ success: false, message: 'No pending cancellation request for this order.' });
      if (existing.refund?.refundStatus === 'Processed')
        return res.status(409).json({ success: false, message: 'Refund already processed for this order.' });
      return res.status(409).json({ success: false, message: 'Cancellation already in progress or refund already initiated.' });
    }

    // Cancel DTDC shipment if shipped (fire-and-forget)
    if (order.shipping?.awbNumber) {
      dtdcService.cancelShipment(order.shipping.awbNumber).catch(err =>
        console.error('DTDC cancel error:', err.message)
      );
    }

    // ── Auto-refund for online paid orders ────────────────────────────────────
    if (order.paymentMode === 'Online' && order.paymentStatus === 'Paid') {
      const paymentId = order.paymentDetails?.razorpayPaymentId;
      if (paymentId) {
        let refundData = {};
        try {
          const refundResponse = await razorpayService.refundPayment(paymentId, order.totalAmount);
          if (refundResponse.success) {
            refundData = {
              'paymentStatus':         'Refunded',
              'refund.refundId':       refundResponse.data.id,
              'refund.refundAmount':   order.totalAmount,
              'refund.refundStatus':   'Processed',
              'refund.refundedAt':     new Date(),
              'refund.reason':         order.cancellationRequest?.reason || 'Admin approved cancellation'
            };
          } else {
            refundData = {
              'refund.refundAmount':  order.totalAmount,
              'refund.refundStatus':  'Failed',
              'refund.reason':        refundResponse.message
            };
          }
        } catch (refundError) {
          console.error('Refund error:', refundError.message);
          refundData = {
            'refund.refundAmount':  order.totalAmount,
            'refund.refundStatus':  'Failed',
            'refund.reason':        refundError.message
          };
        }
        // Persist final refund state
        await Order.updateOne({ _id: order._id }, { $set: refundData });
        Object.assign(order, refundData); // update local copy for response
      }
    } else {
      // COD or unpaid — clear the pending refund placeholder
      await Order.updateOne({ _id: order._id }, { $unset: { refund: '' } });
    }

    // ── Release everything the order was holding ──────────────────────────────
    // Stock first: it was taken on confirmation and must go back regardless of
    // whether this order was paid online or COD.
    await stockService.restoreStockAfterCancel(order).catch((err) =>
      console.error('⚠️  Stock restore error:', err.message)
    );
    if (order.couponUsed?.couponId) {
      await couponService.releaseCoupon(order.couponUsed.couponId);
    }

    const finalOrder = await Order.findById(order._id);

    // Record the cancellation in the audit trail.
    finalOrder.statusHistory.push({
      status:    'Cancelled',
      from:      'CancellationRequested',
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      `Cancellation approved. ${order.cancellationRequest?.reason || ''}`.trim()
    });
    await finalOrder.save();

    const customer = await User.findById(finalOrder.userId).select('name email phone');
    notify.sendStatusUpdate(finalOrder, customer, 'Cancelled').catch((err) =>
      console.error('⚠️  Cancellation email failed:', err.message));
    if (finalOrder.refund?.refundStatus === 'Processed') {
      notify.sendRefundNotification(finalOrder, customer).catch((err) =>
        console.error('⚠️  Refund email failed:', err.message));
    }

    const refundMsg  = finalOrder.refund?.refundStatus === 'Processed'
      ? ` Refund of ₹${order.totalAmount} initiated — credits in 5-7 business days.`
      : '';

    res.status(200).json({
      success: true,
      data:    finalOrder,
      message: `Cancellation approved.${refundMsg}`
    });
    // Invalidate admin stats cache after cancellation approval
    statsCache.invalidate('admin:');
  } catch (error) {
    return serverError(res, error, 'orderController.js → approveCancellation');
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
    order.statusHistory.push({
      status:    previousStatus,
      from:      'CancellationRequested',
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      order.cancellationRequest.rejectionReason
    });
    // Invalidate admin stats cache after rejection of cancellation request
    statsCache.invalidate('admin:');

    await order.save();

    // Notify customer that cancellation request was rejected (fire-and-forget)
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendCancellationRejected(order, customer, order.cancellationRequest.rejectionReason).catch((err) =>
      console.error('⚠️  Cancellation rejection notification failed:', err.message)
    );

    res.status(200).json({
      success: true,
      data: order,
      message: `Cancellation request rejected. Order restored to "${previousStatus}".`
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → rejectCancellation');
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

    // Respect the order state machine. This previously wrote orderStatus =
    // 'Shipped' unconditionally, so an unpaid, pending or already-cancelled
    // order could be handed to the courier.
    if (!SHIPPABLE_STATUSES.includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot ship an order with status "${order.orderStatus}". It must be one of: ${SHIPPABLE_STATUSES.join(', ')}.`
      });
    }

    // Online orders must actually be paid before they leave the warehouse.
    if (order.paymentMode !== 'COD' && order.paymentStatus !== 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot ship an online order that has not been paid.'
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
    const previousStatus = order.orderStatus;
    order.orderStatus = 'Shipped';
    order.statusHistory.push({
      status:    'Shipped',
      from:      previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      `Shipment booked — ${shipmentResult.courierName || 'DTDC'} AWB ${shipmentResult.awbNumber}`
    });

    await order.save();

    // Send the customer their tracking number.
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendStatusUpdate(order, customer, 'Shipped').catch((err) =>
      console.error('⚠️  Shipment email failed:', err.message));

    res.status(200).json({
      success: true,
      message: 'Shipment created successfully',
      data: order
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → createShipment');
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
    return serverError(res, error, 'orderController.js → trackOrder');
  }
};

// @desc    Delete single status history entry from an order (Admin)
// @route   DELETE /api/orders/:id/history/:historyId
// @access  Private/Admin
exports.deleteStatusHistoryItem = async (req, res) => {
  try {
    const { id, historyId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(historyId)) {
      return res.status(400).json({ success: false, message: 'Invalid order or history ID format.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const initialLen = order.statusHistory?.length || 0;
    order.statusHistory = (order.statusHistory || []).filter(h => h._id?.toString() !== historyId);

    if (order.statusHistory.length === initialLen) {
      return res.status(404).json({ success: false, message: 'History entry not found.' });
    }

    await order.save();
    return res.status(200).json({
      success: true,
      message: 'Status history entry removed.',
      data: order.statusHistory
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → deleteStatusHistoryItem');
  }
};

// @desc    Bulk delete status history entries from an order (Admin)
// @route   POST /api/orders/:id/history/bulk-delete
// @access  Private/Admin
exports.bulkDeleteStatusHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { historyIds } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID format.' });
    }

    if (!Array.isArray(historyIds) || historyIds.length === 0) {
      return res.status(400).json({ success: false, message: 'historyIds must be a non-empty array.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const idsSet = new Set(historyIds.map(String));
    order.statusHistory = (order.statusHistory || []).filter(h => !idsSet.has(h._id?.toString()));

    await order.save();
    return res.status(200).json({
      success: true,
      message: `${historyIds.length} history item(s) removed.`,
      data: order.statusHistory
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → bulkDeleteStatusHistory');
  }
};

// @desc    Delete tracking history entry (Admin)
// @route   DELETE /api/orders/:id/tracking/:trackingId
// @access  Private/Admin
exports.deleteTrackingHistoryItem = async (req, res) => {
  try {
    const { id, trackingId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(trackingId)) {
      return res.status(400).json({ success: false, message: 'Invalid order or tracking ID format.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.shipping?.trackingHistory) {
      order.shipping.trackingHistory = order.shipping.trackingHistory.filter(t => t._id?.toString() !== trackingId);
      await order.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Tracking history entry removed.',
      data: order.shipping?.trackingHistory || []
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → deleteTrackingHistoryItem');
  }
};

