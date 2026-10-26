const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getFeaturedProducts,
  getSearchSuggestions,
  notifyStock,
  exportProductsCsv,
  importProductsCsv,
} = require('../controllers/product.controller');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');
const multer = require('multer');
const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB CSV limit
});

router.get('/featured', getFeaturedProducts);
router.get('/suggestions', getSearchSuggestions);
router.get('/export-csv', protect, admin, exportProductsCsv);
router.post('/import-csv', protect, admin, uploadCsv.any(), importProductsCsv);
router.post('/:id/notify-stock', validateObjectId, notifyStock);

router.route('/')
  .get(optionalAuth, getProducts)
  .post(protect, admin, createProduct);

router.route('/:id')
  .get(validateObjectId, getProduct)
  .put(protect, admin, validateObjectId, updateProduct)
  .delete(protect, admin, validateObjectId, deleteProduct);

module.exports = router;
