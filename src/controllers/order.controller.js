const mongoose = require('mongoose');
const Order = require('../models/order.model');
const User = require('../models/user.model');
const Product = require('../models/product.model');
const Combo = require('../models/combo.model');
const dtdcService = require('../services/dtdc.service');
const razorpayService = require('../services/razorpay.service');
const stockService = require('../services/stock.service');
const { validateOrderItems, validateShippingAddress } = require('../validators/order.validator');
const couponService = require('../services/coupon.service');
const { buildVerifiedItems } = require('../services/pricing.service');
const notify        = require('../services/order-notification.service');
const statsCache = require('../utils/stats-cache.util');
const cacheService = require('../utils/cache.util');
const { serverError } = require('../utils/respond.util');

// Pricing rules and the status state machine are shared with paymentController
// so COD and online checkouts can never price or transition differently.
const {
  computeShippingPrice,
  getShippingRules,
  ALL_ORDER_STATUSES,
  ALLOWED_TRANSITIONS,
  SHIPPABLE_STATUSES,
  canTransition,
} = require('../config/order.config');
const Settings = require('../models/settings.model');
const { saveAddressToUser } = require('../services/address.service');

// @desc    Create new COD order (server-side price validation)
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res) => {
  try {
    // NOTE: couponCode, never a discount amount. The discount is computed
    // server-side from the code — see couponService.
    const rawMode = String(req.body.paymentMode || req.body.paymentMethod || 'COD').trim().toUpperCase();
    const paymentMode = rawMode === 'ONLINE' ? 'Online' : rawMode === 'UPI' ? 'UPI' : 'COD';
    const { orderItems, shippingAddress, couponCode = null } = req.body;

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

    if (rules.isStoreClosed) {
      return res.status(403).json({
        success: false,
        message: rules.closureNotice || 'Our storefront is currently closed for routine maintenance. Orders cannot be accepted at this time.'
      });
    }

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

    // COD minimum basket requirement
    const codMin = rules.codMinOrder || rules.minOrderAmount;
    if ((paymentMode === 'COD' || !paymentMode) && codMin && computedItemsPrice < codMin) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount for Cash on Delivery is ₹${codMin}. Current items total is ₹${computedItemsPrice}.`
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
      if (couponUsed?.couponId) await couponService.releaseCoupon(couponUsed.couponId, req.user._id).catch(() => {});
      return res.status(400).json({
        success: false,
        message: `Cash on Delivery is only available for orders up to ₹${rules.codMaxOrder}. Please use Online Payment.`
      });
    }

    let reservationLedger;
    // ── Reserve stock atomically, before the order exists ─────────────────────
    // buildVerifiedItems only *checks* availability. Two customers racing for
    // the last unit both passed that check and both got an order. Claiming the
    // units here means the database picks exactly one winner and the other is
    // told it is sold out straight away, instead of finding out at confirmation.
    try {
      reservationLedger = await stockService.reserveStock(verifiedItems);
    } catch (e) {
      // Give back anything the coupon claim already took.
      if (couponUsed?.couponId) {
        await couponService.releaseCoupon(couponUsed.couponId, req.user._id).catch(() => {});
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

      // Invalidate admin stats cache and catalogue caches so dashboard & stock levels reflect new order immediately
      statsCache.invalidate('admin:');
      statsCache.invalidate('products:');
      statsCache.invalidate('combos:');
    } catch (createErr) {
      // The coupon use was claimed before the order existed — hand it back so a
      // failed insert does not silently burn one of the customer's allowance.
      if (couponUsed?.couponId) await couponService.releaseCoupon(couponUsed.couponId, req.user._id).catch(() => {});
      // Return reserved stock so inventory does not leak on database insertion error.
      await stockService.restoreReservedStock(reservationLedger || verifiedItems).catch((e) =>
        console.error('⚠️  Failed to restore reserved stock on order create failure:', e.message)
      );
      throw createErr;
    }

    // ── Save address to user profile only if explicitly requested ──────────
    if (req.body?.saveAddress === true) {
      saveAddressToUser(req.user._id, shippingAddress).catch(() => {});
    }

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
      const cleanSearch = search.trim();
      const escaped = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      
      const searchConditions = [
        { 'shippingAddress.name': searchRegex },
        { 'shippingAddress.phone': searchRegex },
        { 'shippingAddress.city': searchRegex },
      ];

      // If search matches FV order number format, add exact & anchored prefix to use unique B-Tree index
      if (/^fv/i.test(cleanSearch)) {
        searchConditions.unshift(
          { orderNumber: cleanSearch.toUpperCase() },
          { orderNumber: new RegExp('^' + escaped, 'i') }
        );
      } else {
        searchConditions.unshift({ orderNumber: searchRegex });
      }

      query.$and = query.$and || [];
      query.$and.push({
        $or: searchConditions
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
// @desc    Update order status (Admin) — finite-state order lifecycle workflow
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
  try {
    const { note, shipping } = req.body;
    const rawStatus = req.body.orderStatus || req.body.status;

    if (!rawStatus) {
      return res.status(400).json({
        success: false,
        message: 'Order status is required'
      });
    }

    // Match status case-insensitively against whitelist
    const orderStatus = ALL_ORDER_STATUSES.find(s => s.toLowerCase() === String(rawStatus).trim().toLowerCase());

    if (!orderStatus) {
      return res.status(400).json({
        success: false,
        message: `Invalid order status "${rawStatus}". Must be one of: ${ALL_ORDER_STATUSES.join(', ')}`
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const previousStatus = order.orderStatus;

    // Validate finite-state progression (e.g. Delivered cannot move back to Pending)
    if (!canTransition(previousStatus, orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition: cannot transition order from "${previousStatus}" to "${orderStatus}"`
      });
    }

    if (previousStatus === orderStatus && !shipping && !req.body.trackingNumber && !req.body.awbNumber) {
      return res.status(200).json({
        success: true,
        data: order,
        message: `Order is already ${orderStatus}`
      });
    }

    order.orderStatus = orderStatus;

    // Save dispatch / tracking info if provided (e.g. Courier partner, AWB number)
    const courierPartner = shipping?.courierName || shipping?.courier || req.body.courier || req.body.courierName;
    const trackingNo = shipping?.awbNumber || shipping?.trackingNumber || req.body.trackingNumber || req.body.awbNumber;
    let trackUrl = shipping?.trackingUrl || req.body.trackingUrl;

    if (trackingNo && !trackUrl && (courierPartner || 'DTDC').toUpperCase().includes('DTDC')) {
      trackUrl = `https://www.dtdc.in/tracking.asp?strCnno=${trackingNo}`;
    }

    let hasNewTracking = false;
    if (courierPartner || trackingNo || trackUrl) {
      if (!order.shipping) order.shipping = {};
      if (courierPartner) order.shipping.courierName = courierPartner;
      if (trackingNo) {
        order.shipping.awbNumber = trackingNo;
        hasNewTracking = true;
      }
      if (trackUrl) order.shipping.trackingUrl = trackUrl;
      if (orderStatus === 'Shipped' && !order.shipping.shippedAt) {
        order.shipping.shippedAt = new Date();
      }

      // Synchronize dedicated dtdc metadata object
      order.dtdc = {
        consignmentNumber: trackingNo || order.shipping.awbNumber,
        courier: courierPartner || order.shipping.courierName || 'DTDC',
        status: orderStatus === 'Shipped' ? 'In Transit' : 'Booked',
        trackingUrl: trackUrl || order.shipping.trackingUrl,
        bookedAt: order.dtdc?.bookedAt || new Date()
      };
    }

    // Append-only audit trail — who moved this order, when, from what, and why.
    const auditNote = note || (
      trackingNo
        ? `Marked as ${orderStatus} via ${courierPartner || 'DTDC'} (AWB: ${trackingNo})`
        : `Status updated from ${previousStatus} to ${orderStatus} by admin`
    );

    order.statusHistory.push({
      status:    orderStatus,
      from:      previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      auditNote
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

    await order.save();
    statsCache.invalidate('admin:');

    // ── Inventory Side Effects ───────────────────────────────────────────────
    if (['Confirmed', 'Processing', 'Packed', 'Shipped', 'Delivered'].includes(orderStatus)) {
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
        couponService.releaseCoupon(order.couponUsed.couponId, order.userId, order._id).catch((err) =>
          console.error('⚠️  Coupon release error:', err.message)
        );
      }
    }

    // ── Notify Customer ───────────────────────────────────────────────────────
    // If tracking number was added or status updated, trigger customer notification
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendStatusUpdate(order, customer, hasNewTracking && orderStatus !== 'Delivered' ? 'Shipped' : orderStatus).catch((err) =>
      console.error('⚠️  Status update notification failed:', err.message)
    );

    statsCache.invalidate('admin:');
    statsCache.invalidate('products:');
    statsCache.invalidate('combos:');

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    return serverError(res, error, 'orderController.js → updateOrderStatus');
  }
};

// @desc    Customer self-service order cancellation (Domino's / Amazon Benchmark)
// @route   POST /api/orders/:id/cancel or PUT /api/orders/:id/cancel
// @access  Private
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this order' });
    }

    // ── Enforce cancellation policy: allowed only when order status is pending or confirmed ──
    const currentStatus = (order.orderStatus || '').toLowerCase();
    if (!['pending', 'confirmed'].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be cancelled once ${order.orderStatus.toLowerCase()}. Please contact customer support.`
      });
    }

    const { reason = 'Cancelled by customer' } = req.body;
    const previousStatus = order.orderStatus;

    order.cancelledAt = new Date();
    order.cancellationReason = reason;
    order.cancellationRequest = {
      isRequested: true,
      reason,
      status: 'Approved',
      requestedAt: new Date(),
      previousStatus
    };
    order.orderStatus = 'Cancelled';
    order.statusHistory.push({
      status:    'Cancelled',
      from:      previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note:      reason
    });

    await order.save();

    // ── Restores product stock inside atomic / idempotent inventory handler ──
    await stockService.restoreStockAfterCancel(order).catch((err) =>
      console.error('⚠️  Stock restore error on cancel:', err.message)
    );

    // ── Release coupon allowance if one was claimed ──
    if (order.couponUsed?.couponId) {
      await couponService.releaseCoupon(order.couponUsed.couponId, order.userId, order._id).catch((err) =>
        console.error('⚠️  Coupon release error on cancel:', err.message)
      );
    }

    // Invalidate caches
    statsCache.invalidate('admin:');
    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');

    // Notify customer & admin
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendStatusUpdate(order, customer, 'Cancelled').catch((err) =>
      console.error('⚠️  Status update notification failed:', err.message)
    );

    res.status(200).json({
      success: true,
      data: order,
      message: 'Order cancelled successfully. Inventory restored.'
    });
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
      await couponService.releaseCoupon(order.couponUsed.couponId, order.userId, order._id);
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

// @desc    Check pincode serviceability (Public)
// @route   GET /api/orders/check-pincode/:pincode
// @access  Public
exports.checkPincodeServiceability = async (req, res) => {
  try {
    const { pincode } = req.params;
    if (!pincode || !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 6-digit PIN code.' });
    }

    const result = await dtdcService.checkPincodeServiceability(pincode);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → checkPincodeServiceability');
  }
};

// @desc    Delete an order (Admin)
// @route   DELETE /api/orders/:id
// @access  Private/Admin
exports.deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID format.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // If stock was decremented and has not yet been restored, restore it back to inventory
    if (order.stockDecremented && !order.stockRestored && order.orderStatus !== 'Cancelled') {
      try {
        await stockService.restoreStockAfterCancel(order);
      } catch (stockErr) {
        console.error('⚠️  Failed to restore stock on order deletion:', stockErr.message);
      }
    }

    const orderNum = order.orderNumber || order._id.toString().slice(-6).toUpperCase();

    // Record in DeleteHistory recovery ledger & AuditLog
    const auditService = require('../services/audit.service');
    await auditService.logDeletion({
      req,
      entityType: 'Order',
      entityId: order._id,
      entityName: `Order #${orderNum}`,
      deletionReason: req.body?.reason || req.query?.reason || 'Order removed by administrator',
      snapshot: order.toObject()
    });

    await Order.findByIdAndDelete(id);

    // Invalidate caches
    statsCache.invalidate('admin:');
    statsCache.invalidate('orders:');

    return res.status(200).json({
      success: true,
      message: `Order #${orderNum} deleted and moved to Delete History.`
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → deleteOrder');
  }
};

// @desc    Verify cart integrity (price changes, active status, available stock) before checkout payment
// @route   POST /api/orders/verify-cart
// @access  Public / Authenticated
exports.verifyCartIntegrity = async (req, res) => {
  try {
    const { orderItems } = req.body;

    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(200).json({
        success: true,
        hasChanges: false,
        changes: [],
        verifiedItems: [],
        subtotal: 0
      });
    }

    const changes = [];
    const verifiedItems = [];
    let computedItemsPrice = 0;

    for (const item of orderItems) {
      if (!item.product) continue;
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const reportedPrice = Number(item.price) || 0;

      if (item.productType === 'Combo') {
        const combo = await Combo.findById(item.product)
          .populate('includedProducts.productId', 'name price stock isActive isDeleted');
        if (!combo || !combo.isActive) {
          changes.push({
            productId: item.product,
            packageId: null,
            name: item.name || 'Combo Pack',
            type: 'unavailable',
            message: `"${item.name || 'Combo Pack'}" is no longer available.`
          });
          continue;
        }

        // Check combo stock and child products stock
        let availableStock = combo.stock !== undefined ? combo.stock : 999;
        if (Array.isArray(combo.includedProducts)) {
          for (const cp of combo.includedProducts) {
            const childProd = cp.productId;
            const requiredPerCombo = cp.quantity || 1;
            if (!childProd || !childProd.isActive || childProd.isDeleted) {
              availableStock = 0;
              break;
            }
            const possibleCombos = Math.floor((childProd.stock || 0) / requiredPerCombo);
            if (possibleCombos < availableStock) {
              availableStock = possibleCombos;
            }
          }
        }

        const currentPrice = Number(combo.price) || 0;

        if (currentPrice !== reportedPrice) {
          changes.push({
            productId: item.product,
            packageId: null,
            name: combo.name || item.name,
            type: 'price_changed',
            oldPrice: reportedPrice,
            newPrice: currentPrice,
            message: `Price for "${combo.name || item.name}" changed from ₹${reportedPrice} to ₹${currentPrice}.`
          });
        }

        if (availableStock < quantity) {
          changes.push({
            productId: item.product,
            packageId: null,
            name: combo.name || item.name,
            type: availableStock === 0 ? 'out_of_stock' : 'stock_reduced',
            requestedQuantity: quantity,
            availableStock,
            message: availableStock === 0
              ? `"${combo.name || item.name}" is now out of stock.`
              : `Only ${availableStock} units of "${combo.name || item.name}" left in stock (requested ${quantity}).`
          });
        }

        const effectiveQty = Math.min(quantity, Math.max(0, availableStock));
        const effectivePrice = currentPrice;
        if (effectiveQty > 0) {
          computedItemsPrice += effectivePrice * effectiveQty;
          verifiedItems.push({
            ...item,
            quantity: effectiveQty,
            price: effectivePrice,
            name: combo.name || item.name,
            availableStock
          });
        }
      } else {
        // Standard Product
        const product = await Product.findOne({ _id: item.product, isDeleted: { $ne: true } });
        if (!product || !product.isActive) {
          changes.push({
            productId: item.product,
            packageId: item.packageId || null,
            name: item.name || 'Product',
            type: 'unavailable',
            message: `"${item.name || 'Product'}" is no longer available.`
          });
          continue;
        }

        let currentPrice = Number(product.price) || 0;
        let availableStock = Number(product.stock) || 0;
        let packageName = '';

        if (item.packageId && Array.isArray(product.packages)) {
          const pkg = product.packages.id(item.packageId);
          if (!pkg) {
            changes.push({
              productId: item.product,
              packageId: item.packageId,
              name: item.name || product.name,
              type: 'unavailable',
              message: `The selected package for "${product.name}" is no longer available.`
            });
            continue;
          }
          currentPrice = Number(pkg.price) || 0;
          availableStock = Number(pkg.stock) || 0;
          packageName = pkg.size || pkg.packetSize || '';
        }

        if (currentPrice !== reportedPrice) {
          changes.push({
            productId: item.product,
            packageId: item.packageId || null,
            name: product.name + (packageName ? ` (${packageName})` : ''),
            type: 'price_changed',
            oldPrice: reportedPrice,
            newPrice: currentPrice,
            message: `Price for "${product.name}${packageName ? ` (${packageName})` : ''}" changed from ₹${reportedPrice} to ₹${currentPrice}.`
          });
        }

        if (availableStock < quantity) {
          changes.push({
            productId: item.product,
            packageId: item.packageId || null,
            name: product.name + (packageName ? ` (${packageName})` : ''),
            type: availableStock === 0 ? 'out_of_stock' : 'stock_reduced',
            requestedQuantity: quantity,
            availableStock,
            message: availableStock === 0
              ? `"${product.name}${packageName ? ` (${packageName})` : ''}" is now out of stock.`
              : `Only ${availableStock} units of "${product.name}${packageName ? ` (${packageName})` : ''}" available in stock (requested ${quantity}).`
          });
        }

        const effectiveQty = Math.min(quantity, Math.max(0, availableStock));
        const effectivePrice = currentPrice;
        if (effectiveQty > 0) {
          computedItemsPrice += effectivePrice * effectiveQty;
          verifiedItems.push({
            ...item,
            quantity: effectiveQty,
            price: effectivePrice,
            name: product.name,
            availableStock
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      hasChanges: changes.length > 0,
      changes,
      verifiedItems,
      subtotal: computedItemsPrice
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → verifyCartIntegrity');
  }
};

// @desc    Assign courier tracking (DTDC / Partner) & notify customer
// @route   POST /api/orders/:id/track & POST /api/admin/orders/:id/track
// @access  Private/Admin
exports.updateOrderTracking = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const {
      courierName,
      courier,
      trackingNumber,
      awbNumber,
      trackingUrl,
      note,
      status
    } = req.body;

    const finalCourier = courierName || courier || 'DTDC';
    const finalTrackingNumber = trackingNumber || awbNumber;

    if (!finalTrackingNumber) {
      return res.status(400).json({
        success: false,
        message: 'Tracking or consignment AWB number is required'
      });
    }

    let finalTrackingUrl = trackingUrl;
    if (!finalTrackingUrl && finalCourier.toUpperCase().includes('DTDC')) {
      finalTrackingUrl = `https://www.dtdc.in/tracking.asp?strCnno=${finalTrackingNumber}`;
    } else if (!finalTrackingUrl) {
      finalTrackingUrl = `https://track.dtdc.com/?tracking_no=${finalTrackingNumber}`;
    }

    if (!order.shipping) order.shipping = {};
    order.shipping.courierName = finalCourier;
    order.shipping.awbNumber = finalTrackingNumber;
    order.shipping.trackingUrl = finalTrackingUrl;
    if (!order.shipping.shippedAt) {
      order.shipping.shippedAt = new Date();
    }

    if (!order.shipping.trackingHistory) order.shipping.trackingHistory = [];
    order.shipping.trackingHistory.push({
      status: 'Consignment Assigned / In Transit',
      location: order.shippingAddress?.city || 'Indore Fulfillment Center',
      timestamp: new Date(),
      remarks: note || `Dispatched via ${finalCourier}`
    });

    order.dtdc = {
      consignmentNumber: finalTrackingNumber,
      courier: finalCourier,
      status: 'Booked',
      trackingUrl: finalTrackingUrl,
      bookedAt: new Date()
    };

    const previousStatus = order.orderStatus;
    const targetStatus = status || (['Pending', 'Confirmed', 'Processing', 'Packed'].includes(previousStatus) ? 'Shipped' : previousStatus);

    if (previousStatus !== targetStatus && canTransition(previousStatus, targetStatus)) {
      order.orderStatus = targetStatus;
    }

    order.statusHistory.push({
      status: order.orderStatus,
      from: previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note: note || `Assigned ${finalCourier} consignment tracking ${finalTrackingNumber}`
    });

    await order.save();
    statsCache.invalidate('admin:');

    // Automatically trigger tracking update email/SMS notification to customer with live tracking URL
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendStatusUpdate(order, customer, 'Shipped').catch((err) =>
      console.error('⚠️  Tracking update notification failed:', err.message)
    );

    res.status(200).json({
      success: true,
      message: `Tracking assigned via ${finalCourier}. Live tracking notification sent to customer.`,
      data: order
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → updateOrderTracking');
  }
};

// @desc    Issue 1-click Razorpay refund for cancelled or return orders (Admin)
// @route   POST /api/orders/:id/refund & POST /api/admin/orders/:id/refund
// @access  Private/Admin
exports.issueOrderRefund = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if refund was already completed
    if (order.refund?.refundStatus === 'Processed') {
      return res.status(409).json({
        success: false,
        message: `Refund of ₹${order.refund.refundAmount} was already processed on ${new Date(order.refund.refundedAt).toLocaleDateString()}. Refund ID: ${order.refund.refundId}`
      });
    }

    const { amount, reason = 'Admin issued refund' } = req.body;
    const refundAmount = amount ? Number(amount) : order.totalAmount;

    if (!refundAmount || refundAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid refund amount is required'
      });
    }

    // Razorpay refund handling
    const paymentId = order.paymentDetails?.razorpayPaymentId;
    let refundResult;

    if (order.paymentMode === 'Online' || paymentId) {
      refundResult = await razorpayService.refundPayment(paymentId, refundAmount);
      if (!refundResult.success) {
        return res.status(400).json({
          success: false,
          message: refundResult.message || 'Payment gateway refund request failed',
          error: refundResult.message
        });
      }
    } else {
      // For COD orders where cash was collected or manual adjustment
      refundResult = {
        success: true,
        data: {
          id: `rfnd_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          status: 'processed'
        }
      };
    }

    const refundId = refundResult.data?.id || `rfnd_${Date.now()}`;

    // Update order refund fields
    order.paymentStatus = 'Refunded';
    order.refund = {
      refundId,
      refundAmount,
      refundStatus: 'Processed',
      refundedAt: new Date(),
      reason
    };

    const previousStatus = order.orderStatus;
    if (order.orderStatus !== 'Cancelled' && canTransition(previousStatus, 'Cancelled')) {
      order.orderStatus = 'Cancelled';
      order.cancelledAt = new Date();
    }

    order.statusHistory.push({
      status: order.orderStatus,
      from: previousStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note: `Refund of ₹${refundAmount} issued (Gateway ID: ${refundId}). Reason: ${reason}`
    });

    await order.save();

    // If order was holding inventory stock, restore it
    await stockService.restoreStockAfterCancel(order).catch((err) =>
      console.error('⚠️  Stock restore error on refund:', err.message)
    );

    if (order.couponUsed?.couponId) {
      await couponService.releaseCoupon(order.couponUsed.couponId, order.userId, order._id).catch((err) =>
        console.error('⚠️  Coupon release error on refund:', err.message)
      );
    }

    // Invalidate caches
    statsCache.invalidate('admin:');
    cacheService.invalidate('products:');
    cacheService.invalidate('combos:');

    // Notify customer
    const customer = await User.findById(order.userId).select('name email phone');
    notify.sendRefundNotification(order, customer).catch((err) =>
      console.error('⚠️  Refund notification failed:', err.message)
    );

    res.status(200).json({
      success: true,
      message: `Refund of ₹${refundAmount} processed successfully. (Refund ID: ${refundId})`,
      data: order
    });
  } catch (error) {
    return serverError(res, error, 'orderController.js → issueOrderRefund');
  }
};
