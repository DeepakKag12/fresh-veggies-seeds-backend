const multer = require('multer');
const ApiError = require('../utils/ApiError');

/**
 * 404 handler for unmatched routes.
 * Without this an unknown path fell through to Express's HTML error page,
 * breaking clients that always expect JSON.
 */
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
};

/**
 * Central error handler.
 *
 * Translates the error types this app actually produces into correct status
 * codes and customer-safe messages:
 *
 *   CastError        → 400  (a malformed ObjectId reached a query)
 *   ValidationError  → 400  (Mongoose schema validation, field names included)
 *   E11000           → 409  (unique index violation — the race that two
 *                            check-then-insert callers lose)
 *   JWT errors       → 401
 *   Multer errors    → 400  (file too large / wrong type)
 *   ApiError         → its own status
 *   anything else    → 500, generic message, details only in the server log
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message    = err.message || 'Internal server error';

  // ── Mongoose: malformed ObjectId ──────────────────────────────────────────
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for "${err.path}".`;
  }

  // ── Mongoose: schema validation ───────────────────────────────────────────
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(' ');
  }

  // ── MongoDB: duplicate key on a unique index ──────────────────────────────
  else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    message = field
      ? `An account with this ${field} already exists.`
      : 'That value is already taken.';
  }

  // ── JWT ───────────────────────────────────────────────────────────────────
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token — please login again.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Session expired — please login again.';
  }

  // ── Multer upload errors ──────────────────────────────────────────────────
  else if (err instanceof multer.MulterError) {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Image is too large. Maximum size is 5MB.'
      : `Upload error: ${err.message}`;
  }

  // ── Unexpected: log it in full, tell the client nothing ───────────────────
  // Anything not flagged operational is a bug. Echoing err.message here is how
  // Mongo connection strings and stack details end up in customer-facing JSON.
  if (statusCode === 500 && !err.isOperational) {
    console.error('❌ Unhandled error:', {
      method: req.method,
      url: req.originalUrl,
      message: err.message,
      stack: err.stack
    });
    message = 'Something went wrong. Please try again.';
  }

  res.status(statusCode).json({ success: false, message });
};

module.exports = { notFound, errorHandler };
