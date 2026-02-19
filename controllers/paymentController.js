const Order = require('../models/Order');
const Product = require('../models/Product');
const Combo = require('../models/Combo');
const razorpayService = require('../services/razorpayService');
const stockService = require('../services/stockService');
const crypto = require('crypto');
const { validateOrderItems, validateShippingAddress } = require('../utils/orderValidation');

// ─── Constants (must match orderController.js) ────────────────────────────────
const FREE_DELIVERY_THRESHOLD = 300;
const DELIVERY_CHARGE = 50;

// ─── Shared price-building helper ────────────────────────────────────────────
async function buildVerifiedItems(orderItems) {
  const verifiedItems = [];
  let computedItemsPrice = 0;

  for (const item of orderItems) {
    if (!item.product || !item.productType || !item.quantity || item.quantity < 1) {
      throw new Error('Invalid order item structure');
    }

    let dbPrice, dbName, dbImage;

    if (item.productType === 'Product') {
      const product = await Product.findById(item.product).select('price name images isActive stock packages');
      if (!product || !product.isActive) throw new Error(`Product not found or unavailable`);

      if (item.packageId) {
        const pkg = product.packages.id(item.packageId);
        if (!pkg) throw new Error(`Package not found`);
        if (pkg.stock < item.quantity) throw new Error(`Insufficient stock for "${product.name}"`);
        dbPrice = pkg.price;
      } else {
        if (product.packages.length === 0 && product.stock < item.quantity)
          throw new Error(`Insufficient stock for "${product.name}"`);
        dbPrice = product.price;
      }
      dbName  = product.name;
      dbImage = product.images?.[0] || '';
    } else if (item.productType === 'Combo') {
      const combo = await Combo.findById(item.product).select('price name images isActive');
      if (!combo || !combo.isActive) throw new Error(`Combo not found or unavailable`);
      dbPrice = combo.price;
      dbName  = combo.name;
      dbImage = combo.images?.[0] || '';
    } else {
      throw new Error(`Unknown productType: ${item.productType}`);
    }

    verifiedItems.push({
      product: item.product, productType: item.productType,
      name: dbName, quantity: item.quantity, price: dbPrice, image: dbImage,
      ...(item.packageId ? { packageId: item.packageId } : {})
    });
    computedItemsPrice += dbPrice * item.quantity;
  }
  return { verifiedItems, computedItemsPrice };
}

// @desc    Create Razorpay Order (price computed on server)
// @route   POST /api/payments/create-order
// @access  Private
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { orderItems, shippingAddress, discountAmount = 0, couponUsed = null } = req.body;

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No order items provided' });
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
    const safeDiscount  = Math.min(Number(discountAmount) || 0, computedItemsPrice);
    const computedTotal = computedItemsPrice + shippingPrice - safeDiscount;

    if (computedTotal <= 0) {
      return res.status(400).json({ success: false, message: 'Computed order total must be positive' });
    }

    const receipt = `ORD_${Date.now().toString().slice(-10)}`;

    // Create Razorpay order using server-computed total (paise)
    const razorpayResponse = await razorpayService.createOrder(computedTotal, 'INR', receipt);
    if (!razorpayResponse.success) {
      return res.status(400).json({ success: false, message: razorpayResponse.message });
    }

    // Persist a PENDING order so we can link it on webhook/verify
    const pendingOrder = await Order.create({
      userId:        req.user._id,
      orderItems:    verifiedItems,
      shippingAddress,
      paymentMode:   'Online',
      paymentStatus: 'Pending',
      orderStatus:   'Pending',
      itemsPrice:    computedItemsPrice,
      shippingPrice,
      discountAmount: safeDiscount,
      couponUsed:    safeDiscount > 0 ? couponUsed : null,
      totalAmount:   computedTotal,
      paymentDetails: {
        razorpayOrderId: razorpayResponse.data.id
      }
    });

    res.status(200).json({
      success: true,
      data: {
        razorpayOrderId: razorpayResponse.data.id,
        internalOrderId: pendingOrder._id, // pass back to client for verify step
        key:             process.env.RAZORPAY_KEY_ID,
        amount:          razorpayResponse.data.amount, // in paise (authoritative)
        currency:        razorpayResponse.data.currency,
        email:           req.user.email,
        name:            req.user.name,
        phone:           req.user.phone,
        // Echo computed values back for display — not trusted on verify
        itemsPrice:    computedItemsPrice,
        shippingPrice,
        discountAmount: safeDiscount,
        totalAmount:   computedTotal
      }
    });
  } catch (error) {
    console.error('createRazorpayOrder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Verify Payment & Confirm Order
// @route   POST /api/payments/verify-payment
// @access  Private
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, internalOrderId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !internalOrderId) {
      return res.status(400).json({ success: false, message: 'Missing payment verification fields' });
    }

    // ── Signature verification (HMAC-SHA256) ─────────────────────────────────
    const verificationResponse = razorpayService.verifyPaymentSignature(
      razorpay_order_id, razorpay_payment_id, razorpay_signature
    );
    if (!verificationResponse.success) {
      return res.status(400).json({ success: false, message: 'Payment signature verification failed' });
    }

    // ── Find the pending internal order (must belong to this user) ────────────
    const order = await Order.findOne({
      _id: internalOrderId,
      userId: req.user._id,
      'paymentDetails.razorpayOrderId': razorpay_order_id
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found or does not belong to this account' });
    }

    // ── Idempotency: already confirmed (Razorpay webhook may have beaten us) ──
    if (order.paymentStatus === 'Paid') {
      return res.status(200).json({ success: true, message: 'Payment already recorded', data: order });
    }

    // ── Confirm order ──────────────────────────────────────────────────────────
    order.paymentStatus  = 'Paid';
    order.orderStatus    = 'Confirmed';
    order.paymentDetails = {
      razorpayOrderId:   razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      transactionId:     razorpay_payment_id,
      paidAt:            new Date()
    };
    await order.save();

    // ── Decrement stock + send low-stock alert if needed (Online payment) ───
    stockService.decrementStockAfterConfirm(order).catch((err) =>
      console.error('⚠️  Stock decrement error (verifyPayment):', err.message)
    );

    res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed',
      data: order
    });
  } catch (error) {
    console.error('verifyPayment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Razorpay Webhook (server-to-server, signature verified)
// @route   POST /api/payments/webhook
// @access  Public (Razorpay servers only — verified by HMAC)
exports.razorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // ── Verify webhook signature ──────────────────────────────────────────────
    // req.body is a raw Buffer from express.raw() — must be used as-is for HMAC
    const receivedSig = req.headers['x-razorpay-signature'];
    if (!receivedSig || !webhookSecret) {
      return res.status(400).json({ success: false, message: 'Missing webhook signature or secret' });
    }

    // Compute HMAC over the RAW buffer (not JSON.stringify — that would corrupt it)
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body) // Buffer from express.raw()
      .digest('hex');

    // timingSafeEqual throws TypeError if lengths differ — guard against it
    let signaturesMatch = false;
    try {
      signaturesMatch = crypto.timingSafeEqual(
        Buffer.from(expectedSig, 'utf8'),
        Buffer.from(receivedSig,  'utf8')
      );
    } catch {
      signaturesMatch = false; // length mismatch = definitely wrong
    }

    if (!signaturesMatch) {
      return res.status(400).json({ success: false, message: 'Webhook signature mismatch' });
    }

    // Parse the raw body into JSON after signature is verified
    let body;
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid webhook JSON payload' });
    }

    const event   = body.event;
    const payload = body.payload;

    // ── payment.captured ─────────────────────────────────────────────────────
    if (event === 'payment.captured') {
      const paymentEntity = payload.payment?.entity;
      const rzpOrderId    = paymentEntity?.order_id;
      const paymentId     = paymentEntity?.id;

      if (rzpOrderId) {
        const order = await Order.findOne({ 'paymentDetails.razorpayOrderId': rzpOrderId });
        if (order && order.paymentStatus !== 'Paid') {
          order.paymentStatus = 'Paid';
          order.orderStatus   = 'Confirmed';
          order.paymentDetails.razorpayPaymentId = paymentId;
          order.paymentDetails.paidAt = new Date();
          await order.save();
          console.log(`✅ Webhook: payment.captured — order ${order._id} confirmed`);
          // Decrement stock + alert (fire-and-forget; idempotent)
          stockService.decrementStockAfterConfirm(order).catch((err) =>
            console.error('⚠️  Stock decrement error (webhook):', err.message)
          );
        }
      }
    }

    // ── payment.failed ────────────────────────────────────────────────────────
    if (event === 'payment.failed') {
      const paymentEntity = payload.payment?.entity;
      const rzpOrderId    = paymentEntity?.order_id;

      if (rzpOrderId) {
        const order = await Order.findOne({ 'paymentDetails.razorpayOrderId': rzpOrderId });
        if (order && order.paymentStatus === 'Pending') {
          order.paymentStatus = 'Failed';
          await order.save();
          console.log(`❌ Webhook: payment.failed — order ${order._id} marked failed`);
        }
      }
    }

    // ── refund.processed ─────────────────────────────────────────────────────
    if (event === 'refund.processed') {
      const refundEntity  = payload.refund?.entity;
      const paymentId     = refundEntity?.payment_id;

      if (paymentId) {
        const order = await Order.findOne({ 'paymentDetails.razorpayPaymentId': paymentId });
        if (order && order.refund?.refundStatus !== 'Processed') {
          order.paymentStatus       = 'Refunded';
          order.refund              = order.refund || {};
          order.refund.refundId     = refundEntity.id;
          order.refund.refundStatus = 'Processed';
          order.refund.refundedAt   = new Date();
          await order.save();
          console.log(`↩ Webhook: refund.processed — order ${order._id}`);
        }
      }
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Handle Payment Failure (client-side fallback)
// @route   POST /api/payments/payment-failure
// @access  Private
exports.handlePaymentFailure = async (req, res) => {
  try {
    const { razorpay_order_id } = req.body;

    if (razorpay_order_id) {
      const order = await Order.findOne({
        'paymentDetails.razorpayOrderId': razorpay_order_id,
        userId: req.user._id
      });
      if (order && order.paymentStatus === 'Pending') {
        order.paymentStatus = 'Failed';
        await order.save();
      }
    }

    res.status(200).json({ success: false, message: 'Payment failure recorded' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Refund Payment (Admin manual — idempotent)
// @route   POST /api/payments/refund
// @access  Private/Admin
exports.refundPayment = async (req, res) => {
  try {
    const { orderId, reason } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.paymentStatus !== 'Paid') {
      return res.status(400).json({ success: false, message: 'Order is not in a paid state' });
    }

    // ── Idempotency guard ─────────────────────────────────────────────────────
    if (order.refund?.refundStatus === 'Processed') {
      return res.status(409).json({
        success: false,
        message: 'Refund already processed for this order',
        data: order.refund
      });
    }

    const paymentId   = order.paymentDetails?.razorpayPaymentId;
    const refundAmount = order.totalAmount;

    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'No Razorpay payment ID found on this order' });
    }

    const refundResponse = await razorpayService.refundPayment(paymentId, refundAmount);
    if (!refundResponse.success) {
      return res.status(400).json({ success: false, message: refundResponse.message });
    }

    order.paymentStatus  = 'Refunded';
    order.orderStatus    = 'Cancelled';
    order.cancelledAt    = new Date();
    order.refund = {
      refundId:     refundResponse.data.id,
      refundAmount,
      refundStatus: 'Processed',
      refundedAt:   new Date(),
      reason:       reason || 'Admin initiated refund'
    };
    await order.save();

    res.status(200).json({
      success: true,
      message: `Refund of ₹${refundAmount} initiated. Credits in 5-7 business days.`,
      data: refundResponse.data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

