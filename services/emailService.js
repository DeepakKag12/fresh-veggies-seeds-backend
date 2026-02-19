// Email Service - For sending password recovery and OTP emails
// Configured for Brevo (Sendinblue) SMTP

const nodemailer = require('nodemailer');

// Create transporter for Brevo SMTP
let transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.BREVO_SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

/**
 * Send Forgot Password Email
 * @param {Object} user - User object
 * @param {String} resetToken - Reset token
 * @param {String} resetUrl - Frontend reset URL
 */
exports.sendForgotPasswordEmail = async (user, resetToken, resetUrl) => {
  try {
    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
      console.log(`📧 Forgot Password Email (Development Mode - Brevo not configured):`);
      console.log(`   To: ${user.email}`);
      console.log(`   Reset URL: ${resetUrl}`);
      return { success: true, message: 'Email logged to console (Brevo not configured)' };
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #16a34a; padding: 20px; text-align: center; color: white;">
          <h2 style="margin: 0;">Fresh Veggies</h2>
          <p style="margin: 5px 0 0 0;">Password Reset Request</p>
        </div>
        <div style="padding: 30px; background-color: #f9fafb;">
          <p style="color: #374151;">Hello ${user.name},</p>
          <p style="color: #374151;">You have requested to reset your password. Click the button below to proceed:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Reset Password</a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link:</p>
          <p style="color: #059669; word-break: break-all; font-size: 12px;">${resetUrl}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <p style="color: #9ca3af; font-size: 12px;">This link expires in 2 hours. If you didn't request this, please ignore this email.</p>
          <p style="color: #9ca3af; font-size: 12px;">© 2024 Fresh Veggies. All rights reserved.</p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: process.env.BREVO_FROM_EMAIL || 'noreply@freshveggies.com',
      to: user.email,
      subject: 'Reset Your Fresh Veggies Password',
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Forgot Password Email sent to: ${user.email} (Message ID: ${info.messageId})`);
    
    return {
      success: true,
      message: 'Password reset email sent successfully'
    };
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    return {
      success: false,
      message: 'Failed to send reset email',
      error: error.message
    };
  }
};

/**
 * Send OTP Email for Mobile Login
 * @param {Object} user - User object
 * @param {String} otp - One-time password
 */
exports.sendOTPEmail = async (user, otp) => {
  try {
    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
      console.log(`📧 OTP Email (Development Mode - Brevo not configured):`);
      console.log(`   To: ${user.email}`);
      console.log(`   OTP: ${otp}`);
      return { success: true, message: 'Email logged to console (Brevo not configured)' };
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #16a34a; padding: 20px; text-align: center; color: white;">
          <h2 style="margin: 0;">Fresh Veggies</h2>
          <p style="margin: 5px 0 0 0;">Login OTP</p>
        </div>
        <div style="padding: 30px; background-color: #f9fafb;">
          <p style="color: #374151;">Hello ${user.name},</p>
          <p style="color: #374151;">Your One-Time Password for Fresh Veggies login is:</p>
          <div style="text-align: center; margin: 30px 0;">
            <div style="background-color: #16a34a; color: white; padding: 30px; border-radius: 10px; font-size: 48px; font-weight: bold; letter-spacing: 10px; font-family: monospace;">
              ${otp}
            </div>
          </div>
          <p style="color: #dc2626; font-size: 14px; text-align: center;">⏱️ This OTP expires in 10 minutes</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <p style="color: #9ca3af; font-size: 12px;">🔒 Do not share this OTP with anyone. Fresh Veggies will never ask for your OTP.</p>
          <p style="color: #9ca3af; font-size: 12px;">If you didn't request this code, please contact our support team immediately.</p>
          <p style="color: #9ca3af; font-size: 12px;">© 2024 Fresh Veggies. All rights reserved.</p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: process.env.BREVO_FROM_EMAIL || 'noreply@freshveggies.com',
      to: user.email,
      subject: 'Your Fresh Veggies Login OTP - Valid for 10 Minutes',
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP Email sent to: ${user.email} (Message ID: ${info.messageId})`);
    
    return {
      success: true,
      message: 'OTP sent successfully'
    };
  } catch (error) {
    console.error('❌ Error sending OTP email:', error.message);
    return {
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    };
  }
};

/**
 * Send Password Reset Confirmation Email
 * @param {Object} user - User object
 */
exports.sendPasswordResetConfirmation = async (user) => {
  try {
    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
      console.log(`📧 Password Reset Confirmation (Development Mode - Brevo not configured):`);
      console.log(`   To: ${user.email}`);
      return { success: true, message: 'Email logged to console (Brevo not configured)' };
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #16a34a; padding: 20px; text-align: center; color: white;">
          <h2 style="margin: 0;">Fresh Veggies</h2>
          <p style="margin: 5px 0 0 0;">Password Reset Successful</p>
        </div>
        <div style="padding: 30px; background-color: #f9fafb;">
          <p style="color: #374151;">Hello ${user.name},</p>
          <p style="color: #374151;">✅ Your password has been successfully reset.</p>
          <p style="color: #374151;">You can now login with your new password.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://fresh-veggies-seeds-frontend.vercel.app/login" style="background-color: #16a34a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Go to Login</a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          <p style="color: #dc2626; font-size: 12px;">🔒 If you didn't make this change, please contact our support team immediately.</p>
          <p style="color: #9ca3af; font-size: 12px;">© 2024 Fresh Veggies. All rights reserved.</p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: process.env.BREVO_FROM_EMAIL || 'noreply@freshveggies.com',
      to: user.email,
      subject: 'Password Reset Successful - Fresh Veggies',
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password Reset Confirmation sent to: ${user.email} (Message ID: ${info.messageId})`);
    
    return {
      success: true,
      message: 'Confirmation email sent'
    };
  } catch (error) {
    console.error('❌ Error sending confirmation email:', error.message);
    return {
      success: false,
      message: 'Failed to send confirmation'
    };
  }
};

/**
 * Send Low Stock Alert Email to Admin
 * @param {Array<{name: string, stock: number}>} lowStockItems
 */
exports.sendLowStockAlertEmail = async (lowStockItems) => {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.BREVO_FROM_EMAIL;
  const threshold  = parseInt(process.env.LOW_STOCK_THRESHOLD) || 10;

  // Always log to console regardless of email config
  console.log(`⚠️  LOW STOCK ALERT — ${lowStockItems.length} product(s) need restocking:`);
  lowStockItems.forEach((p) =>
    console.log(`   • ${p.name}: ${p.stock === 0 ? 'OUT OF STOCK' : `${p.stock} units left`}`)
  );

  if (!adminEmail) {
    console.warn('⚠️  ADMIN_ALERT_EMAIL not set — low stock email not sent');
    return { success: false, message: 'No admin email configured' };
  }

  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    console.log('📧  Low Stock Alert (Brevo not configured — logged to console only)');
    return { success: true, message: 'Logged to console (Brevo not configured)' };
  }

  const rows = lowStockItems
    .map(
      (p) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${p.name}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:bold;text-align:center;color:${p.stock === 0 ? '#dc2626' : '#ea580c'};">
        ${p.stock === 0 ? '🔴 OUT OF STOCK' : `⚠️ ${p.stock} units`}
      </td>
    </tr>`
    )
    .join('');

  const adminLink = `${process.env.FRONTEND_URL || 'https://fresh-veggies-seeds-frontend.vercel.app'}/admin/products`;

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#dc2626;padding:24px;text-align:center;color:white;">
        <h2 style="margin:0;font-size:22px;">⚠️ Low Stock Alert</h2>
        <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Fresh Veggies — Admin Notification</p>
      </div>
      <div style="padding:28px;background:#f9fafb;">
        <p style="color:#374151;font-size:15px;margin-top:0;">
          The following <strong>${lowStockItems.length} product${lowStockItems.length > 1 ? 's' : ''}</strong>
          dropped below <strong>${threshold} units</strong> after a recent order was confirmed.
          Please restock immediately.
        </p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
          <thead>
            <tr style="background:#1f2937;">
              <th style="padding:12px 16px;text-align:left;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Product Name</th>
              <th style="padding:12px 16px;text-align:center;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Stock Remaining</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:28px;text-align:center;">
          <a href="${adminLink}" style="background:#16a34a;color:white;padding:14px 32px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:15px;">
            ➜ Update Stock Now
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
          Automated alert from Fresh Veggies admin system · Stock threshold: ${threshold} units
        </p>
      </div>
    </div>`;

  try {
    const info = await transporter.sendMail({
      from: process.env.BREVO_FROM_EMAIL || 'noreply@freshveggies.com',
      to: adminEmail,
      subject: `⚠️ Low Stock Alert — ${lowStockItems.length} product${lowStockItems.length > 1 ? 's' : ''} need restocking`,
      html: htmlContent,
    });
    console.log(`✅ Low Stock Alert email sent to ${adminEmail} (ID: ${info.messageId})`);
    return { success: true };
  } catch (error) {
    console.error('❌ Low Stock Alert email error:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = exports;
