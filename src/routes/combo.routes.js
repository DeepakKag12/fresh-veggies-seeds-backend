const express = require('express');
const router = express.Router();
const {
  getCombos,
  getCombo,
  createCombo,
  updateCombo,
  deleteCombo
} = require('../controllers/combo.controller');
const { protect, admin } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.route('/')
  .get(getCombos)
  .post(protect, admin, createCombo);

router.route('/:id')
  .get(validateObjectId, getCombo)
  .put(protect, admin, validateObjectId, updateCombo)
  .delete(protect, admin, validateObjectId, deleteCombo);

module.exports = router;
