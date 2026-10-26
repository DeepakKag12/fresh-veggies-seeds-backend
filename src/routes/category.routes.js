const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories
} = require('../controllers/category.controller');
const { protect, admin } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.route('/')
  .get(getCategories)
  .post(protect, admin, createCategory);

router.put('/reorder', protect, admin, reorderCategories);

router.route('/:id')
  .get(validateObjectId, getCategory)
  .put(protect, admin, validateObjectId, updateCategory)
  .delete(protect, admin, validateObjectId, deleteCategory);

module.exports = router;
