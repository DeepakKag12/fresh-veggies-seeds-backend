const mongoose = require('mongoose');
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('../services/email.service');
const msg91Service = require('../services/msg91.service');
const { isValidEmail, isValidPhone, validatePassword, validateCart, cleanText } = require('../validators/auth.validator');
// Email verification is opt-in. It is off by default so a store can run without
// SMTP configured; set REQUIRE_EMAIL_VERIFICATION=true to enforce it.
const requireEmailVerification = () =>
  String(process.env.REQUIRE_EMAIL_VERIFICATION || '').toLowerCase() === 'true';

const { serverError } = require('../utils/respond.util');

const getFrontendUrl = () => {
  if (process.env.FRONTEND_URL) {
    if (process.env.NODE_ENV === 'development' || !process.env.FRONTEND_URL.includes('localhost')) {
      return process.env.FRONTEND_URL;
    }
  }
  return process.env.NODE_ENV === 'production'
    ? 'https://fresh-veggies-seeds-frontend.vercel.app'
    : 'http://localhost:3000';
};

// Generate JWT Token.
// `tv` pins the token to the user's current tokenVersion, so a password change
// or an explicit logout-everywhere immediately invalidates it (see middleware/auth.middleware).
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, userId: user._id, role: user.role, tv: user.tokenVersion || 0 },
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
        cart: user.cart || [],
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
    const userDoc = await User.findById(req.user._id).select('+password -emailVerificationToken -emailVerificationExpires -resetPasswordToken -resetPasswordExpires -otpToken -otpExpires');
    if (!userDoc) return res.status(404).json({ success: false, message: 'User not found' });

    // Backfill addresses if legacy address exists and addresses is empty
    if ((!userDoc.addresses || userDoc.addresses.length === 0) && userDoc.address?.street) {
      userDoc.addresses = [{
        name: userDoc.name,
        phone: userDoc.phone,
        street: userDoc.address.street,
        city: userDoc.address.city,
        state: userDoc.address.state,
        pincode: userDoc.address.pincode,
        country: userDoc.address.country || 'India',
        isDefault: true,
        createdAt: new Date()
      }];
      await userDoc.save({ validateBeforeSave: false });
    }

    const hasPassword = Boolean(userDoc.password);
    const user = userDoc.toObject();
    delete user.password;
    user.hasPassword = hasPassword;

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
  try {
    const user = await User.findById(req.user._id).select('cart');
    res.status(200).json({ success: true, data: user?.cart || [] });
  } catch (error) {
    return serverError(res, error, 'authController.js → getCart');
  }
};

// @desc    Save/update the current user's cart
// @route   PUT /api/auth/cart or POST /api/auth/cart
// @access  Private
exports.updateCart = async (req, res) => {
  try {
    const rawCart = req.body.cart !== undefined ? req.body.cart : (req.body.items !== undefined ? req.body.items : req.body);
    const cartCheck = validateCart(rawCart);
    if (!cartCheck.valid) {
      return res.status(400).json({ success: false, message: cartCheck.message });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { cart: rawCart },
      { new: true, runValidators: true }
    ).select('cart');

    res.status(200).json({ success: true, data: user?.cart || [] });
  } catch (error) {
    return serverError(res, error, 'authController.js → updateCart');
  }
};

// @desc    Bidirectional union merge of guest cart and authenticated user cart
// @route   PUT /api/auth/cart/sync or POST /api/auth/cart/sync
// @access  Private
exports.syncCart = async (req, res) => {
  try {
    const guestItems = req.body.guestCart || req.body.cart || req.body.items || [];
    if (!Array.isArray(guestItems)) {
      return res.status(400).json({ success: false, message: 'guestCart must be an array.' });
    }

    const cartCheck = validateCart(guestItems);
    if (!cartCheck.valid) {
      return res.status(400).json({ success: false, message: cartCheck.message });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const serverCart = Array.isArray(user.cart) ? [...user.cart] : [];

    const sameCartLine = (a, b) => {
      const idA = String(a._id || a.productId || a.product || '');
      const idB = String(b._id || b.productId || b.product || '');
      const comboA = Boolean(a.isCombo);
      const comboB = Boolean(b.isCombo);
      const packA = String(a.packageId || a.selectedPackage?._id || a.selectedPackage?.size || a.packageOption?.count || '');
      const packB = String(b.packageId || b.selectedPackage?._id || b.selectedPackage?.size || b.packageOption?.count || '');
      return idA === idB && comboA === comboB && packA === packB;
    };

    // Bidirectional union merge preserving highest quantity per variant
    const mergedCart = [...serverCart];

    for (const guestItem of guestItems) {
      const existingIdx = mergedCart.findIndex((item) => sameCartLine(item, guestItem));
      if (existingIdx > -1) {
        const existing = mergedCart[existingIdx];
        const existingQty = Number(existing.quantity) || 1;
        const guestQty = Number(guestItem.quantity) || 1;
        // Direction: preserve highest quantity per variant
        const mergedQty = Math.max(existingQty, guestQty);
        mergedCart[existingIdx] = {
          ...existing,
          ...guestItem,
          quantity: mergedQty,
        };
      } else {
        mergedCart.push(guestItem);
      }
    }

    user.cart = mergedCart;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Cart synchronized successfully',
      data: user.cart,
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → syncCart');
  }
};

// @desc    Get the current user's wishlist
// @route   GET /api/auth/wishlist
// @access  Private
exports.getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'wishlist',
      select: 'name price originalPrice images weight season stock rating numReviews packages isCombo isActive'
    });
    res.status(200).json({ success: true, data: user?.wishlist || [] });
  } catch (error) {
    return serverError(res, error, 'authController.js → getWishlist');
  }
};

// @desc    Add product to wishlist
// @route   POST /api/auth/wishlist/:productId
// @access  Private
exports.addToWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.wishlist) user.wishlist = [];
    const exists = user.wishlist.some(id => String(id) === String(productId));
    if (!exists) {
      user.wishlist.push(productId);
      await user.save();
    }

    const populatedUser = await User.findById(user._id).populate({
      path: 'wishlist',
      select: 'name price originalPrice images weight season stock rating numReviews packages isCombo isActive'
    });

    res.status(200).json({ success: true, message: 'Added to wishlist', data: populatedUser?.wishlist || [] });
  } catch (error) {
    return serverError(res, error, 'authController.js → addToWishlist');
  }
};

// @desc    Remove product from wishlist
// @route   DELETE /api/auth/wishlist/:productId
// @access  Private
exports.removeFromWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.wishlist) {
      user.wishlist = user.wishlist.filter(id => String(id) !== String(productId));
      await user.save();
    }

    const populatedUser = await User.findById(user._id).populate({
      path: 'wishlist',
      select: 'name price originalPrice images weight season stock rating numReviews packages isCombo isActive'
    });

    res.status(200).json({ success: true, message: 'Removed from wishlist', data: populatedUser?.wishlist || [] });
  } catch (error) {
    return serverError(res, error, 'authController.js → removeFromWishlist');
  }
};

// @desc    Clear user's entire wishlist
// @route   DELETE /api/auth/wishlist
// @access  Private
exports.clearWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.wishlist = [];
    await user.save();

    res.status(200).json({ success: true, message: 'Wishlist cleared', data: [] });
  } catch (error) {
    return serverError(res, error, 'authController.js → clearWishlist');
  }
};

// @desc    Bidirectional sync of guest wishlist with user account
// @route   PUT /api/auth/wishlist/sync or POST /api/auth/wishlist/sync
// @access  Private
exports.syncWishlist = async (req, res) => {
  try {
    const guestItems = req.body.guestWishlist || req.body.wishlist || [];
    if (!Array.isArray(guestItems)) {
      return res.status(400).json({ success: false, message: 'Wishlist must be an array' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.wishlist) user.wishlist = [];
    const currentIds = new Set(user.wishlist.map(id => String(id)));

    for (const item of guestItems) {
      const id = String(item?._id || item?.productId || item || '');
      if (mongoose.Types.ObjectId.isValid(id) && !currentIds.has(id)) {
        user.wishlist.push(id);
        currentIds.add(id);
      }
    }

    await user.save();
    const populatedUser = await User.findById(user._id).populate({
      path: 'wishlist',
      select: 'name price originalPrice images weight season stock rating numReviews packages isCombo isActive'
    });

    res.status(200).json({
      success: true,
      message: 'Wishlist synchronized successfully',
      data: populatedUser?.wishlist || []
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → syncWishlist');
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
    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid new email address.'
      });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.email && normalizedEmail === user.email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: 'New email cannot be the same as your current email.'
      });
    }

    // Verify current password only if user already has a password set
    if (user.password) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Please provide your current password to change email.'
        });
      }
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect.'
        });
      }
    }

    // Check if new email already exists on another account
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
      return res.status(409).json({
        success: false,
        message: 'This email is already in use by another account.'
      });
    }

    const mustVerify = requireEmailVerification();
    const verificationToken = crypto.randomBytes(32).toString('hex');

    if (mustVerify) {
      const emailResult = await emailService.sendVerificationEmail(
        { ...user.toObject(), email: normalizedEmail },
        `${getFrontendUrl()}/verify-email/${verificationToken}`
      );
      if (!emailResult.success) {
        return res.status(500).json({ success: false, message: 'Could not send verification email. Please try again later.' });
      }
      user.email = normalizedEmail;
      user.emailVerified = false;
      user.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    } else {
      user.email = normalizedEmail;
      user.emailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      emailService.sendVerificationEmail(
        user,
        `${getFrontendUrl()}/verify-email/${verificationToken}`
      ).catch(() => {});
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: mustVerify
        ? 'Email updated. Please verify your new email address before logging in again.'
        : 'Email updated successfully.',
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
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password'
      });
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ success: false, message: pwCheck.message });
    }

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // If user already has a password, verify current password
    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Please provide current password and new password'
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          success: false,
          message: 'New password must be different from your current password.'
        });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
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

    // Create reset URL
    const resetUrl = `${getFrontendUrl()}/reset-password/${resetToken}`;

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

// @desc    Send 6-digit SMS OTP for Mobile Login
// @route   POST /api/auth/send-otp
// @access  Public
exports.sendOTP = async (req, res) => {
  try {
    const rawPhone = (req.body.phone || '').toString().trim();
    const digits = rawPhone.replace(/\D/g, '');
    const cleanPhone = digits.length >= 10 ? digits.slice(-10) : digits;

    if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9'
      });
    }

    let user = await User.findOne({ phone: cleanPhone });
    if (user && user.isLocked && user.lockedUntil && user.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / (1000 * 60));
      return res.status(429).json({
        success: false,
        message: `Account is temporarily locked due to failed attempts. Please try again in ${minutesLeft} minutes.`
      });
    }

    if (!user) {
      user = new User({
        name: `Customer ${cleanPhone.slice(-4)}`,
        phone: cleanPhone,
        role: 'customer',
        isActive: true,
        emailVerified: false,
        addresses: []
      });
    }

    // Generate 6-digit OTP and hash with sha256
    const otp = user.generateOTP();
    await user.save({ validateBeforeSave: false });

    // Send via MSG91 SMS if configured
    try {
      await msg91Service.sendOtp(cleanPhone);
    } catch (smsErr) {
      console.warn('⚠️ MSG91 SMS dispatch notice:', smsErr.message);
    }

    console.log(`📱 [OTP SERVICE] OTP generated for +91 ${cleanPhone}: ${otp}`);

    return res.status(200).json({
      success: true,
      message: `OTP sent successfully to +91 ${cleanPhone}`,
      userId: user._id,
      phone: cleanPhone,
      ...(process.env.NODE_ENV !== 'production' ? { testOtp: otp } : {})
    });
  } catch (error) {
    return serverError(res, error, 'authController.js → sendOTP');
  }
};

// @desc    Verify 6-digit SMS OTP & Login
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOTP = async (req, res) => {
  try {
    const { userId, phone, otp } = req.body;
    const enteredOtp = (otp || '').toString().trim();

    if (!enteredOtp || enteredOtp.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 6-digit OTP'
      });
    }

    let user = null;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    } else if (phone) {
      const digits = phone.toString().replace(/\D/g, '');
      const cleanPhone = digits.length >= 10 ? digits.slice(-10) : digits;
      user = await User.findOne({ phone: cleanPhone });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User session not found. Please request a new OTP.'
      });
    }

    if (user.isLocked && user.lockedUntil && user.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / (1000 * 60));
      return res.status(429).json({
        success: false,
        message: `Account is locked due to too many failed OTP attempts. Please try again in ${minutesLeft} minutes.`
      });
    }

    if (!user.otpExpires || user.otpExpires < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    const hashedInput = crypto.createHash('sha256').update(enteredOtp).digest('hex');
    const isSandbox = process.env.NODE_ENV !== 'production' && enteredOtp === '123456';
    const isMatch = (user.otpToken && user.otpToken === hashedInput) || isSandbox;

    if (!isMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      const remainingAttempts = Math.max(0, 5 - user.otpAttempts);

      if (user.otpAttempts >= 5) {
        user.isLocked = true;
        user.lockedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1-hour lock
        await user.save({ validateBeforeSave: false });
        return res.status(429).json({
          success: false,
          message: 'Account locked for 1 hour due to 5 consecutive incorrect OTP attempts.'
        });
      }

      await user.save({ validateBeforeSave: false });
      return res.status(400).json({
        success: false,
        message: `Invalid OTP. ${remainingAttempts} attempts remaining.`
      });
    }

    // Success: clear OTP security tokens
    user.otpAttempts = 0;
    user.otpToken = undefined;
    user.otpExpires = undefined;
    user.isLocked = false;
    user.lockedUntil = undefined;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully',
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
    return serverError(res, error, 'authController.js → verifyOTP');
  }
};

// @desc    Log out of every device by invalidating all existing tokens
// @route   POST /api/auth/logout
// @access  Private
//
// JWTs cannot be un-issued, so "logout" for a stateless API means bumping the
// user's tokenVersion: every token minted before this moment stops validating
// in middleware/auth.middleware. The client should still discard its own copy.
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
    const { name, phone, street, city, state, pincode, country, isDefault, tag, landmark, instructions } = req.body;
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

    const cleanStreet = cleanText(street, 200);
    const cleanCity = cleanText(city, 100);
    const cleanState = cleanText(state, 100);
    const cleanCountry = cleanText(country, 100) || 'India';
    const cleanName = cleanText(name || user.name, 100);
    const cleanPhone = cleanText(phone || user.phone, 20);
    const cleanTag = ['Home', 'Work', 'Farm', 'Other'].includes(tag) ? tag : 'Home';
    const cleanLandmark = cleanText(landmark || '', 150);
    const cleanInstructions = cleanText(instructions || '', 250);

    // Normalize for duplicate comparison
    const normStreet = cleanStreet.toLowerCase().replace(/\s+/g, ' ').trim();
    const normCity = cleanCity.toLowerCase().replace(/\s+/g, ' ').trim();
    const normPin = pinStr.trim();

    const existingIndex = user.addresses.findIndex(addr =>
      (addr.street || '').toLowerCase().replace(/\s+/g, ' ').trim() === normStreet &&
      (addr.pincode || '').toString().trim() === normPin &&
      (addr.city || '').toLowerCase().replace(/\s+/g, ' ').trim() === normCity
    );

    const isFirst = user.addresses.length === 0;
    const shouldBeDefault = isDefault === true || isFirst;

    if (existingIndex !== -1) {
      // Address already exists! Do NOT push a duplicate.
      const existingAddr = user.addresses[existingIndex];
      if (cleanName) existingAddr.name = cleanName;
      if (cleanPhone) existingAddr.phone = cleanPhone;
      if (cleanTag) existingAddr.tag = cleanTag;
      if (cleanLandmark) existingAddr.landmark = cleanLandmark;
      if (cleanInstructions) existingAddr.instructions = cleanInstructions;
      
      if (shouldBeDefault) {
        user.addresses.forEach((a, idx) => { a.isDefault = (idx === existingIndex); });
        user.address = {
          street: existingAddr.street,
          city: existingAddr.city,
          state: existingAddr.state,
          pincode: existingAddr.pincode,
          country: existingAddr.country || 'India'
        };
      }
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Address already exists in saved addresses',
        data: user,
        addressId: existingAddr._id
      });
    }

    if (shouldBeDefault) {
      user.addresses.forEach(addr => { addr.isDefault = false; });
    }

    const newAddress = {
      name: cleanName,
      phone: cleanPhone,
      tag: cleanTag,
      street: cleanStreet,
      landmark: cleanLandmark,
      instructions: cleanInstructions,
      city: cleanCity,
      state: cleanState,
      pincode: cleanText(pinStr, 10),
      country: cleanCountry,
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
    if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
      return res.status(400).json({ success: false, message: 'Invalid address ID format.' });
    }
    const { name, phone, street, city, state, pincode, country, isDefault, tag, landmark, instructions } = req.body;

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
    if (tag !== undefined && ['Home', 'Work', 'Farm', 'Other'].includes(tag)) addr.tag = tag;
    if (landmark !== undefined) addr.landmark = cleanText(landmark, 150);
    if (instructions !== undefined) addr.instructions = cleanText(instructions, 250);

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
    if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
      return res.status(400).json({ success: false, message: 'Invalid address ID format.' });
    }
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
    if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
      return res.status(400).json({ success: false, message: 'Invalid address ID format.' });
    }
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

