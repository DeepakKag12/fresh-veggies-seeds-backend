const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory
} = require('../controllers/category.controller');
const { protect, admin } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.route('/')
  .get(getCategories)
  .post(protect, admin, createCategory);

router.route('/:id')
  .get(validateObjectId, getCategory)
  .put(protect, admin, validateObjectId, updateCategory)
  .delete(protect, admin, validateObjectId, deleteCategory);

module.exports = router;
