const express = require('express');
const router = express.Router();
const {
  getCombos,
  getCombo,
  createCombo,
  updateCombo,
  deleteCombo,
  dismissReview
} = require('../controllers/combo.controller');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.route('/')
  .get(optionalAuth, getCombos)
  .post(protect, admin, createCombo);

router.put('/:id/dismiss-review', protect, admin, validateObjectId, dismissReview);

router.route('/:id')
  .get(validateObjectId, optionalAuth, getCombo)
  .put(protect, admin, validateObjectId, updateCombo)
  .delete(protect, admin, validateObjectId, deleteCombo);

module.exports = router;
