/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * middleware instead of hanging the request.
 *
 * Every controller previously carried its own try/catch that ended in
 * `res.status(500).json({ message: error.message })` — which both duplicated
 * the same eight lines everywhere and leaked Mongoose/Mongo internals to the
 * client. Handlers can now throw and let the central handler decide.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
