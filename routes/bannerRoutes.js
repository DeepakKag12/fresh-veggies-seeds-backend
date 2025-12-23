const express = require('express');
const router = express.Router();
const {
  getAllBanners,
  getActiveBanners,
  trackBannerClick,
  createBanner,
  updateBanner,
  deleteBanner
} = require('../controllers/bannerController');
const { protect, admin } = require('../middleware/auth');

router.get('/admin', protect, admin, getAllBanners);
router.get('/active', getActiveBanners);
router.post('/:id/click', trackBannerClick);

router.post('/', protect, admin, createBanner);
router.put('/:id', protect, admin, updateBanner);
router.delete('/:id', protect, admin, deleteBanner);

module.exports = router;
