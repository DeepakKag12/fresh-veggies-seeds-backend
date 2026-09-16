const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const msg91Service = require('../services/msg91Service');
const { isValidEmail, isValidPhone, validatePassword, validateCart, cleanText } = require('../utils/validators');
// Email verification is opt-in. It is off by default so a store can run without
// SMTP configured; set REQUIRE_EMAIL_VERIFICATION=true to enforce it.
const requireEmailVerification = () =>
  String(process.env.REQUIRE_EMAIL_VERIFICATION || '').toLowerCase() === 'true';

const { serverError } = require('../utils/respond');

const getFrontendUrl = () => (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes('localhost'))
  ? process.env.FRONTEND_URL
  : 'https://fresh-veggies-seeds-frontend.vercel.app';

// Generate JWT Token.
// `tv` pins the token to the user's current tokenVersion, so a password change
// or an explicit logout-everywhere immediately invalidates it (see middleware/auth.js).
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone?.trim();

    // ── Validation ────────────────────────────────────────────────────────────
    if (!name || !normalizedPhone || !normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, phone, email, password'
      });
    }

    const cleanName = cleanText(name, 100);
    if (cleanName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide a valid name.' });
    }

    // The schema only lowercases the email — it never checked the shape, so
    // "notanemail" registered fine and then silently failed every send.
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit Indian mobile number.' });
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ success: false, message: pwCheck.message });
    }

    // Friendly pre-check. It cannot be authoritative — two concurrent
    // registrations both pass it — so the unique index is the real guard and
    // the duplicate-key error is translated to a 409 by the error handler.
    const existingEmail = await User.findOne({ email: normalizedEmail }).lean();
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists. Please login or use a different email.'
      });
    }

    const existingPhone = await User.findOne({ phone: normalizedPhone }).lean();
    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: 'An account with this phone number already exists. Please login or use a different number.'
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationUrl = `${getFrontendUrl()}/verify-email/${verificationToken}`;

    const mustVerify = requireEmailVerification();

    const user = await User.create({
      name: cleanName,
      phone: normalizedPhone,
      email: normalizedEmail,
      password,
      emailVerified: !mustVerify,
      ...(mustVerify ? {
        emailVerificationToken: crypto.createHash('sha256').update(verificationToken).digest('hex'),
        emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      } : {}),
    });

    if (mustVerify) {
      const emailResult = await emailService.sendVerificationEmail(user, verificationUrl);
      if (!emailResult.success) {
        // Only meaningful while verification is required: without the email the
        // account could never be used, so it is rolled back.
        await User.findByIdAndDelete(user._id);
        return res.status(500).json({ success: false, message: 'Unable to send verification email. Please try again later.' });
      }
    } else {
      // Best-effort welcome; a mail failure must not fail the signup.
      emailService.sendVerificationEmail(user, verificationUrl).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: mustVerify
        ? 'Registration successful. Please verify your email before logging in.'
        : 'Account created. You can sign in now.'
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → register');
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const rawIdentifier = (req.body.identifier || req.body.email || req.body.phone || '').toString().trim();
    const password = req.body.password;

    // Validate input
    if (!rawIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email or phone number and password'
      });
    }

    const isEmail = rawIdentifier.includes('@');
    const digits = rawIdentifier.replace(/\D/g, '');
    const cleanPhone = digits.length >= 10 ? digits.slice(-10) : null;

    let query;
    if (isEmail) {
      query = { email: rawIdentifier.toLowerCase() };
    } else if (cleanPhone && cleanPhone.length === 10) {
      query = { phone: cleanPhone };
    } else {
      query = { email: rawIdentifier.toLowerCase() };
    }

    // Find user with password
    const user = await User.findOne(query).select('+password');
    if (!user) {
      // Deliberately identical to the wrong-password response below. Returning a
      // distinguishable message here let anyone probe which emails/phones have accounts.
      return res.status(401).json({
        success: false,
        message: 'Invalid email/phone or password.'
      });
    }

    // Accounts created before verification was switched off, and every account
    // when it is off, sign in normally.
    if (requireEmailVerification() && user.emailVerified === false) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email address before logging in.'
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
      await user.incrementLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Please contact support.'
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        address: user.address,
        addresses: user.addresses || [],
        token
      }
    });
  } catch (error) {
    // Log the detail server-side; never tell a client about our configuration.
    console.error('❌ LOGIN ERROR:', error.message, '| JWT_SECRET set:', !!process.env.JWT_SECRET);
    res.status(500).json({ success: false, message: 'Unable to log in right now. Please try again.' });
  }
};

// @desc    Verify email ownership
// @route   GET /api/auth/verify-email/:token
// @access  Public
exports.verifyEmail = async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'This verification link is invalid or expired.' });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (error) {
    return serverError(res, error, 'authController.js → verifyEmail');
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-emailVerificationToken -emailVerificationExpires -resetPasswordToken -resetPasswordExpires -otpToken -otpExpires');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Backfill addresses if legacy address exists and addresses is empty
    if ((!user.addresses || user.addresses.length === 0) && user.address?.street) {
      user.addresses = [{
        name: user.name,
        phone: user.phone,
        street: user.address.street,
        city: user.address.city,
        state: user.address.state,
        pincode: user.address.pincode,
        country: user.address.country || 'India',
        isDefault: true,
        createdAt: new Date()
      }];
      await user.save({ validateBeforeSave: false });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → getMe');
  }
};

// @desc    Get the current user's cart
// @route   GET /api/auth/cart
// @access  Private
exports.getCart = async (req, res) => {
  res.status(200).json({ success: true, data: req.user.cart || [] });
};

// @desc    Save the current user's cart
// @route   PUT /api/auth/cart
// @access  Private
exports.updateCart = async (req, res) => {
  try {
    // `cart` is a Mixed array, so without this a client could persist arbitrary
    // unbounded JSON into their own user document.
    const cartCheck = validateCart(req.body.cart);
    if (!cartCheck.valid) {
      return res.status(400).json({ success: false, message: cartCheck.message });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { cart: req.body.cart },
      { new: true, runValidators: true }
    ).select('cart');

    res.status(200).json({ success: true, data: user.cart });
  } catch (error) {
    return serverError(res, error, 'authController.js → updateCart');
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const updates = {};

    if (name !== undefined) {
      const cleanName = cleanText(name, 100);
      if (cleanName.length < 2) {
        return res.status(400).json({ success: false, message: 'Please provide a valid name.' });
      }
      updates.name = cleanName;
    }

    if (phone !== undefined) {
      const trimmedPhone = String(phone).trim();
      if (!isValidPhone(trimmedPhone)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit Indian mobile number.' });
      }
      // `unique` is an index, not a validator, so runValidators does not catch
      // this — an unchecked duplicate surfaced as a raw E11000 500.
      const taken = await User.findOne({ phone: trimmedPhone, _id: { $ne: req.user._id } }).lean();
      if (taken) {
        return res.status(409).json({ success: false, message: 'That phone number is already in use.' });
      }
      updates.phone = trimmedPhone;
    }

    if (address !== undefined) {
      if (typeof address !== 'object' || address === null || Array.isArray(address)) {
        return res.status(400).json({ success: false, message: 'Address must be an object.' });
      }
      // Whitelist: assigning req.body.address wholesale let a client write
      // arbitrary keys into the sub-document.
      updates.address = {
        street:  cleanText(address.street, 200),
        city:    cleanText(address.city, 100),
        state:   cleanText(address.state, 100),
        pincode: cleanText(address.pincode, 10),
        country: cleanText(address.country, 100) || 'India'
      };
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (updates.name) user.name = updates.name;
    if (updates.phone) user.phone = updates.phone;
    if (updates.address) {
      user.address = updates.address;
      if (!user.addresses) user.addresses = [];
      const defaultAddr = user.addresses.find(a => a.isDefault);
      if (defaultAddr) {
        defaultAddr.street = updates.address.street;
        defaultAddr.city = updates.address.city;
        defaultAddr.state = updates.address.state;
        defaultAddr.pincode = updates.address.pincode;
        defaultAddr.country = updates.address.country;
      } else if (updates.address.street) {
        user.addresses.push({
          name: user.name,
          phone: user.phone,
          ...updates.address,
          isDefault: true,
          createdAt: new Date()
        });
      }
    }

    await user.save();

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → updateProfile');
  }
};

// @desc    Change user email
// @route   PUT /api/auth/change-email
// @access  Private
exports.changeEmail = async (req, res) => {
  try {
    const { newEmail, password } = req.body;
    const normalizedEmail = newEmail?.trim().toLowerCase();

    // Validate input
    if (!normalizedEmail || !password) {
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
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'This email is already in use'
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.email = normalizedEmail;
    user.emailVerified = false;
    user.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    await user.save();

    const emailResult = await emailService.sendVerificationEmail(
      user,
      `${getFrontendUrl()}/verify-email/${verificationToken}`
    );
    if (!emailResult.success) {
      return res.status(500).json({ success: false, message: 'Email changed, but verification email could not be sent.' });
    }

    res.status(200).json({
      success: true,
      message: 'Email updated. Please verify your new email address before logging in again.',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → changeEmail');
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

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ success: false, message: pwCheck.message });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from your current password.'
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
      token: generateToken(user)
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → changePassword');
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

    // Always answer the same way whether or not the account exists — a 404 here
    // turned this endpoint into a free "does this email have an account?" oracle.
    const genericResponse = {
      success: true,
      message: 'If an account exists for that email, a password reset link has been sent.'
    };

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.isActive) {
      return res.status(200).json(genericResponse);
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

    res.status(200).json(genericResponse);
  } catch (error) {
    return serverError(res, error, 'authController.js → forgotPassword');
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

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ success: false, message: pwCheck.message });
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
      token: generateToken(user)
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → resetPassword');
  }
};

// @desc    Login with Mobile Number or Email - Send OTP
// @route   POST /api/auth/send-otp
// @access  Public
exports.sendOTP = async (req, res) => {
  try {
    const rawIdentifier = (req.body.phone || req.body.email || req.body.identifier || '').toString().trim();

    if (!rawIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your phone number or email address'
      });
    }

    const isEmail = rawIdentifier.includes('@');
    const cleanPhone = rawIdentifier.replace(/\D/g, '').slice(-10);

    let query;
    if (isEmail) {
      query = { email: rawIdentifier.toLowerCase() };
    } else if (cleanPhone && cleanPhone.length === 10) {
      query = { phone: cleanPhone };
    } else {
      query = { email: rawIdentifier.toLowerCase() };
    }

    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this credential. Please register first.'
      });
    }

    if (requireEmailVerification() && user.emailVerified === false) {
      return res.status(403).json({ success: false, message: 'Please verify your email address before using OTP login.' });
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

    // Send OTP via email if email exists
    let emailResult = { success: false };
    if (user.email) {
      emailResult = await emailService.sendOTPEmail(user, otp);
    }

    // If no email or email failed, check if MSG91 is available
    if (!emailResult.success && user.phone) {
      try {
        const msgResult = await msg91Service.sendOtp(user.phone);
        if (msgResult && msgResult.success) {
          emailResult = { success: true };
        }
      } catch (smsErr) {
        // Continue
      }
    }

    if (!emailResult.success && !process.env.NODE_ENV?.includes('test')) {
      user.otpToken = undefined;
      user.otpExpires = undefined;
      await user.save({ validateBeforeSave: false });
      
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP: ${emailResult.error || emailResult.message || 'Notification service error'}`
      });
    }

    res.status(200).json({
      success: true,
      message: `OTP sent successfully. It will expire in 10 minutes.`,
      userId: user._id
    });
  } catch (error) {
    return serverError(res, error, 'authController → sendOTP', 'Could not send the OTP. Please try again.');
  }
};

// @desc    Verify OTP and Login
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOTP = async (req, res) => {
  try {
    const { userId, phone, email, identifier, otp } = req.body;

    if ((!userId && !phone && !email && !identifier) || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide user ID/phone/email and OTP'
      });
    }

    let user = null;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    } else {
      const raw = (phone || email || identifier || '').toString().trim();
      const isEmail = raw.includes('@');
      const cleanPhone = raw.replace(/\D/g, '').slice(-10);
      user = await User.findOne(isEmail ? { email: raw.toLowerCase() } : { phone: cleanPhone });
    }

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated. Please contact support.' });
    }

    // sendOTP refuses to issue a code to a locked account, but an account can be
    // locked after a code was issued — re-check here so a lock cannot be
    // side-stepped with an OTP obtained moments earlier.
    if (user.isLocked && user.lockedUntil && user.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / (1000 * 60));
      return res.status(429).json({
        success: false,
        message: `Account is locked. Please try again in ${minutesLeft} minutes.`
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

    // Verify OTP — timing-safe so the comparison cannot be probed byte by byte.
    const otpMatches = user.otpToken
      && hashedOTP.length === user.otpToken.length
      && crypto.timingSafeEqual(Buffer.from(hashedOTP), Buffer.from(user.otpToken));

    if (!otpMatches) {
      const MAX_OTP_ATTEMPTS = 5;
      user.otpAttempts = (user.otpAttempts || 0) + 1;

      if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
        user.isLocked = true;
        user.lockedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        // Burn the code as well, so a lock cannot be waited out and the same
        // OTP retried afterwards.
        user.otpToken = undefined;
        user.otpExpires = undefined;
      }

      await user.save({ validateBeforeSave: false });

      // Math.max: the old expression produced "-1 attempts remaining".
      const remaining = Math.max(0, MAX_OTP_ATTEMPTS - user.otpAttempts);
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remaining} attempts remaining.`
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
        addresses: user.addresses || [],
        token: generateToken(user)
      }
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → verifyOTP');
  }
};

// @desc    Verify MSG91 OTP Widget Access Token and Authenticate / Register Customer
// @route   POST /api/auth/msg91/verify-token
// @access  Public
exports.verifyMsg91Token = async (req, res) => {
  try {
    const { accessToken, name, phone } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Access token from MSG91 OTP widget is required'
      });
    }

    // ── Verify token with MSG91 server-side ──────────────────────────────
    const verification = await msg91Service.verifyAccessToken(accessToken, phone);
    if (!verification.success) {
      return res.status(400).json({
        success: false,
        message: verification.message || 'OTP verification failed'
      });
    }

    const verifiedPhone = verification.phone;

    // ── Find or Create Customer ──────────────────────────────────────────
    let user = await User.findOne({ phone: verifiedPhone });
    let isNewUser = false;

    if (user) {
      // Existing customer
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Account has been deactivated. Please contact support.'
        });
      }

      if (user.isLocked && user.lockedUntil && user.lockedUntil > Date.now()) {
        const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / (1000 * 60));
        return res.status(429).json({
          success: false,
          message: `Account is locked. Please try again in ${minutesLeft} minutes.`
        });
      }

      // Reset login attempts on verified OTP
      user.loginAttempts = 0;
      user.isLocked = false;
      user.lockedUntil = undefined;
      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });
    } else {
      // New customer — minimum required record, no forced password
      isNewUser = true;
      const cleanCustomerName = cleanText(name || `Customer ${verifiedPhone.slice(-4)}`, 100);
      user = await User.create({
        name: cleanCustomerName,
        phone: verifiedPhone,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        addresses: []
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Welcome to Fresh Veggies!' : 'Welcome back!',
      isNewUser,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email || '',
        phone: user.phone,
        role: user.role,
        address: user.address,
        addresses: user.addresses || [],
        token
      }
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → verifyMsg91Token');
  }
};

// @desc    Send MSG91 SMS OTP directly
// @route   POST /api/auth/msg91/send-otp
// @access  Public
exports.sendMsg91Otp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Please provide a 10-digit mobile number' });
    }

    const result = await msg91Service.sendOtp(phone);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    res.status(200).json(result);
  } catch (error) {
    return serverError(res, error, 'authController.js → sendMsg91Otp');
  }
};

// @desc    Verify MSG91 SMS OTP and authenticate/create customer
// @route   POST /api/auth/msg91/verify-otp
// @access  Public
exports.verifyMsg91Otp = async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone number and 4-digit OTP are required' });
    }

    const verification = await msg91Service.verifyOtp(phone, otp);
    if (!verification.success) {
      return res.status(400).json({ success: false, message: verification.message || 'Invalid OTP' });
    }

    const verifiedPhone = verification.phone;

    let user = await User.findOne({ phone: verifiedPhone });
    let isNewUser = false;

    if (user) {
      if (!user.isActive) {
        return res.status(403).json({ success: false, message: 'Account has been deactivated. Please contact support.' });
      }
      user.loginAttempts = 0;
      user.isLocked = false;
      user.lockedUntil = undefined;
      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });
    } else {
      isNewUser = true;
      const cleanCustomerName = cleanText(name || `Customer ${verifiedPhone.slice(-4)}`, 100);
      user = await User.create({
        name: cleanCustomerName,
        phone: verifiedPhone,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        addresses: []
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Welcome to Fresh Veggies!' : 'Welcome back!',
      isNewUser,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email || '',
        phone: user.phone,
        role: user.role,
        address: user.address,
        addresses: user.addresses || [],
        token
      }
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → verifyMsg91Otp');
  }
};

// @desc    Resend MSG91 SMS OTP
// @route   POST /api/auth/msg91/resend-otp
// @access  Public
exports.resendMsg91Otp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    const result = await msg91Service.resendOtp(phone);
    return res.status(200).json(result);
  } catch (error) {
    return serverError(res, error, 'authController.js → resendMsg91Otp');
  }
};

// @desc    Log out of every device by invalidating all existing tokens
// @route   POST /api/auth/logout
// @access  Private
//
// JWTs cannot be un-issued, so "logout" for a stateless API means bumping the
// user's tokenVersion: every token minted before this moment stops validating
// in middleware/auth.js. The client should still discard its own copy.
exports.logout = async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    res.status(200).json({
      success: true,
      message: 'Logged out. All existing sessions for this account have been ended.'
    });
  } catch (error) {
    console.error('❌ LOGOUT ERROR:', error.message);
    res.status(500).json({ success: false, message: 'Unable to log out right now. Please try again.' });
  }
};

// @desc    Add a new delivery address
// @route   POST /api/auth/addresses
// @access  Private
exports.addAddress = async (req, res) => {
  try {
    const { name, phone, street, city, state, pincode, country, isDefault } = req.body;
    if (!street || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: 'Street, city, state, and pincode are required.' });
    }

    const pinStr = pincode.toString().trim();
    if (!/^[1-9][0-9]{5}$/.test(pinStr)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 6-digit Indian PIN code.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.addresses) user.addresses = [];

    const isFirst = user.addresses.length === 0;
    const shouldBeDefault = isDefault === true || isFirst;

    if (shouldBeDefault) {
      user.addresses.forEach(addr => { addr.isDefault = false; });
    }

    const newAddress = {
      name: cleanText(name || user.name, 100),
      phone: cleanText(phone || user.phone, 20),
      street: cleanText(street, 200),
      city: cleanText(city, 100),
      state: cleanText(state, 100),
      pincode: cleanText(pinStr, 10),
      country: cleanText(country, 100) || 'India',
      isDefault: shouldBeDefault,
      createdAt: new Date()
    };

    user.addresses.push(newAddress);

    if (shouldBeDefault) {
      user.address = {
        street: newAddress.street,
        city: newAddress.city,
        state: newAddress.state,
        pincode: newAddress.pincode,
        country: newAddress.country
      };
    }

    await user.save();

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: user
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → addAddress');
  }
};

// @desc    Update a delivery address
// @route   PUT /api/auth/addresses/:addressId
// @access  Private
exports.updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { name, phone, street, city, state, pincode, country, isDefault } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const addr = user.addresses?.id(addressId);
    if (!addr) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    if (pincode !== undefined) {
      const pinStr = pincode.toString().trim();
      if (!/^[1-9][0-9]{5}$/.test(pinStr)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid 6-digit Indian PIN code.' });
      }
      addr.pincode = cleanText(pinStr, 10);
    }

    if (name !== undefined) addr.name = cleanText(name, 100);
    if (phone !== undefined) addr.phone = cleanText(phone, 20);
    if (street !== undefined) addr.street = cleanText(street, 200);
    if (city !== undefined) addr.city = cleanText(city, 100);
    if (state !== undefined) addr.state = cleanText(state, 100);
    if (country !== undefined) addr.country = cleanText(country, 100) || 'India';

    if (isDefault === true) {
      user.addresses.forEach(a => { a.isDefault = false; });
      addr.isDefault = true;
      user.address = {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
        country: addr.country
      };
    } else if (addr.isDefault && isDefault === false) {
      addr.isDefault = false;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: user
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → updateAddress');
  }
};

// @desc    Delete a delivery address
// @route   DELETE /api/auth/addresses/:addressId
// @access  Private
exports.deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const addr = user.addresses?.id(addressId);
    if (!addr) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    const wasDefault = addr.isDefault;
    user.addresses.pull(addressId);

    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
      user.address = {
        street: user.addresses[0].street,
        city: user.addresses[0].city,
        state: user.addresses[0].state,
        pincode: user.addresses[0].pincode,
        country: user.addresses[0].country
      };
    } else if (user.addresses.length === 0) {
      user.address = { street: '', city: '', state: '', pincode: '', country: 'India' };
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Address removed successfully',
      data: user
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → deleteAddress');
  }
};

// @desc    Set default delivery address
// @route   PUT /api/auth/addresses/:addressId/default
// @access  Private
exports.setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const addr = user.addresses?.id(addressId);
    if (!addr) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    user.addresses.forEach(a => { a.isDefault = false; });
    addr.isDefault = true;

    user.address = {
      street: addr.street,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
      country: addr.country
    };

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Default address updated',
      data: user
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → setDefaultAddress');
  }
};

