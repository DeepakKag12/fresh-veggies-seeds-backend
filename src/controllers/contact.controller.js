const Contact = require('../models/contact.model');
const Conversation = require('../models/conversation.model');
const ChatMessage = require('../models/chat-message.model');
const { getIO } = require('../socket');

/**
 * @desc    Submit customer contact inquiry
 * @route   POST /api/contact
 * @access  Public
 */
exports.submitContactInquiry = async (req, res) => {
  try {
    const { name, email, phone, subject, message, guestId } = req.body;

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

    // 1. Create persistent Contact ticket
    const inquiry = await Contact.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: cleanPhone,
      subject: subject && subject.trim() ? subject.trim() : 'General Inquiry',
      message: message.trim(),
      ipAddress: req.ip || req.headers['x-forwarded-for'] || ''
    });

    // 2. Direct-to-Chat Bridge: Automatically route message to Live Chat Section (/admin/communication)
    let conv = null;
    const userId = req.user?._id;
    const effectiveGuestId = guestId || req.headers['x-guest-id'] || null;

    if (userId) {
      conv = await Conversation.findOne({ customerId: userId, status: { $ne: 'archived' } });
    }
    if (!conv && cleanPhone) {
      conv = await Conversation.findOne({ customerPhone: cleanPhone, status: { $ne: 'archived' } });
    }
    if (!conv && effectiveGuestId) {
      conv = await Conversation.findOne({ guestId: effectiveGuestId, status: { $ne: 'archived' } });
    }

    if (!conv) {
      conv = await Conversation.create({
        customerId: userId || null,
        guestId: effectiveGuestId,
        customerName: name.trim(),
        customerEmail: email.trim().toLowerCase(),
        customerPhone: cleanPhone || '',
        unreadAdminCount: 0,
        unreadCustomerCount: 0
      });
    } else {
      if (!conv.customerName || conv.customerName === 'Guest Shopper') conv.customerName = name.trim();
      if (!conv.customerEmail) conv.customerEmail = email.trim().toLowerCase();
      if (!conv.customerPhone && cleanPhone) conv.customerPhone = cleanPhone;
      if (userId && !conv.customerId) conv.customerId = userId;
    }

    const subjectLabel = subject && subject.trim() ? subject.trim() : 'General Inquiry';
    const chatText = `[Contact Inquiry: ${subjectLabel}]\n${message.trim()}`;

    const chatMsg = await ChatMessage.create({
      conversationId: conv._id,
      sender: 'customer',
      senderId: userId || null,
      senderName: name.trim(),
      text: chatText,
      status: 'sent'
    });

    conv.lastMessage = {
      text: chatText,
      sender: 'customer',
      createdAt: chatMsg.createdAt,
      status: 'sent'
    };
    conv.unreadAdminCount = (conv.unreadAdminCount || 0) + 1;
    await conv.save();

    // 3. Real-time broadcast to Admin Messages & Live Chat Console
    try {
      const io = getIO();
      if (io) {
        io.to('admin:all').emit('message:received', chatMsg);
        io.to('admin:all').emit('conversation:updated', { conversation: conv.toObject() });
        io.to(`conversation:${conv._id}`).emit('message:received', chatMsg);
      }
    } catch (socketErr) {
      // Non-fatal if socket server is unavailable
    }

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been sent directly to our live chat support team.',
      data: {
        id: inquiry._id,
        conversationId: conv._id,
        createdAt: inquiry.createdAt
      }
    });
  } catch (error) {
    console.error('Contact inquiry error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit your message. Please try again or use our In-App Live Chat.'
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
    const { status, adminNotes } = req.body;
    const update = {};

    if (status !== undefined) {
      if (!['new', 'read', 'replied', 'archived', 'pending', 'resolved'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status value.'
        });
      }
      update.status = status;
    }

    if (adminNotes !== undefined) {
      update.adminNotes = String(adminNotes).trim();
    }

    const inquiry = await Contact.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
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
