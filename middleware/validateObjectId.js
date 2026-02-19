const mongoose = require('mongoose');

/**
 * Express middleware — validates that req.params.id is a legal MongoDB ObjectId.
 * Attach to any route using /:id before the controller handler:
 *
 *   router.get('/:id', validateObjectId, getOrder);
 *
 * Returns 400 instead of letting Mongoose throw a CastError 500.
 */
const validateObjectId = (req, res, next) => {
  const id = req.params.id;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid ID format' });
  }
  next();
};

module.exports = validateObjectId;
