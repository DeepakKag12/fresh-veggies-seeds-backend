/**
 * Order Notification Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Every customer- and admin-facing message about an order's lifecycle.
 *
 * Before this existed the order flow was silent: a customer got no confirmation
 * and no delivery updates, and the admin was never told a new order had arrived
 * (whatsappService.sendNewOrderNotification was written but never called). The
 * only way to notice a sale was to open the admin panel and look.
 *
 * Delivery rules:
 *   - Every send is best-effort and never throws. A mail outage must not fail a
 *     payment that has already been captured, so callers fire these and move on.
 *   - Nothing is awaited by the request path.
 */

const nodemailer      = require('nodemailer');
const whatsappService = require('../services/whatsappService');
const Settings        = require('../models/Settings');

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.BREVO_SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS
  },
  tls: { rejectUnauthorized: false }
});

const BRAND  = '#16a34a';
const money  = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const isConfigured = () => Boolean(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS);

/** Send an email, swallowing every failure. Logs to console when SMTP is unset. */
const send = async (to, subject, html) => {
  if (!to) return { success: false, message: 'No recipient' };

  if (!isConfigured()) {
    console.log(`📧 [${subject}] → ${to} (Brevo not configured — not sent)`);
    return { success: true, message: 'Logged to console (Brevo not configured)' };
  }

  try {
    await transporter.sendMail({
      from: process.env.BREVO_FROM_EMAIL || 'noreply@freshveggies.com',
      to,
      subject,
      html
    });
    return { success: true };
  } catch (error) {
    console.error(`❌ Email "${subject}" to ${to} failed:`, error.message);
    return { success: false, message: error.message };
  }
};

/** Shared shell so every order email looks the same. */
const layout = (title, bodyHtml) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#f9fafb;padding:24px">
  <div style="background:#fff;border-radius:8px;padding:28px">
    <h2 style="color:${BRAND};margin:0 0 16px">${title}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="color:#6b7280;font-size:12px;margin:0">Fresh Veggies &amp; Seeds — thank you for growing with us. 🌱</p>
  </div>
</div>`;

/** Order line items as an HTML table. */
const itemsTable = (order) => `
<table style="width:100%;border-collapse:collapse;margin:16px 0">
  <thead>
    <tr style="background:#f3f4f6">
      <th align="left"  style="padding:8px;font-size:13px">Item</th>
      <th align="center" style="padding:8px;font-size:13px">Qty</th>
      <th align="right" style="padding:8px;font-size:13px">Price</th>
    </tr>
  </thead>
  <tbody>
    ${order.orderItems.map((i) => `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px;font-size:14px">${i.name}</td>
        <td align="center" style="padding:8px;font-size:14px">${i.quantity}</td>
        <td align="right" style="padding:8px;font-size:14px">${money(i.price * i.quantity)}</td>
      </tr>`).join('')}
  </tbody>
</table>
<table style="width:100%;font-size:14px">
  <tr><td>Subtotal</td><td align="right">${money(order.itemsPrice)}</td></tr>
  <tr><td>Delivery</td><td align="right">${order.shippingPrice === 0 ? 'FREE' : money(order.shippingPrice)}</td></tr>
  ${order.discountAmount > 0 ? `<tr style="color:${BRAND}"><td>Discount${order.couponUsed?.code ? ` (${order.couponUsed.code})` : ''}</td><td align="right">−${money(order.discountAmount)}</td></tr>` : ''}
  <tr style="font-weight:bold;font-size:16px"><td style="padding-top:8px">Total</td><td align="right" style="padding-top:8px">${money(order.totalAmount)}</td></tr>
</table>`;

const addressBlock = (a) => `
<p style="font-size:14px;color:#374151;margin:4px 0">
  ${a?.name || ''}<br>
  ${a?.street || ''}<br>
  ${a?.city || ''}, ${a?.state || ''} — ${a?.pincode || ''}<br>
  📞 ${a?.phone || ''}
</p>`;

// ─── Customer: order placed ──────────────────────────────────────────────────

exports.sendOrderConfirmation = async (order, user) => {
  const settings = await Settings.getSingleton().catch(() => null);
  if (settings && settings.notifications?.customer?.orderConfirmation?.email === false) {
    return { success: true, message: 'Customer confirmation email disabled in settings' };
  }

  const paid = order.paymentStatus === 'Paid';
  return send(
    user?.email,
    `Order ${order.orderNumber} confirmed — Fresh Veggies`,
    layout(`Thanks for your order, ${user?.name || 'there'}!`, `
      <p style="font-size:14px">Your order <strong>${order.orderNumber}</strong> is confirmed and we're getting it ready.</p>
      <p style="font-size:14px">Payment: <strong>${order.paymentMode === 'COD' ? 'Cash on Delivery' : 'Paid online'}</strong>${paid ? ' ✅' : ''}</p>
      ${itemsTable(order)}
      <h3 style="font-size:15px;margin:20px 0 4px">Delivering to</h3>
      ${addressBlock(order.shippingAddress)}
      <p style="font-size:13px;color:#6b7280">We'll email you again as soon as it ships.</p>
    `)
  );
};

// ─── Admin: new order arrived ────────────────────────────────────────────────

exports.notifyAdminNewOrder = async (order, user) => {
  const settings = await Settings.getSingleton().catch(() => null);
  const emailEnabled = settings ? settings.notifications?.admin?.newOrder?.email !== false : true;
  const whatsappEnabled = settings ? settings.notifications?.admin?.newOrder?.whatsapp !== false : true;

  const promises = [];

  if (emailEnabled) {
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.sendOrdermailtoadmin || process.env.BREVO_FROM_EMAIL;
    promises.push(
      send(
        adminEmail,
        `🛒 New order ${order.orderNumber} — ${money(order.totalAmount)}`,
        layout(`New order received`, `
          <p style="font-size:14px"><strong>${order.orderNumber}</strong> · ${order.paymentMode === 'COD' ? 'Cash on Delivery' : 'Paid online'}</p>
          <h3 style="font-size:15px;margin:20px 0 4px">Customer</h3>
          <p style="font-size:14px;margin:4px 0">${user?.name || '—'}<br>📞 ${user?.phone || '—'}<br>✉️ ${user?.email || '—'}</p>
          ${itemsTable(order)}
          <h3 style="font-size:15px;margin:20px 0 4px">Ship to</h3>
          ${addressBlock(order.shippingAddress)}
        `)
      )
    );
  }

  if (whatsappEnabled) {
    promises.push(whatsappService.sendNewOrderNotification(order, user || {}));
  }

  const results = await Promise.allSettled(promises);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`⚠️  Admin new-order notification failed:`, r.reason?.message);
    }
  });
};

// ─── Customer: status changed ────────────────────────────────────────────────

const STATUS_COPY = {
  Confirmed: { subject: 'is confirmed',  title: 'Order confirmed',  body: "We've received your order and are preparing it." },
  Packed:    { subject: 'is packed',     title: 'Order packed',     body: 'Your order is packed and waiting for pickup by our courier.' },
  Shipped:   { subject: 'is on its way', title: 'Order shipped 🚚', body: 'Your order has been handed to the courier.' },
  Delivered: { subject: 'was delivered', title: 'Order delivered ✅', body: 'Your order has been delivered. We hope you love it!' },
  Cancelled: { subject: 'was cancelled', title: 'Order cancelled',  body: 'Your order has been cancelled.' },
};

exports.sendStatusUpdate = async (order, user, newStatus) => {
  const copy = STATUS_COPY[newStatus];
  if (!copy) return { success: false, message: `No customer copy for status "${newStatus}"` };

  const tracking = newStatus === 'Shipped' && order.shipping?.awbNumber
    ? `<p style="font-size:14px">Courier: <strong>${order.shipping.courierName || 'DTDC'}</strong><br>
         Tracking number: <strong>${order.shipping.awbNumber}</strong></p>
       ${order.shipping.trackingUrl ? `<p><a href="${order.shipping.trackingUrl}" style="background:${BRAND};color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-size:14px">Track your parcel</a></p>` : ''}`
    : '';

  const refund = newStatus === 'Cancelled' && order.refund?.refundStatus === 'Processed'
    ? `<p style="font-size:14px;color:${BRAND}">A refund of ${money(order.refund.refundAmount)} has been initiated and should reach your account in 5–7 business days.</p>`
    : '';

  return send(
    user?.email,
    `Order ${order.orderNumber} ${copy.subject} — Fresh Veggies`,
    layout(copy.title, `
      <p style="font-size:14px">Hi ${user?.name || 'there'}, ${copy.body}</p>
      <p style="font-size:14px">Order <strong>${order.orderNumber}</strong> · ${money(order.totalAmount)}</p>
      ${tracking}
      ${refund}
    `)
  );
};

// ─── Customer: refund processed ──────────────────────────────────────────────

exports.sendRefundNotification = async (order, user) => send(
  user?.email,
  `Refund initiated for order ${order.orderNumber}`,
  layout('Refund on its way', `
    <p style="font-size:14px">Hi ${user?.name || 'there'}, we've initiated a refund of
      <strong>${money(order.refund?.refundAmount || order.totalAmount)}</strong> for order
      <strong>${order.orderNumber}</strong>.</p>
    <p style="font-size:14px">It should appear in your account within 5–7 business days.</p>
  `)
);
