const express = require('express');
const router = express.Router();
const cloudinary = require('../config/cloudinary.config');
const upload = require('../config/multer.config');
const { protect, admin } = require('../middleware/auth.middleware');
const { serverError } = require('../utils/respond.util');

// @desc    Upload image to Cloudinary
// @route   POST /api/upload
// @access  Private/Admin
router.post('/', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image'
      });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'fresh-veggies',
          resource_type: 'image'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.status(200).json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    return serverError(res, error, 'uploadRoutes.js → handler');
  }
});

// @desc    Customer review photo upload
// @route   POST /api/upload/review-image
// @access  Private (any logged-in customer)
router.post('/review-image', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an image to upload.' });
    }

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'fresh-veggies/reviews', resource_type: 'image' },
        (error, uploadRes) => {
          if (error) reject(error);
          else resolve(uploadRes);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.status(200).json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    return serverError(res, error, 'uploadRoutes.js → review-image');
  }
});

// @desc    Delete image from Cloudinary
// @route   DELETE /api/upload/:publicId
// @access  Private/Admin
router.delete('/:publicId', protect, admin, async (req, res) => {
  try {
    const publicId = req.params.publicId.replace(/--/g, '/');
    await cloudinary.uploader.destroy(publicId);

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    return serverError(res, error, 'uploadRoutes.js → handler');
  }
});

module.exports = router;
