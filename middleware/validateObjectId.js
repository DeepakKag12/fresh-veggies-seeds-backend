const mongoose = require('mongoose');

/**
 * Express middleware — validates that a route param is a legal MongoDB ObjectId.
 *
 * Two usage modes (both backward-compatible):
 *
 *   // 1. Direct — checks req.params.id  (existing usage)
 *   router.get('/:id', validateObjectId, getOrder);
 *
 *   // 2. Factory — checks a custom param name
 *   router.get('/product/:productId', validateObjectId('productId'), getReviews);
 *
 * Returns 400 instead of letting Mongoose throw a CastError 500.
 */
const validateObjectId = (paramOrReq, res, next) => {
  // Factory mode: called as validateObjectId('paramName') → returns middleware
  if (typeof paramOrReq === 'string') {
    const param = paramOrReq;
    return (req, res, next) => {
      const id = req.params[param];
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid ID format' });
      }
      next();
    };
  }

  // Direct middleware mode: validateObjectId used without calling — checks req.params.id
  const id = paramOrReq.params.id;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid ID format' });
  }
  next();
};

module.exports = validateObjectId;
