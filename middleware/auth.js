const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes - verify JWT token
exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized — no token provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const msg = err.name === 'TokenExpiredError'
        ? 'Session expired — please login again'
        : 'Invalid token — please login again';
      return res.status(401).json({ success: false, message: msg });
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated. Contact support.' });
    }

    // Reject tokens issued before the last password change / "log out
    // everywhere". Tokens minted before tokenVersion existed carry no `tv`
    // claim; treating a missing claim as 0 keeps them working for accounts that
    // have never changed a password, and revokes them the moment one does.
    if ((decoded.tv ?? 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({
        success: false,
        message: 'Session is no longer valid — please login again.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error in authentication' });
  }
};

// Admin only middleware
exports.admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
  }
};

// Optional auth - populates req.user if token is present and valid, does not block guests
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next();
    }

    const user = await User.findById(decoded.id).select('-password');
    if (user && user.isActive && (decoded.tv ?? 0) === (user.tokenVersion || 0)) {
      req.user = user;
    }
    next();
  } catch {
    next();
  }
};
