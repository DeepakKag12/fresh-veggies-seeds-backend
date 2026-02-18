const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('../services/emailService');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    // Validate input
    if (!name || !phone || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, phone, email, password'
      });
    }

    // Check if user exists
    const existingEmail = await User.findOne({ email });
    const existingPhone = await User.findOne({ phone });
    
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please login or use a different email.'
      });
    }
    
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'An account with this phone number already exists. Please login or use a different number.'
      });
    }

    // Create user
    const user = await User.create({
      name,
      phone,
      email,
      password
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user with password
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.isLocked && user.lockedUntil && user.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / (1000 * 60));
      return res.status(429).json({
        success: false,
        message: `Account is locked due to too many failed login attempts. Please try again in ${minutesLeft} minutes or use forgot password to reset.`
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      // Increment login attempts
      await user.incrementLoginAttempts();
      
      // Fetch updated user to check if now locked
      const updatedUser = await User.findById(user._id);
      
      let attemptsRemaining = 5 - updatedUser.loginAttempts;
      if (attemptsRemaining < 0) attemptsRemaining = 0;
      
      return res.status(401).json({
        success: false,
        message: `Invalid credentials. ${attemptsRemaining} attempts remaining.`
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        address: user.address,
        token
      }
    });
  } catch (error) {
    console.error('❌ LOGIN ERROR:', error.message, '| JWT_SECRET set:', !!process.env.JWT_SECRET);
    res.status(500).json({
      success: false,
      message: !process.env.JWT_SECRET ? 'JWT_SECRET environment variable not configured' : error.message
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, phone, address },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Change user email
// @route   PUT /api/auth/change-email
// @access  Private
exports.changeEmail = async (req, res) => {
  try {
    const { newEmail, password } = req.body;

    // Validate input
    if (!newEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new email and current password'
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');
    
    // Verify current password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Check if new email already exists
    const existingEmail = await User.findOne({ email: newEmail });
    if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'This email is already in use'
      });
    }

    // Update email
    user.email = newEmail;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Email updated successfully',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Change user password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password'
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');
    
    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Forgot Password - Send reset link
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address'
      });
    }

    // Generate reset token
    const resetToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // Create reset URL - use production URL, not localhost
    const frontendUrl = (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes('localhost'))
      ? process.env.FRONTEND_URL
      : 'https://fresh-veggies-seeds-frontend.vercel.app';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    // Send email
    const emailResult = await emailService.sendForgotPasswordEmail(user, resetToken, resetUrl);

    if (!emailResult.success) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });
      
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email. Please try again later.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Password reset link sent to your email. Please check your inbox.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reset Password using token
// @route   POST /api/auth/reset-password/:resetToken
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken } = req.params;
    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password and confirmation'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Hash reset token to find user
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Set new password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Send confirmation email
    await emailService.sendPasswordResetConfirmation(user);

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.',
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Login with Mobile Number - Send OTP
// @route   POST /api/auth/send-otp
// @access  Public
exports.sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your phone number'
      });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this phone number. Please register first.'
      });
    }

    // Check if account is locked
    if (user.isLocked && user.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / (1000 * 60));
      return res.status(429).json({
        success: false,
        message: `Account is locked. Please try again in ${minutesLeft} minutes.`
      });
    }

    // Generate OTP
    const otp = user.generateOTP();
    await user.save({ validateBeforeSave: false });

    // Send OTP via email
    const emailResult = await emailService.sendOTPEmail(user, otp);

    if (!emailResult.success) {
      user.otpToken = undefined;
      user.otpExpires = undefined;
      await user.save({ validateBeforeSave: false });
      
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP: ${emailResult.error || emailResult.message || 'Email service error'}`
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent to your registered email. It will expire in 10 minutes.',
      userId: user._id
    });
  } catch (error) {
    console.error('❌ SEND-OTP ERROR:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Verify OTP and Login
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide user ID and OTP'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check OTP expiration
    if (!user.otpExpires || user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Hash OTP to compare
    const hashedOTP = crypto
      .createHash('sha256')
      .update(otp)
      .digest('hex');

    // Verify OTP
    if (hashedOTP !== user.otpToken) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      
      // Lock account after 5 failed attempts
      if (user.otpAttempts >= 5) {
        user.isLocked = true;
        user.lockedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      }
      
      await user.save({ validateBeforeSave: false });
      
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${5 - user.otpAttempts} attempts remaining.`
      });
    }

    // Clear OTP and reset login attempts
    user.otpToken = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    user.loginAttempts = 0;
    user.isLocked = false;
    user.lockedUntil = undefined;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        address: user.address,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
