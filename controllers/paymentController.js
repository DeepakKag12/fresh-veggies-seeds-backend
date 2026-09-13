const Order = require('../models/Order');
const razorpayService = require('../services/razorpayService');
const stockService = require('../services/stockService');
const crypto = require('crypto');
const { validateOrderItems, validateShippingAddress } = require('../utils/orderValidation');

const User          = require('../models/User');
const couponService = require('../services/couponService');
const { buildVerifiedItems } = require('../services/pricingService');
const notify        = require('../services/orderNotificationService');

// Shared with orderController so COD and online checkouts price identically.
const { computeShippingPrice } = require('../config/orderConfig');
const statsCache = require('../utils/statsCache');
const saveAddressToUser = async (userId, shippingAddress) => {
  try {
    if (!userId || !shippingAddress || !shippingAddress.street) return;
    const user = await User.findById(userId);
    if (!user) return;

    if (!user.addresses) user.addresses = [];

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

    if (!user.address?.street || isFirst) {
      user.address = {
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state,
        pincode: shippingAddress.pincode,
        country: shippingAddress.country || 'India'
      };
    }

    await user.save({ validateBeforeSave: false });
  } catch (err) {
    console.error('Error saving address to user profile:', err.message);
  }
};

// @desc    Create Razorpay Order (price computed on server)
// @route   POST /api/payments/create-order
// @access  Private
exports.createRazorpayOrder = async (req, res) => {
  try {
    // couponCode, never a client-supplied discount — the server prices it.
    const { orderItems, shippingAddress, couponCode = null } = req.body;

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
    const shippingPrice = computeShippingPrice(computedItemsPrice);

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

    const computedTotal = computedItemsPrice + shippingPrice - discountAmount;

    if (computedTotal <= 0) {
      if (couponUsed?.couponId) await couponService.releaseCoupon(couponUsed.couponId);
      return res.status(400).json({ success: false, message: 'Computed order total must be positive' });
    }

    const receipt = `ORD_${Date.now().toString().slice(-10)}`;

    // Create Razorpay order using server-computed total (paise)
    const razorpayResponse = await razorpayService.createOrder(computedTotal, 'INR', receipt);
    if (!razorpayResponse.success) {
      // Never leave a coupon use claimed against an order that was never created.
      if (couponUsed?.couponId) await couponService.releaseCoupon(couponUsed.couponId);
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
      discountAmount,
      couponUsed,
      totalAmount:   computedTotal,
      paymentDetails: {
        razorpayOrderId: razorpayResponse.data.id
      },
      statusHistory: [{ status: 'Pending', changedAt: new Date(), note: 'Awaiting online payment' }]
    });

    // ── Save address to user profile for future orders ───────────────────────
    saveAddressToUser(req.user._id, shippingAddress).catch(() => {});

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
        discountAmount,
        totalAmount:   computedTotal
      }
    });
  } catch (error) {
    return serverError(res, error, 'paymentController → createRazorpayOrder',
      'Could not start the payment. Please try again.');
  }
};

// @desc    Verify Payment & Confirm Order
// @route   POST /api/payments/verify-payment
// @access  Private
exports.verifyPayment = async (req, res) => {
  try {
    // Revenue figures on the dashboard change here.
    statsCache.invalidate('admin:');
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
    order.statusHistory.push({
      status:    'Confirmed',
      from:      'Pending',
      changedAt: new Date(),
      note:      `Online payment captured (${razorpay_payment_id})`
    });
    await order.save();

    // ── Decrement stock + send low-stock alert if needed (Online payment) ───
    stockService.decrementStockAfterConfirm(order).catch((err) =>
      console.error('⚠️  Stock decrement error (verifyPayment):', err.message)
    );

    // ── Confirmation to the customer + alert to the admin ────────────────────
    // Fire-and-forget: the payment is already captured, so a mail failure must
    // never turn a successful checkout into an error for the customer.
    notify.sendOrderConfirmation(order, req.user).catch((e) =>
      console.error('⚠️  Order confirmation email failed:', e.message));
    notify.notifyAdminNewOrder(order, req.user).catch((e) =>
      console.error('⚠️  Admin new-order alert failed:', e.message));

    res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed',
      data: order
    });
  } catch (error) {
    return serverError(res, error, 'paymentController → verifyPayment',
      'Could not verify the payment. If money was deducted it will be reconciled automatically — please contact support with your order number.');
  }
};

// @desc    Razorpay Webhook (server-to-server, signature verified)
// @route   POST /api/payments/webhook
// @access  Public (Razorpay servers only — verified by HMAC)
exports.razorpayWebhook = async (req, res) => {
  try {
    // Revenue figures on the dashboard change here.
    statsCache.invalidate('admin:');
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
        // Atomic: only updates if still Pending — prevents race with verifyPayment
        const order = await Order.findOneAndUpdate(
          { 'paymentDetails.razorpayOrderId': rzpOrderId, paymentStatus: 'Pending' },
          { $set: {
              paymentStatus: 'Paid',
              orderStatus:   'Confirmed',
              'paymentDetails.razorpayPaymentId': paymentId,
              'paymentDetails.paidAt':           new Date()
          }},
          { new: true }
        );
        if (order) {
          console.log(`✅ Webhook: payment.captured — order ${order._id} confirmed`);
          stockService.decrementStockAfterConfirm(order).catch((err) =>
            console.error('⚠️  Stock decrement error (webhook):', err.message)
          );

          // This path is what covers a customer who paid then closed the tab
          // before verify-payment ran — they still get their confirmation and
          // the admin still learns about the order.
          order.statusHistory.push({
            status: 'Confirmed', from: 'Pending', changedAt: new Date(),
            note: 'Confirmed via Razorpay webhook'
          });
          await order.save();

          const customer = await User.findById(order.userId).select('name email phone');
          notify.sendOrderConfirmation(order, customer).catch((e) =>
            console.error('⚠️  Order confirmation email failed (webhook):', e.message));
          notify.notifyAdminNewOrder(order, customer).catch((e) =>
            console.error('⚠️  Admin new-order alert failed (webhook):', e.message));
        } else {
          // Already Paid by verifyPayment — still 200 so Razorpay doesn't retry
          console.log(`ℹ️  Webhook: payment.captured — order already confirmed (rzpOrderId=${rzpOrderId})`);
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

          // The coupon use was claimed when the Razorpay order was created.
          // The payment never landed, so hand it back to the customer.
          if (order.couponUsed?.couponId) {
            await couponService.releaseCoupon(order.couponUsed.couponId);
          }
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

          // A refund means the goods are coming back — return them to stock and
          // free the coupon. Both are idempotent, so this is safe even when the
          // admin cancellation path already did it.
          await stockService.restoreStockAfterCancel(order).catch((err) =>
            console.error('⚠️  Stock restore error (webhook):', err.message));
          if (order.couponUsed?.couponId) {
            await couponService.releaseCoupon(order.couponUsed.couponId);
          }

          const customer = await User.findById(order.userId).select('name email phone');
          notify.sendRefundNotification(order, customer).catch((e) =>
            console.error('⚠️  Refund email failed:', e.message));
        }
      }
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error) {
    // 500 here is deliberate: it tells Razorpay to retry delivery.
    console.error('❌ Webhook error:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
};

// @desc    Handle Payment Failure / Dismissal (client-side fallback)
// @route   POST /api/payments/payment-failure
// @access  Private
exports.handlePaymentFailure = async (req, res) => {
  try {
    const { razorpay_order_id, internalOrderId } = req.body;

    let order = null;

    // Prefer internalOrderId lookup (faster, more reliable)
    if (internalOrderId) {
      order = await Order.findOne({
        _id: internalOrderId,
        userId: req.user._id,
        paymentStatus: 'Pending'
      });
    }

    // Fallback: lookup by Razorpay order ID
    if (!order && razorpay_order_id) {
      order = await Order.findOne({
        'paymentDetails.razorpayOrderId': razorpay_order_id,
        userId: req.user._id,
        paymentStatus: 'Pending'
      });
    }

    if (order) {
      order.paymentStatus = 'Failed';
      order.statusHistory.push({
        status: 'Pending', from: 'Pending', changedAt: new Date(),
        note: 'Payment dismissed or failed at checkout'
      });
      await order.save();
      console.log(`❌ Payment dismissed/failed — order ${order._id} marked Failed`);

      // Hand the coupon use back — it was claimed when the Razorpay order was
      // created and this customer never actually paid.
      if (order.couponUsed?.couponId) {
        await couponService.releaseCoupon(order.couponUsed.couponId);
      }
    }

    res.status(200).json({ success: true, message: 'Payment failure recorded' });
  } catch (error) {
    return serverError(res, error, 'paymentController.js → handlePaymentFailure');
  }
};

// @desc    Refund Payment (Admin manual — idempotent, race-safe)
// @route   POST /api/payments/refund
// @access  Private/Admin
exports.refundPayment = async (req, res) => {
  try {
    // Revenue figures on the dashboard change here.
    statsCache.invalidate('admin:');
    const { orderId, reason } = req.body;

    // ── Atomic claim: only one request can ever enter the refund path ─────────
    // Transitions refundStatus from (no refund) → 'Pending' as an atomic op.
    // A second concurrent request finds refundStatus already set → 409.
    const order = await Order.findOneAndUpdate(
      {
        _id:           orderId,
        paymentStatus: 'Paid',
        'refund.refundStatus': { $exists: false }  // no refund record yet
      },
      { $set: { 'refund.refundStatus': 'Pending', 'refund.refundAmount': 0 } },
      { new: true }
    );

    if (!order) {
      // Distinguish between "not found" and "already refunded"
      const existing = await Order.findById(orderId);
      if (!existing)                              return res.status(404).json({ success: false, message: 'Order not found' });
      if (existing.paymentStatus !== 'Paid')      return res.status(400).json({ success: false, message: 'Order is not in a paid state' });
      if (existing.refund?.refundStatus === 'Processed')
        return res.status(409).json({ success: false, message: 'Refund already processed for this order', data: existing.refund });
      return res.status(409).json({ success: false, message: 'Refund already in progress' });
    }

    const paymentId    = order.paymentDetails?.razorpayPaymentId;
    const refundAmount = order.totalAmount;

    if (!paymentId) {
      // Roll back the Pending flag so admin can retry
      await Order.updateOne({ _id: orderId }, { $unset: { refund: '' } });
      return res.status(400).json({ success: false, message: 'No Razorpay payment ID found on this order' });
    }

    const refundResponse = await razorpayService.refundPayment(paymentId, refundAmount);

    if (!refundResponse.success) {
      // Mark as Failed so admin sees it, but don't leave it stuck as Pending
      await Order.updateOne({ _id: orderId }, { $set: {
        'refund.refundStatus': 'Failed',
        'refund.refundAmount': refundAmount,
        'refund.reason':       refundResponse.message
      }});
      return res.status(400).json({ success: false, message: refundResponse.message });
    }

    // ── Razorpay confirmed — persist full refund record ───────────────────────
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: {
          paymentStatus:          'Refunded',
          orderStatus:            'Cancelled',
          cancelledAt:            new Date(),
          'refund.refundId':      refundResponse.data.id,
          'refund.refundAmount':  refundAmount,
          'refund.refundStatus':  'Processed',
          'refund.refundedAt':    new Date(),
          'refund.reason':        reason || 'Admin initiated refund'
      }},
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: `Refund of ₹${refundAmount} initiated. Credits in 5-7 business days.`,
      data: refundResponse.data
    });
  } catch (error) {
    return serverError(res, error, 'paymentController.js → refundPayment');
  }
};

