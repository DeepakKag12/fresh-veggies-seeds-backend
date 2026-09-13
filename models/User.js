const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide name'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Please provide phone number'],
    unique: true
  },
  email: {
    type: String,
    required: [true, 'Please provide email'],
    unique: true,
    lowercase: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  password: {
    type: String,
    required: [true, 'Please provide password'],
    minlength: 6,
    select: false
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  addresses: [{
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, default: 'India', trim: true },
    isDefault: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  cart: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  role: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'customer'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Password Recovery Fields
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Mobile Login Fields
  otpToken: String,
  otpExpires: Date,
  otpAttempts: {
    type: Number,
    default: 0
  },
  
  // Security Fields
  loginAttempts: {
    type: Number,
    default: 0
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  lockedUntil: Date,
  lastLogin: Date,
  lastLoginIp: String,

  // Bumped whenever every existing session must be invalidated: a password
  // change, a password reset, or an explicit "log out everywhere".
  //
  // JWTs are stateless, so before this a stolen token stayed valid for its full
  // 7-day life even after the victim reset their password — the reset did
  // nothing to lock the attacker out. The token now carries the version it was
  // issued at and `protect` rejects any token issued before the current one.
  tokenVersion: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// ─── Indexes ─────────────────────────────────────────────────────────────────
// email and phone already get unique indexes from their field definitions.
// These cover the remaining real query shapes.
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ resetPasswordToken: 1 });
userSchema.index({ emailVerificationToken: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  // Any password change invalidates every token issued before it. Doing this in
  // the hook rather than at each call site means no future password-changing
  // path can forget to revoke old sessions.
  if (!this.isNew) {
    this.tokenVersion = (this.tokenVersion || 0) + 1;
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate Password Reset Token
userSchema.methods.generatePasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.resetPasswordExpires = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
  return resetToken;
};

// Generate OTP for mobile login
userSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  this.otpToken = crypto
    .createHash('sha256')
    .update(otp)
    .digest('hex');
  this.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  this.otpAttempts = 0;
  return otp;
};

// Method to increment login attempts
userSchema.methods.incrementLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.isLocked && this.lockedUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { isLocked: 1, lockedUntil: 1 }
    });
  }
  // Otherwise we're incrementing
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock the account after 5 attempts for 1 hour
  const maxAttempts = 5;
  const lockTimeMinutes = 60;
  
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = {
      isLocked: true,
      lockedUntil: new Date(Date.now() + lockTimeMinutes * 60 * 1000)
    };
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { 
      loginAttempts: 0,
      lastLogin: new Date()
    },
    $unset: { isLocked: 1, lockedUntil: 1 }
  });
};

module.exports = mongoose.model('User', userSchema);
