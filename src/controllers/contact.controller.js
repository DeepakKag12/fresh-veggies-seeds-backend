const Contact = require('../models/contact.model');

/**
 * @desc    Submit customer contact inquiry
 * @route   POST /api/contact
 * @access  Public
 */
exports.submitContactInquiry = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !name.trim() || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your full name (at least 2 characters).'
      });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    if (!message || message.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a message explaining your inquiry (at least 10 characters).'
      });
    }

    // Clean phone if provided
    let cleanPhone = '';
    if (phone) {
      cleanPhone = phone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length > 0 && (cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone))) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid 10-digit mobile number or leave it blank.'
        });
      }
    }

    const inquiry = await Contact.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: cleanPhone,
      subject: subject && subject.trim() ? subject.trim() : 'General Inquiry',
      message: message.trim(),
      ipAddress: req.ip || req.headers['x-forwarded-for'] || ''
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been received. Our gardening support team will contact you shortly.',
      data: {
        id: inquiry._id,
        createdAt: inquiry.createdAt
      }
    });
  } catch (error) {
    console.error('Contact inquiry error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit your message. Please try again or reach out on WhatsApp.'
    });
  }
};

/**
 * @desc    Get all contact inquiries (Admin only)
 * @route   GET /api/contact
 * @access  Private/Admin
 */
exports.getContactInquiries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status && ['new', 'read', 'replied', 'archived'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [inquiries, total] = await Promise.all([
      Contact.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Contact.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      data: inquiries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get contact inquiries error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve inquiries.'
    });
  }
};

/**
 * @desc    Update inquiry status (Admin only)
 * @route   PATCH /api/contact/:id
 * @access  Private/Admin
 */
exports.updateInquiryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'read', 'replied', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value.'
      });
    }

    const inquiry = await Contact.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found.'
      });
    }

    return res.status(200).json({
      success: true,
      data: inquiry
    });
  } catch (error) {
    console.error('Update inquiry status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update inquiry status.'
    });
  }
};
