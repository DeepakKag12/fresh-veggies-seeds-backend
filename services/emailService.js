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

module.exports = exports;
