const express = require('express');
const router = express.Router();
const {
  getAllBanners,
  getActiveBanners,
  trackBannerClick,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners
} = require('../controllers/banner.controller');
const { protect, admin } = require('../middleware/auth.middleware');
const validateObjectId = require('../middleware/validate-object-id.middleware');

router.get('/admin', protect, admin, getAllBanners);
router.get('/active', getActiveBanners);
router.get('/', getActiveBanners);
router.post('/:id/click', validateObjectId, trackBannerClick);

router.post('/', protect, admin, createBanner);
router.put('/reorder', protect, admin, reorderBanners);
router.put('/:id', protect, admin, validateObjectId, updateBanner);
router.delete('/:id', protect, admin, validateObjectId, deleteBanner);

module.exports = router;
