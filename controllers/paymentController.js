const Order = require('../models/Order');
const razorpayService = require('../services/razorpayService');

// @desc    Create Razorpay Order
// @route   POST /api/payments/create-order
// @access  Private
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { amount, orderItems, shippingAddress, itemsPrice, shippingPrice, totalAmount } = req.body;

    console.log('📥 Payment Request:', { amount, itemsPrice, shippingPrice, totalAmount });

    if (!amount || amount <= 0) {
      console.log('❌ Invalid amount:', amount);
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Create a temporary order reference (max 40 chars for Razorpay)
    const receipt = `ORD_${Date.now().toString().slice(-8)}`;

    console.log('🔄 Creating Razorpay order...');
    // Create Razorpay order
    const razorpayResponse = await razorpayService.createOrder(amount, 'INR', receipt);

    console.log('📊 Razorpay Response:', razorpayResponse);

    if (!razorpayResponse.success) {
      console.log('❌ Razorpay Error:', razorpayResponse.message);
      return res.status(400).json({
        success: false,
        message: razorpayResponse.message
      });
    }

    console.log('✅ Order created successfully:', razorpayResponse.data.id);

    res.status(200).json({
      success: true,
      data: {
        razorpayOrderId: razorpayResponse.data.id,
        key: process.env.RAZORPAY_KEY_ID,
        amount: razorpayResponse.data.amount,
        currency: razorpayResponse.data.currency,
        email: req.user.email,
        name: req.user.name,
        phone: req.user.phone,
        orderItems,
        shippingAddress,
        itemsPrice,
        shippingPrice,
        totalAmount
      }
    });
  } catch (error) {
    console.error('💥 Error in createRazorpayOrder:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Verify Payment & Create Order
// @route   POST /api/payments/verify-payment
// @access  Private
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderData } = req.body;

    // Verify payment signature
    const verificationResponse = await razorpayService.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!verificationResponse.success) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    // Create order in database
    const order = await Order.create({
      userId: req.user._id,
      orderItems: orderData.orderItems,
      shippingAddress: orderData.shippingAddress,
      itemsPrice: orderData.itemsPrice,
      shippingPrice: orderData.shippingPrice,
      discountAmount: orderData.discountAmount || 0,
      couponUsed: orderData.couponUsed || null,
      totalAmount: orderData.totalAmount,
      paymentMode: 'Online',
      paymentStatus: 'Paid',
      orderStatus: 'Confirmed',
      paymentDetails: {
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        transactionId: razorpay_payment_id,
        paidAt: new Date()
      }
    });

    res.status(201).json({
      success: true,
      message: 'Payment verified and order created successfully',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Handle Payment Failure
// @route   POST /api/payments/payment-failure
// @access  Private
exports.handlePaymentFailure = async (req, res) => {
  try {
    const { razorpay_order_id, error_code, error_description } = req.body;

    res.status(200).json({
      success: false,
      message: 'Payment failed',
      errorCode: error_code,
      errorDescription: error_description,
      razorpayOrderId: razorpay_order_id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Refund Payment
// @route   POST /api/payments/refund
// @access  Private/Admin
exports.refundPayment = async (req, res) => {
  try {
    const { orderId, amount } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.paymentStatus !== 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Order is not paid'
      });
    }

    const paymentId = order.paymentDetails.razorpayPaymentId;
    const refundAmount = amount || order.totalAmount;

    // Refund through Razorpay
    const refundResponse = await razorpayService.refundPayment(paymentId, refundAmount);

    if (!refundResponse.success) {
      return res.status(400).json({
        success: false,
        message: refundResponse.message
      });
    }

    // Update order status
    order.paymentStatus = 'Failed';
    order.orderStatus = 'Cancelled';
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: refundResponse.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
