const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getFeaturedProducts
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/auth');
const validateObjectId = require('../middleware/validateObjectId');

router.get('/featured', getFeaturedProducts);

router.route('/')
  .get(getProducts)
  .post(protect, admin, createProduct);

router.route('/:id')
  .get(validateObjectId, getProduct)
  .put(protect, admin, validateObjectId, updateProduct)
  .delete(protect, admin, validateObjectId, deleteProduct);

module.exports = router;
