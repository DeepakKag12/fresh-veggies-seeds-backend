const express = require('express');
const router = express.Router();
const {
  getCombos,
  getCombo,
  createCombo,
  updateCombo,
  deleteCombo
} = require('../controllers/comboController');
const { protect, admin } = require('../middleware/auth');

router.route('/')
  .get(getCombos)
  .post(protect, admin, createCombo);

router.route('/:id')
  .get(getCombo)
  .put(protect, admin, updateCombo)
  .delete(protect, admin, deleteCombo);

module.exports = router;
