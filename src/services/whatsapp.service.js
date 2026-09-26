// WhatsApp Notification Service
// Uses Twilio WhatsApp API to send order notifications to admin
// Setup: https://console.twilio.com → Messaging → Try it out → Send a WhatsApp message

const axios = require('axios');

/**
 * Send WhatsApp message via Twilio API
 */
const sendWhatsAppMessage = async (to, message) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID; // AC... from Twilio dashboard
  const apiKey = process.env.TWILIO_API_KEY;         // SK... API Key SID
  const apiSecret = process.env.TWILIO_API_SECRET;   // API Key Secret
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  // If Twilio not configured, log to console (development mode)
  if (!accountSid || !apiKey || !apiSecret) {
    console.log('📱 WhatsApp Notification (Twilio not configured):');
    console.log(`   To: ${to}`);
    console.log(`   Message:\n${message}`);
    return { success: true, message: 'Logged to console (Twilio not configured)' };
  }

  try {
    const toNumber = `whatsapp:+91${to.replace(/\D/g, '').slice(-10)}`; // Format Indian number

    // Twilio API Key auth: URL uses Account SID, Basic auth uses API Key SID + Secret
    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({
        From: fromNumber,
        To: toNumber,
        Body: message
      }),
      {
        auth: {
          username: apiKey,    // API Key SID (SK...)
          password: apiSecret  // API Key Secret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('✅ WhatsApp sent to admin:', response.data.sid);
    return { success: true, sid: response.data.sid };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    console.error('❌ WhatsApp send failed:', errMsg);
    return { success: false, message: errMsg };
  }
};

/**
 * Send new order notification to admin WhatsApp
 */
exports.sendNewOrderNotification = async (order, user) => {
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER;

  if (!adminPhone) {
    console.log('⚠️  ADMIN_WHATSAPP_NUMBER not set in env — skipping WhatsApp notification');
    return;
  }

  // Format order items
  const itemsList = order.orderItems
    .map((item, i) => `  ${i + 1}. ${item.name} x${item.quantity} @ ₹${item.price}`)
    .join('\n');

  const message = `🛒 *NEW ORDER RECEIVED!*

📦 *Order ID:* ${order._id}
📅 *Date:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

👤 *Customer Details:*
  Name: ${user.name}
  Phone: ${user.phone}
  Email: ${user.email}

🛍️ *Items Ordered:*
${itemsList}

💰 *Payment:*
  Items Total: ₹${order.itemsPrice}
  Shipping: ₹${order.shippingPrice}
  *Grand Total: ₹${order.totalAmount}*
  Mode: ${order.paymentMode === 'cod' ? 'Cash on Delivery' : 'Online Payment'}

📍 *Shipping Address:*
  ${order.shippingAddress?.street || ''}
  ${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''}
  PIN: ${order.shippingAddress?.pincode || ''}

👉 Login to admin panel to manage this order.`;

  return await sendWhatsAppMessage(adminPhone, message);
};
