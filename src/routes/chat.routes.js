const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect, admin, optionalAuth } = require('../middleware/auth.middleware');

// Customer / Storefront routes
router.get('/my-conversation', optionalAuth, chatController.getMyConversation);
router.post('/init', optionalAuth, chatController.initConversation);

// Shared / Authenticated message interactions
router.get('/conversations/:id', optionalAuth, chatController.getConversationById);
router.get('/conversations/:id/messages', optionalAuth, chatController.getMessages);
router.post('/conversations/:id/messages', optionalAuth, chatController.sendMessage);
router.patch('/conversations/:id/read', optionalAuth, chatController.markAsRead);

// Dedicated Admin routes
router.get('/conversations', protect, admin, chatController.getConversations);
router.get('/unread-count', protect, admin, chatController.getUnreadCount);
router.patch('/conversations/:id/archive', protect, admin, chatController.toggleArchive);
router.get('/conversations/:id/orders', protect, admin, chatController.getCustomerOrders);
router.delete('/conversations/:id', protect, admin, chatController.deleteConversation);

// Message & Conversation Deletion (Admin & Message Owner)
router.delete('/messages/:messageId', optionalAuth, chatController.deleteMessage);
router.delete('/conversations/:id/messages', optionalAuth, chatController.clearMessages);

module.exports = router;
