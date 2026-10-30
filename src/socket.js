const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/user.model');
const Conversation = require('./models/conversation.model');
const ChatMessage = require('./models/chat-message.model');
const {
  sanitizeText,
  validateCustomerContact,
  verifyGuestCapability,
  canAccessConversation
} = require('./utils/chat-security.util');

let io = null;

// Track active connections: key = 'admin' or `user:${id}` or `guest:${id}`
// Value = Set of socket IDs
const onlinePresence = new Map();
const socketToIdentity = new Map();
const socketRateLimits = new Map();

const getIdentityKey = (user, guestId) => {
  if (user?.role === 'admin') return 'admin';
  if (user?._id) return `user:${user._id}`;
  if (guestId) return `guest:${guestId}`;
  return null;
};

const initSocket = (httpServer, corsOptions) => {
  io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 30000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
  });

  // Socket middleware: optional authentication via token or guest handshake
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      const guestId = socket.handshake.auth?.guestId || socket.handshake.query?.guestId;
      const guestCapability = socket.handshake.auth?.guestCapability || socket.handshake.query?.guestCapability;
      const customerName = socket.handshake.auth?.customerName || socket.handshake.query?.customerName;
      const customerPhone = socket.handshake.auth?.customerPhone || socket.handshake.query?.customerPhone;

      socket.data = {
        user: null,
        guestId: guestId || null,
        guestCapability: guestCapability || null,
        customerName: customerName || 'Guest Shopper',
        customerPhone: customerPhone || ''
      };

      if (token && process.env.JWT_SECRET) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded && decoded.id) {
            const user = await User.findById(decoded.id).select('-password');
            if (user) {
              socket.data.user = user;
              socket.data.customerName = user.name;
            }
          }
        } catch (tokenErr) {
          // Token expired or invalid - fallback to guest session gracefully
        }
      }

      next();
    } catch (err) {
      console.error('Socket handshake auth error:', err);
      next();
    }
  });

  io.on('connection', async (socket) => {
    const { user, guestId, guestCapability, customerName } = socket.data;
    const isAdmin = user?.role === 'admin';
    const identityKey = getIdentityKey(user, guestId);

    if (identityKey) {
      if (!onlinePresence.has(identityKey)) {
        onlinePresence.set(identityKey, new Set());
      }
      onlinePresence.get(identityKey).add(socket.id);
      socketToIdentity.set(socket.id, identityKey);
    }

    if (isAdmin) {
      socket.join('admin:all');
      // Broadcast to customers that support is online
      io.emit('support:presence', { isOnline: true });
    } else if (user?._id) {
      socket.join(`user:${user._id}`);
    } else if (guestId) {
      socket.join(`guest:${guestId}`);
    }

    // Client requests support presence status
    socket.on('support:check', () => {
      const adminSockets = onlinePresence.get('admin');
      const isOnline = Boolean(adminSockets && adminSockets.size > 0);
      socket.emit('support:presence', { isOnline });
    });

    // Join a specific conversation room
    socket.on('conversation:join', async ({ conversationId }) => {
      if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return;

      try {
        const conv = await Conversation.findById(conversationId);
        if (!conv) return;

        // Security check: Only allow admin OR verified owner of the conversation
        if (!canAccessConversation(conv, user, guestId, guestCapability)) {
          console.warn(`[Socket Security] Unauthorized join attempt to room ${conversationId} by identity ${identityKey}`);
          return;
        }

        socket.join(`conversation:${conversationId}`);

        // If admin joined, mark customer messages as read
        // If customer joined, mark admin messages as read
        const reader = isAdmin ? 'admin' : 'customer';
        const targetSender = isAdmin ? 'customer' : 'admin';

        const updateResult = await ChatMessage.updateMany(
          {
            conversationId,
            sender: targetSender,
            status: { $ne: 'read' }
          },
          {
            $set: { status: 'read', readAt: new Date() }
          }
        );

        if (updateResult.modifiedCount > 0) {
          const resetField = isAdmin ? { unreadAdminCount: 0 } : { unreadCustomerCount: 0 };
          await Conversation.findByIdAndUpdate(conversationId, {
            $set: { ...resetField, isOnline: true }
          });

          // Notify room of read receipts
          io.to(`conversation:${conversationId}`).emit('message:read_receipt', {
            conversationId,
            reader,
            readAt: new Date()
          });

          // Update admin panel counters
          io.to('admin:all').emit('conversation:read_sync', {
            conversationId,
            reader
          });
        }
      } catch (err) {
        console.error('Error during conversation:join sync:', err);
      }
    });

    // Leave conversation room
    socket.on('conversation:leave', ({ conversationId }) => {
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
    });

    // Send a message
    socket.on('message:send', async (payload, callback) => {
      try {
        const {
          conversationId,
          text,
          clientMsgId,
          orderContext,
          senderName: customSenderName,
          customerName: incomingCustomerName,
          customerPhone: incomingCustomerPhone,
          attachment
        } = payload || {};

        // Anti-spam / rate limiting per socket connection
        const nowMs = Date.now();
        const recentTimestamps = (socketRateLimits.get(socket.id) || []).filter(t => nowMs - t < 5000);
        if (recentTimestamps.length >= 10) {
          if (typeof callback === 'function') callback({ error: 'Too many messages sent. Please slow down.' });
          return;
        }
        recentTimestamps.push(nowMs);
        socketRateLimits.set(socket.id, recentTimestamps);

        const cleanText = sanitizeText(text || '', 2000);
        if (!cleanText && (!attachment || !attachment.url)) {
          if (typeof callback === 'function') callback({ error: 'Message text or attachment is required' });
          return;
        }

        let conv = null;
        if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
          conv = await Conversation.findById(conversationId);
          if (conv && !canAccessConversation(conv, user, guestId, guestCapability)) {
            if (typeof callback === 'function') callback({ error: 'Forbidden: Access denied to this conversation' });
            return;
          }
        }

        if (!conv) {
          // If conversation does not exist yet, find or create one
          if (user?._id) {
            conv = await Conversation.findOne({ customerId: user._id, status: { $ne: 'archived' } });
            if (!conv) {
              conv = await Conversation.create({
                customerId: user._id,
                customerName: user.name || 'Shopper',
                customerEmail: user.email || '',
                customerPhone: user.phone || '',
                orderContext: orderContext || null
              });
            }
          } else if (guestId) {
            conv = await Conversation.findOne({ guestId, status: { $ne: 'archived' } });
            if (!conv) {
              // Compulsory name and phone validation for new guest conversations
              const contactCheck = validateCustomerContact({
                name: incomingCustomerName || customSenderName || customerName,
                phone: incomingCustomerPhone || socket.data.customerPhone
              });
              if (!contactCheck.valid) {
                if (typeof callback === 'function') {
                  callback({ error: contactCheck.error, requiresContact: true });
                }
                return;
              }

              conv = await Conversation.create({
                guestId,
                customerName: contactCheck.cleanName,
                customerPhone: contactCheck.cleanPhone,
                orderContext: orderContext || null
              });
            }
          } else {
            if (typeof callback === 'function') callback({ error: 'Missing conversation or identity' });
            return;
          }
        }

        const sender = isAdmin ? 'admin' : 'customer';

        // For guest customer, enforce compulsory contact details
        if (sender === 'customer' && !user?._id) {
          const candidateName = incomingCustomerName || customSenderName || conv.customerName || customerName;
          const candidatePhone = incomingCustomerPhone || conv.customerPhone || socket.data.customerPhone;
          const contactCheck = validateCustomerContact({ name: candidateName, phone: candidatePhone });
          if (!contactCheck.valid) {
            if (typeof callback === 'function') {
              callback({ error: contactCheck.error, requiresContact: true });
            }
            return;
          }

          // Persist verified contact details onto conversation and socket session
          if (conv.customerName !== contactCheck.cleanName || conv.customerPhone !== contactCheck.cleanPhone) {
            conv.customerName = contactCheck.cleanName;
            conv.customerPhone = contactCheck.cleanPhone;
            await conv.save();
          }
          socket.data.customerName = contactCheck.cleanName;
          socket.data.customerPhone = contactCheck.cleanPhone;
        }

        const senderName = isAdmin
          ? (user?.name || 'Fresh Veggies Support')
          : (conv.customerName || customSenderName || 'Customer');

        // Check if recipient is connected in conversation room
        const roomName = `conversation:${conv._id}`;
        const roomSockets = io.sockets.adapter.rooms.get(roomName);
        const recipientInRoom = roomSockets && roomSockets.size > 1;

        // Check if recipient is online in general
        const recipientIdentity = isAdmin
          ? (conv.customerId ? `user:${conv.customerId}` : `guest:${conv.guestId}`)
          : 'admin';
        const recipientOnline = Boolean(
          onlinePresence.get(recipientIdentity)?.size > 0
        );

        let initialStatus = 'sent';
        if (recipientInRoom) {
          initialStatus = 'read';
        } else if (recipientOnline) {
          initialStatus = 'delivered';
        }

        const now = new Date();
        const newMsg = await ChatMessage.create({
          conversationId: conv._id,
          sender,
          senderId: user?._id || null,
          senderName,
          text: cleanText,
          attachment: attachment && attachment.url ? {
            url: attachment.url,
            fileType: attachment.fileType || 'image',
            fileName: attachment.fileName || '',
            fileSize: attachment.fileSize || 0
          } : null,
          status: initialStatus,
          clientMsgId: clientMsgId || null,
          orderContext: orderContext || conv.orderContext || null,
          deliveredAt: initialStatus === 'delivered' || initialStatus === 'read' ? now : null,
          readAt: initialStatus === 'read' ? now : null
        });

        // Update conversation summary
        const unreadAdminInc = sender === 'customer' && !recipientInRoom ? 1 : 0;
        const unreadCustInc = sender === 'admin' && !recipientInRoom ? 1 : 0;

        conv.lastMessage = {
          text: cleanText || 'Photo attachment',
          sender: newMsg.sender,
          createdAt: newMsg.createdAt,
          status: newMsg.status,
          hasAttachment: Boolean(attachment?.url)
        };
        if (unreadAdminInc) conv.unreadAdminCount += unreadAdminInc;
        if (unreadCustInc) conv.unreadCustomerCount += unreadCustInc;
        if (orderContext && !conv.orderContext?.orderId) {
          conv.orderContext = orderContext;
        }
        await conv.save();

        const messageData = newMsg.toObject();

        // Broadcast message to the conversation room
        io.to(roomName).emit('message:received', messageData);

        // Notify direct customer channel if not in room
        if (sender === 'admin') {
          if (conv.customerId) {
            io.to(`user:${conv.customerId}`).emit('message:incoming', messageData);
          } else if (conv.guestId) {
            io.to(`guest:${conv.guestId}`).emit('message:incoming', messageData);
          }
        }

        // Always update admin live list
        io.to('admin:all').emit('conversation:updated', {
          conversation: conv.toObject(),
          lastMessage: messageData
        });

        if (typeof callback === 'function') {
          callback({ success: true, message: messageData });
        }
      } catch (err) {
        console.error('Error handling message:send:', err);
        if (typeof callback === 'function') callback({ error: err.message });
      }
    });

    // Mark messages as read
    socket.on('message:mark_read', async ({ conversationId }) => {
      if (!conversationId) return;
      try {
        const reader = isAdmin ? 'admin' : 'customer';
        const targetSender = isAdmin ? 'customer' : 'admin';

        const result = await ChatMessage.updateMany(
          {
            conversationId,
            sender: targetSender,
            status: { $ne: 'read' }
          },
          {
            $set: { status: 'read', readAt: new Date() }
          }
        );

        if (result.modifiedCount > 0) {
          const resetField = isAdmin ? { unreadAdminCount: 0 } : { unreadCustomerCount: 0 };
          await Conversation.findByIdAndUpdate(conversationId, {
            $set: resetField
          });

          io.to(`conversation:${conversationId}`).emit('message:read_receipt', {
            conversationId,
            reader,
            readAt: new Date()
          });

          io.to('admin:all').emit('conversation:read_sync', {
            conversationId,
            reader
          });
        }
      } catch (err) {
        console.error('Error in message:mark_read:', err);
      }
    });

    // Real-time typing indicators
    socket.on('typing:start', ({ conversationId, senderName: typingName }) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        isTyping: true,
        sender: isAdmin ? 'admin' : 'customer',
        senderName: isAdmin ? 'Fresh Veggies Support' : (typingName || customerName)
      });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit('typing:status', {
        conversationId,
        isTyping: false,
        sender: isAdmin ? 'admin' : 'customer'
      });
    });

    // Delete message for everyone
    socket.on('message:delete', async ({ messageId, conversationId }, callback) => {
      try {
        if (!messageId) return;
        const msg = await ChatMessage.findById(messageId);
        if (!msg) {
          if (typeof callback === 'function') callback({ error: 'Message not found' });
          return;
        }

        const convId = msg.conversationId;

        // Only admin or message owner can delete; customers cannot delete admin messages
        if (!isAdmin) {
          if (msg.sender === 'admin') {
            if (typeof callback === 'function') callback({ error: 'Not authorized to delete admin messages' });
            return;
          }
          if (msg.senderId && user?._id && String(msg.senderId) !== String(user._id)) {
            if (typeof callback === 'function') callback({ error: 'Not authorized to delete this message' });
            return;
          }
        }
        msg.isDeleted = true;
        msg.deletedAt = new Date();
        await msg.save();

        // Update conversation lastMessage if needed
        const conv = await Conversation.findById(convId);
        if (conv) {
          const latest = await ChatMessage.findOne({
            conversationId: convId,
            isDeleted: { $ne: true }
          }).sort({ createdAt: -1 });

          conv.lastMessage = latest ? {
            text: latest.text || 'Photo attachment',
            sender: latest.sender,
            createdAt: latest.createdAt,
            status: latest.status,
            hasAttachment: Boolean(latest.attachment?.url)
          } : {
            text: '',
            sender: 'customer',
            createdAt: new Date(),
            status: 'sent',
            hasAttachment: false
          };
          await conv.save();
        }

        io.to(`conversation:${convId}`).emit('message:deleted', { messageId, conversationId: convId });
        io.to('admin:all').emit('message:deleted', { messageId, conversationId: convId });
        if (conv) {
          io.to('admin:all').emit('conversation:updated', {
            conversation: conv.toObject(),
            lastMessage: conv.lastMessage
          });
        }

        if (typeof callback === 'function') callback({ success: true });
      } catch (err) {
        console.error('Error handling message:delete:', err);
        if (typeof callback === 'function') callback({ error: err.message });
      }
    });

    // Clear entire conversation messages
    socket.on('conversation:clear', async ({ conversationId }, callback) => {
      try {
        if (!conversationId) return;
        await ChatMessage.updateMany(
          { conversationId },
          { $set: { isDeleted: true, deletedAt: new Date() } }
        );

        const conv = await Conversation.findByIdAndUpdate(
          conversationId,
          {
            $set: {
              'lastMessage.text': '',
              'lastMessage.hasAttachment': false,
              unreadAdminCount: 0,
              unreadCustomerCount: 0
            }
          },
          { new: true }
        );

        io.to(`conversation:${conversationId}`).emit('conversation:cleared', { conversationId });
        io.to('admin:all').emit('conversation:cleared', { conversationId });
        if (conv) {
          io.to('admin:all').emit('conversation:updated', {
            conversation: conv.toObject(),
            lastMessage: conv.lastMessage
          });
        }

        if (typeof callback === 'function') callback({ success: true });
      } catch (err) {
        console.error('Error handling conversation:clear:', err);
        if (typeof callback === 'function') callback({ error: err.message });
      }
    });

    // Disconnect handling
    socket.on('disconnect', async () => {
      const storedIdentity = socketToIdentity.get(socket.id);
      socketToIdentity.delete(socket.id);

      if (storedIdentity) {
        const socketSet = onlinePresence.get(storedIdentity);
        if (socketSet) {
          socketSet.delete(socket.id);
          if (socketSet.size === 0) {
            onlinePresence.delete(storedIdentity);

            if (storedIdentity === 'admin') {
              io.emit('support:presence', { isOnline: false, lastSeen: new Date() });
            } else {
              // Update last seen in conversation
              const isUser = storedIdentity.startsWith('user:');
              const id = storedIdentity.split(':')[1];
              const query = isUser ? { customerId: id } : { guestId: id };

              await Conversation.findOneAndUpdate(query, {
                $set: { isOnline: false, lastSeen: new Date() }
              }).catch(() => null);

              io.to('admin:all').emit('presence:update', {
                identity: storedIdentity,
                isOnline: false,
                lastSeen: new Date()
              });
            }
          }
        }
      }
    });
  });

  return io;
};

const getIO = () => io;

module.exports = {
  initSocket,
  getIO
};
