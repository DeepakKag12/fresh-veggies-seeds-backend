const mongoose = require('mongoose');
const Conversation = require('../models/conversation.model');
const ChatMessage = require('../models/chat-message.model');
const Order = require('../models/order.model');
const { getIO } = require('../socket');
const {
  sanitizeText,
  validateCustomerContact,
  issueGuestCapability,
  verifyGuestCapability,
  canAccessConversation
} = require('../utils/chat-security.util');

const getGuestCapability = (req) => req.headers['x-guest-capability'] || req.body?.guestCapability || req.query?.guestCapability;

/**
 * Customer: Get or initialize own active conversation
 * Supports logged-in user or guest with guestId
 */
exports.getMyConversation = async (req, res) => {
  try {
    const userId = req.user?._id;
    const guestId = req.query.guestId;
    const guestCapability = getGuestCapability(req);

    if (!userId && !guestId) {
      return res.status(400).json({ success: false, message: 'User ID or Guest ID required' });
    }
    if (!userId && !/^guest_[a-f0-9]{32}$/i.test(guestId)) {
      return res.status(400).json({ success: false, message: 'Invalid guest chat identity' });
    }

    let conversation = null;
    if (userId) {
      conversation = await Conversation.findOne({ customerId: userId, status: { $ne: 'archived' } });
    } else {
      conversation = await Conversation.findOne({ guestId, status: { $ne: 'archived' } });
      if (conversation && !verifyGuestCapability(guestId, guestCapability)) {
        const contactCheck = validateCustomerContact({
          name: req.query.customerName,
          phone: req.query.customerPhone
        });
        if (!contactCheck.valid || conversation.customerPhone !== contactCheck.cleanPhone) {
          return res.status(403).json({ success: false, message: 'Guest chat capability required' });
        }
      }
    }

    if (!conversation) {
      // Create empty placeholder conversation
      conversation = await Conversation.create({
        customerId: userId || null,
        guestId: guestId || null,
        customerName: req.user?.name || req.query.customerName || 'Guest Shopper',
        customerEmail: req.user?.email || req.query.customerEmail || '',
        customerPhone: req.user?.phone || req.query.customerPhone || '',
        unreadAdminCount: 0,
        unreadCustomerCount: 0
      });
    }

    res.status(200).json({
      success: true,
      conversation,
      guestCapability: !userId ? issueGuestCapability(guestId) : undefined
    });
  } catch (error) {
    console.error('Error in getMyConversation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Customer / Storefront: Initialize or update conversation contact details & order context
 */
exports.initConversation = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { guestId, customerName, customerEmail, customerPhone, orderContext } = req.body;
    const guestCapability = getGuestCapability(req);

    if (!userId && !guestId) {
      return res.status(400).json({ success: false, message: 'Identity required (user or guestId)' });
    }
    if (!userId && !/^guest_[a-f0-9]{32}$/i.test(guestId)) {
      return res.status(400).json({ success: false, message: 'Invalid guest chat identity' });
    }

    let conversation = null;
    if (userId) {
      conversation = await Conversation.findOne({ customerId: userId, status: { $ne: 'archived' } });
    } else {
      conversation = await Conversation.findOne({ guestId, status: { $ne: 'archived' } });
      if (conversation && !verifyGuestCapability(guestId, guestCapability)) {
        return res.status(403).json({ success: false, message: 'Guest chat capability required' });
      }
    }

    // For guests, validate compulsory Name and 10-digit mobile number
    if (!userId) {
      const contactCheck = validateCustomerContact({ name: customerName, phone: customerPhone });
      if (!contactCheck.valid) {
        return res.status(400).json({ success: false, message: contactCheck.error, requiresContact: true });
      }

      if (!conversation) {
        conversation = new Conversation({
          customerId: null,
          guestId,
          customerName: contactCheck.cleanName,
          customerPhone: contactCheck.cleanPhone,
          customerEmail: customerEmail ? sanitizeText(customerEmail, 100) : '',
          orderContext: orderContext || null
        });
      } else {
        conversation.customerName = contactCheck.cleanName;
        conversation.customerPhone = contactCheck.cleanPhone;
        if (customerEmail) conversation.customerEmail = sanitizeText(customerEmail, 100);
        if (orderContext) conversation.orderContext = orderContext;
      }
    } else {
      if (!conversation) {
        conversation = new Conversation({
          customerId: userId,
          guestId: guestId || null,
          customerName: req.user?.name || customerName || 'Shopper',
          customerEmail: req.user?.email || customerEmail || '',
          customerPhone: req.user?.phone || customerPhone || '',
          orderContext: orderContext || null
        });
      } else {
        if (customerName) conversation.customerName = sanitizeText(customerName, 100);
        if (customerEmail) conversation.customerEmail = sanitizeText(customerEmail, 100);
        if (customerPhone) conversation.customerPhone = customerPhone;
        if (orderContext) conversation.orderContext = orderContext;
      }
    }

    await conversation.save();

    res.status(200).json({
      success: true,
      conversation,
      guestCapability: !userId ? issueGuestCapability(guestId) : undefined
    });
  } catch (error) {
    console.error('Error in initConversation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin: List conversations with filtering, search, and pagination
 */
exports.getConversations = async (req, res) => {
  try {
    const { status = 'all', search = '', page = 1, limit = 50 } = req.query;

    const query = {};

    if (status === 'unread') {
      query.unreadAdminCount = { $gt: 0 };
    } else if (status === 'active') {
      query.status = 'active';
    } else if (status === 'archived') {
      query.status = 'archived';
    } else {
      query.status = { $ne: 'archived' };
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { customerName: regex },
        { customerEmail: regex },
        { customerPhone: regex },
        { 'lastMessage.text': regex },
        { 'orderContext.orderNumber': regex }
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, parseInt(limit, 10));
    const pageSize = Math.min(100, parseInt(limit, 10));

    const [conversations, totalCount, totalUnread] = await Promise.all([
      Conversation.find(query)
        .sort({ 'lastMessage.createdAt': -1, updatedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Conversation.countDocuments(query),
      Conversation.aggregate([
        { $match: { status: { $ne: 'archived' } } },
        { $group: { _id: null, total: { $sum: '$unreadAdminCount' } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      conversations,
      pagination: {
        total: totalCount,
        page: parseInt(page, 10),
        limit: pageSize,
        totalPages: Math.ceil(totalCount / pageSize)
      },
      totalUnread: totalUnread[0]?.total || 0
    });
  } catch (error) {
    console.error('Error in getConversations:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin: Get total unread count across all conversations
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const result = await Conversation.aggregate([
      { $match: { status: { $ne: 'archived' } } },
      { $group: { _id: null, total: { $sum: '$unreadAdminCount' } } }
    ]);
    res.status(200).json({ success: true, count: result[0]?.total || 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get single conversation details
 */
exports.getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    const { guestId } = req.query;
    const guestCapability = getGuestCapability(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conversation = await Conversation.findById(id).lean();
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!canAccessConversation(conversation, req.user, guestId, guestCapability)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to this conversation' });
    }

    res.status(200).json({ success: true, conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get message history for a conversation
 */
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100, before, guestId } = req.query;
    const guestCapability = getGuestCapability(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conv = await Conversation.findById(id).lean();
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!canAccessConversation(conv, req.user, guestId, guestCapability)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to this conversation' });
    }

    const query = { conversationId: id, isDeleted: { $ne: true } };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: 1 })
      .limit(Math.min(200, parseInt(limit, 10)))
      .lean();

    res.status(200).json({ success: true, messages });
  } catch (error) {
    console.error('Error in getMessages:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Send message via REST fallback
 */
exports.sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text = '', clientMsgId, orderContext, senderName, customerName, customerPhone, guestId, attachment } = req.body;
    const guestCapability = getGuestCapability(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const cleanText = sanitizeText(text || '', 2000);
    if (!cleanText && (!attachment || !attachment.url)) {
      return res.status(400).json({ success: false, message: 'Message text or attachment is required' });
    }

    const conv = await Conversation.findById(id);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!canAccessConversation(conv, req.user, guestId, guestCapability)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to this conversation' });
    }

    const isAdmin = req.user?.role === 'admin';
    const sender = isAdmin ? 'admin' : 'customer';

    // Compulsory contact check for guest customer (no login required!)
    if (sender === 'customer' && !req.user?._id) {
      const candidateName = customerName || senderName || conv.customerName;
      const candidatePhone = customerPhone || conv.customerPhone;
      const contactCheck = validateCustomerContact({ name: candidateName, phone: candidatePhone });
      if (!contactCheck.valid) {
        return res.status(400).json({
          success: false,
          message: contactCheck.error,
          requiresContact: true
        });
      }
      conv.customerName = contactCheck.cleanName;
      conv.customerPhone = contactCheck.cleanPhone;
    }

    const resolvedName = isAdmin
      ? (req.user?.name || 'Fresh Veggies Support')
      : (conv.customerName || senderName || 'Customer');

    const newMsg = await ChatMessage.create({
      conversationId: conv._id,
      sender,
      senderId: req.user?._id || null,
      senderName: resolvedName,
      text: cleanText,
      attachment: attachment && attachment.url ? {
        url: attachment.url,
        fileType: attachment.fileType || 'image',
        fileName: attachment.fileName || '',
        fileSize: attachment.fileSize || 0
      } : null,
      status: 'sent',
      clientMsgId: clientMsgId || null,
      orderContext: orderContext || conv.orderContext || null
    });

    conv.lastMessage = {
      text: cleanText || 'Photo attachment',
      sender: newMsg.sender,
      createdAt: newMsg.createdAt,
      status: newMsg.status,
      hasAttachment: Boolean(attachment?.url)
    };

    if (sender === 'customer') {
      conv.unreadAdminCount += 1;
    } else {
      conv.unreadCustomerCount += 1;
    }

    if (orderContext) conv.orderContext = orderContext;
    await conv.save();

    const io = getIO();
    if (io) {
      io.to(`conversation:${conv._id}`).emit('message:received', newMsg.toObject());
      io.to('admin:all').emit('conversation:updated', {
        conversation: conv.toObject(),
        lastMessage: newMsg.toObject()
      });
    }

    res.status(201).json({ success: true, message: newMsg });
  } catch (error) {
    console.error('Error in sendMessage:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mark conversation as read
 */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const guestId = req.body.guestId || req.query.guestId;
    const guestCapability = getGuestCapability(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conv = await Conversation.findById(id);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!canAccessConversation(conv, req.user, guestId, guestCapability)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to this conversation' });
    }

    const isAdmin = req.user?.role === 'admin';
    const targetSender = isAdmin ? 'customer' : 'admin';

    await ChatMessage.updateMany(
      { conversationId: id, sender: targetSender, status: { $ne: 'read' } },
      { $set: { status: 'read', readAt: new Date() } }
    );

    const reset = isAdmin ? { unreadAdminCount: 0 } : { unreadCustomerCount: 0 };
    const updatedConv = await Conversation.findByIdAndUpdate(id, { $set: reset }, { new: true });

    const io = getIO();
    if (io) {
      io.to(`conversation:${id}`).emit('message:read_receipt', {
        conversationId: id,
        reader: isAdmin ? 'admin' : 'customer',
        readAt: new Date()
      });
      io.to('admin:all').emit('conversation:read_sync', {
        conversationId: id,
        reader: isAdmin ? 'admin' : 'customer'
      });
    }

    res.status(200).json({ success: true, conversation: updatedConv });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Archive or Unarchive conversation
 */
exports.toggleArchive = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conv = await Conversation.findById(id);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    conv.status = conv.status === 'archived' ? 'active' : 'archived';
    await conv.save();

    res.status(200).json({ success: true, status: conv.status, conversation: conv });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin: Get recent orders for this conversation's customer
 */
exports.getCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const conv = await Conversation.findById(id);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    let orders = [];
    if (conv.customerId) {
      orders = await Order.find({ userId: conv.customerId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    } else if (conv.customerPhone) {
      orders = await Order.find({ 'shippingAddress.phone': conv.customerPhone })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
    }

    res.status(200).json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a single message for everyone
 */
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const guestId = req.body.guestId || req.query.guestId;
    const guestCapability = getGuestCapability(req);

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: 'Invalid message ID' });
    }

    const msg = await ChatMessage.findById(messageId);
    if (!msg) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const convId = msg.conversationId;
    const conv = await Conversation.findById(convId);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const isAdmin = req.user?.role === 'admin';
    const isUserOwner = req.user?._id && String(msg.senderId) === String(req.user._id);
    const isGuestOwner = !req.user && guestId && conv.guestId === guestId &&
      verifyGuestCapability(guestId, guestCapability) && msg.sender === 'customer';

    // Only admin or message owner can delete; customers cannot delete admin messages
    if (!isAdmin) {
      if (msg.sender === 'admin') {
        return res.status(403).json({ success: false, message: 'Not authorized to delete admin messages' });
      }
      if (!isUserOwner && !isGuestOwner) {
        return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
      }
    }

    // Mark as deleted in DB
    msg.isDeleted = true;
    msg.deletedAt = new Date();
    await msg.save();

    // Recalculate lastMessage on conversation if needed
    if (conv) {
      const latestMsg = await ChatMessage.findOne({
        conversationId: convId,
        isDeleted: { $ne: true }
      }).sort({ createdAt: -1 });

      if (latestMsg) {
        conv.lastMessage = {
          text: latestMsg.text || 'Photo attachment',
          sender: latestMsg.sender,
          createdAt: latestMsg.createdAt,
          status: latestMsg.status,
          hasAttachment: Boolean(latestMsg.attachment?.url)
        };
      } else {
        conv.lastMessage = {
          text: '',
          sender: 'customer',
          createdAt: new Date(),
          status: 'sent',
          hasAttachment: false
        };
      }
      await conv.save();
    }

    // Broadcast deletion to conversation room and admins
    const io = getIO();
    if (io) {
      io.to(`conversation:${convId}`).emit('message:deleted', {
        messageId,
        conversationId: convId
      });
      io.to('admin:all').emit('message:deleted', {
        messageId,
        conversationId: convId
      });
      if (conv) {
        io.to('admin:all').emit('conversation:updated', {
          conversation: conv.toObject(),
          lastMessage: conv.lastMessage
        });
      }
    }

    res.status(200).json({ success: true, message: 'Message deleted for everyone' });
  } catch (error) {
    console.error('Error in deleteMessage:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Clear all messages in a conversation
 */
exports.clearMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const guestId = req.body.guestId || req.query.guestId;
    const guestCapability = getGuestCapability(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conv = await Conversation.findById(id);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (!canAccessConversation(conv, req.user, guestId, guestCapability)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Access denied to this conversation' });
    }

    // Mark all as deleted
    await ChatMessage.updateMany(
      { conversationId: id },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );

    conv.lastMessage = {
      text: '',
      sender: 'customer',
      createdAt: new Date(),
      status: 'sent',
      hasAttachment: false
    };
    conv.unreadAdminCount = 0;
    conv.unreadCustomerCount = 0;
    await conv.save();

    const io = getIO();
    if (io) {
      io.to(`conversation:${id}`).emit('conversation:cleared', { conversationId: id });
      io.to('admin:all').emit('conversation:cleared', { conversationId: id });
      io.to('admin:all').emit('conversation:updated', {
        conversation: conv.toObject(),
        lastMessage: conv.lastMessage
      });
    }

    res.status(200).json({ success: true, message: 'Chat cleared successfully' });
  } catch (error) {
    console.error('Error in clearMessages:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Admin: Permanently delete conversation and its messages
 */
exports.deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    await ChatMessage.deleteMany({ conversationId: id });
    await Conversation.findByIdAndDelete(id);

    const io = getIO();
    if (io) {
      io.to(`conversation:${id}`).emit('conversation:deleted', { conversationId: id });
      io.to('admin:all').emit('conversation:deleted', { conversationId: id });
    }

    res.status(200).json({ success: true, message: 'Conversation deleted permanently' });
  } catch (error) {
    console.error('Error in deleteConversation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
