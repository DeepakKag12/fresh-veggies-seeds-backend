/**
 * Operational error carrying an HTTP status code.
 *
 * Distinguishes errors we *meant* to produce ("Coupon has expired", 400) from
 * genuine bugs. The global handler reports the former to the client verbatim
 * and hides the latter behind a generic message, so a stack trace or a Mongo
 * internal never reaches a customer.
 */
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg)   { return new ApiError(400, msg); }
  static unauthorized(msg) { return new ApiError(401, msg); }
  static forbidden(msg)    { return new ApiError(403, msg); }
  static notFound(msg)     { return new ApiError(404, msg); }
  static conflict(msg)     { return new ApiError(409, msg); }
}

module.exports = ApiError;
