const express = require('express');
const router = express.Router();
const cloudinary = require('../config/cloudinary.config');
const upload = require('../config/multer.config');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');
const { serverError } = require('../utils/respond.util');
const rateLimit = require('express-rate-limit');

const chatUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many chat image uploads. Please try again later.' }
});

const reviewUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.user?._id ? req.user._id.toString() : 'anonymous'),
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many review image uploads. Please try again later.' }
});

// @desc    Upload in-app chat image attachment (Customer or Admin)
// @route   POST /api/upload/chat-image
// @access  Public / OptionalAuth (guest or user)
router.post('/chat-image', chatUploadLimiter, optionalAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please select an image file to upload.'
      });
    }

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'fresh-veggies/chat',
          resource_type: 'image',
          transformation: [{ quality: 'auto:good', fetch_format: 'auto' }]
        },
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
        publicId: result.public_id,
        fileType: 'image',
        fileName: req.file.originalname || 'image.jpg',
        fileSize: req.file.size || 0,
        width: result.width,
        height: result.height
      }
    });
  } catch (error) {
    return serverError(res, error, 'uploadRoutes.js → chat-image');
  }
});

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

// @desc    Admin banner image upload with Cloudinary auto-compression (FEAT-023)
// @route   POST /api/upload/banner
// @access  Private/Admin
router.post('/banner', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an image to upload.' });
    }

    const slot = req.body.slot || 'desktop';
    const transformation = [{ quality: 'auto', fetch_format: 'auto' }];

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'fresh-veggies/banners',
          resource_type: 'image',
          transformation
        },
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
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        slot
      }
    });
  } catch (error) {
    return serverError(res, error, 'uploadRoutes.js → banner');
  }
});

// @desc    Customer review photo upload
// @route   POST /api/upload/review-image
// @access  Private (any logged-in customer)
router.post('/review-image', protect, reviewUploadLimiter, upload.single('image'), async (req, res) => {
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

// @desc    Upload multiple images to Cloudinary (Admin Product Catalog FEAT-018)
// @route   POST /api/upload/multiple
// @access  Private/Admin
router.post('/multiple', protect, admin, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one image to upload' });
    }

    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: 'fresh-veggies', resource_type: 'image' },
          (error, result) => {
            if (error) reject(error);
            else resolve({ url: result.secure_url, publicId: result.public_id });
          }
        );
        uploadStream.end(file.buffer);
      });
    });

    const results = await Promise.all(uploadPromises);

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    return serverError(res, error, 'uploadRoutes.js → multiple');
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
