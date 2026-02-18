// SMS Service - For sending OTP via Twilio
// This service sends OTP to mobile numbers via SMS (not email)

const twilio = require('twilio');

// Initialize Twilio client
let twilioClient = null;

const initializeTwilio = () => {
  if (!twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
      console.warn('⚠️ Twilio credentials not configured in .env');
      return null;
    }
    
    twilioClient = twilio(accountSid, authToken);
  }
  return twilioClient;
};

/**
 * Send OTP via SMS to phone number
 * @param {String} phone - Phone number (10 digits for India, e.g., 9876543210)
 * @param {String} otp - One-time password (6 digits)
 */
exports.sendOTPSMS = async (phone, otp) => {
  try {
    const client = initializeTwilio();
    
    if (!client) {
      // Fallback: Log OTP to console (for development without Twilio)
      console.log(`📱 SMS OTP for ${phone}: ${otp} (Twilio not configured)`);
      return {
        success: true,
        message: 'OTP sent successfully (Console mode)',
        mode: 'console'
      };
    }

    const phoneNumber = `+91${phone}`; // Add India country code
    const message = `Your Fresh Veggies login OTP is: ${otp}. Valid for 10 minutes. Do not share with anyone. #FreshVeggies`;

    const response = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });

    console.log(`✅ SMS sent to ${phoneNumber} - SID: ${response.sid}`);
    
    return {
      success: true,
      message: 'OTP sent via SMS successfully',
      messageSid: response.sid
    };
  } catch (error) {
    console.error('❌ Error sending OTP SMS:', error.message);
    return {
      success: false,
      message: 'Failed to send OTP via SMS'
    };
  }
};

/**
 * Send Password Reset Notification via SMS
 * @param {String} phone - Phone number
 * @param {String} resetUrl - Reset password URL
 */
exports.sendPasswordResetSMS = async (phone, resetUrl) => {
  try {
    const client = initializeTwilio();
    
    if (!client) {
      console.log(`📱 Password reset link for ${phone}: ${resetUrl} (Twilio not configured)`);
      return {
        success: true,
        message: 'Reset link sent (Console mode)',
        mode: 'console'
      };
    }

    const phoneNumber = `+91${phone}`;
    const message = `Your Fresh Veggies password reset link: ${resetUrl}. Valid for 2 hours. #FreshVeggies`;

    const response = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });

    console.log(`✅ Password reset SMS sent to ${phoneNumber}`);
    
    return {
      success: true,
      message: 'Reset link sent via SMS',
      messageSid: response.sid
    };
  } catch (error) {
    console.error('❌ Error sending reset SMS:', error.message);
    return {
      success: false,
      message: 'Failed to send reset SMS'
    };
  }
};

/**
 * Send Account Locked Notification
 * @param {String} phone - Phone number
 */
exports.sendAccountLockedSMS = async (phone) => {
  try {
    const client = initializeTwilio();
    
    if (!client) {
      console.log(`📱 Account locked notification for ${phone} (Twilio not configured)`);
      return { success: true, mode: 'console' };
    }

    const phoneNumber = `+91${phone}`;
    const message = `Your Fresh Veggies account is locked due to multiple failed login attempts. It will unlock after 60 minutes or contact support. #FreshVeggies`;

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });

    console.log(`✅ Account locked notification sent to ${phoneNumber}`);
    
    return {
      success: true,
      message: 'Notification sent'
    };
  } catch (error) {
    console.error('❌ Error sending notification:', error.message);
    return {
      success: false,
      message: 'Failed to send notification'
    };
  }
};

module.exports = exports;
