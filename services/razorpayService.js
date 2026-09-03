const Razorpay = require('razorpay');
const crypto = require('crypto');

// Razorpay is constructed lazily.
//
// The client throws at construction when no key is configured. Building it at
// module load meant an empty RAZORPAY_KEY_ID crashed the entire server on
// startup — auth, catalogue and COD orders included — because this module is
// required transitively by orderController. A missing payment key should
// disable online payments, not the whole application.
let razorpayClient = null;

const isConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const getClient = () => {
  if (!isConfigured()) {
    throw new Error('Online payments are not configured on this server.');
  }
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
};

exports.isConfigured = isConfigured;

// Create Razorpay Order
exports.createOrder = async (amount, currency = 'INR', receipt) => {
  try {
    const options = {
      amount: Math.round(amount * 100), // Convert to paise (smallest unit)
      currency: currency,
      receipt: receipt,
      payment_capture: 1 // Auto capture payment
    };

    console.log('🎯 Razorpay Service - Creating order with options:', options);

    const order = await getClient().orders.create(options);
    
    console.log('✅ Razorpay Service - Order created:', order.id);

    return {
      success: true,
      data: order
    };
  } catch (error) {
    console.error('❌ Razorpay Service Error:', error.message);
    console.error('Error Details:', error);
    return {
      success: false,
      message: error.message || 'Failed to create Razorpay order'
    };
  }
};

// Verify Payment Signature
exports.verifyPaymentSignature = (razorpay_order_id, razorpay_payment_id, razorpay_signature) => {
  try {
    const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest('hex');

    // Use timingSafeEqual to prevent timing attacks
    let isValid = false;
    try {
      const digestBuf = Buffer.from(digest, 'utf8');
      const sigBuf    = Buffer.from(razorpay_signature, 'utf8');
      if (digestBuf.length === sigBuf.length) {
        isValid = crypto.timingSafeEqual(digestBuf, sigBuf);
      }
    } catch {
      isValid = false;
    }

    if (isValid) {
      return { success: true,  message: 'Payment verified successfully' };
    } else {
      return { success: false, message: 'Payment verification failed' };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Fetch Payment Details
exports.fetchPaymentDetails = async (payment_id) => {
  try {
    const payment = await getClient().payments.fetch(payment_id);
    return {
      success: true,
      data: payment
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
};

// Refund Payment
exports.refundPayment = async (payment_id, amount) => {
  try {
    const refund = await getClient().payments.refund(payment_id, {
      amount: Math.round(amount * 100) // Convert to paise
    });
    return {
      success: true,
      data: refund
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
};
