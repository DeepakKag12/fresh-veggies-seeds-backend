const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Conversation = require('../src/models/conversation.model');
const ChatMessage = require('../src/models/chat-message.model');
const { initSocket, getIO } = require('../src/socket');
const http = require('http');
const express = require('express');

async function runTests() {
  console.log('🧪 Starting Native In-App Chat & Communication Tests...\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fresh_veggies_test';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  try {
    // 1. Test Conversation Model Creation
    console.log('\n--- 1. Testing Conversation Model ---');
    const testGuestId = `test_guest_${Date.now()}`;
    const conv = await Conversation.create({
      guestId: testGuestId,
      customerName: 'Test Shopper',
      customerPhone: '9876543210',
      customerEmail: 'shopper@test.com',
      orderContext: {
        orderNumber: 'FV-TEST-001',
        totalAmount: 499,
        orderStatus: 'Confirmed'
      }
    });
    console.log('✅ Created Conversation:', conv._id, 'Customer:', conv.customerName);

    // 2. Test Chat Message Creation (Customer -> Admin)
    console.log('\n--- 2. Testing Chat Message Lifecycle ---');
    const custMsg = await ChatMessage.create({
      conversationId: conv._id,
      sender: 'customer',
      senderName: 'Test Shopper',
      text: 'Hello, will my seeds arrive this week?',
      status: 'sent',
      clientMsgId: `cli_test_${Date.now()}`
    });
    console.log('✅ Customer message created:', custMsg.text, 'Status:', custMsg.status);

    // Update conversation lastMessage
    conv.lastMessage = {
      text: custMsg.text,
      sender: custMsg.sender,
      createdAt: custMsg.createdAt,
      status: custMsg.status
    };
    conv.unreadAdminCount += 1;
    await conv.save();

    // Verify unread count
    const foundConv = await Conversation.findById(conv._id);
    if (foundConv.unreadAdminCount !== 1) {
      throw new Error(`Expected unreadAdminCount 1, got ${foundConv.unreadAdminCount}`);
    }
    console.log('✅ Admin unread counter incremented properly:', foundConv.unreadAdminCount);

    // 3. Test Admin Response (Admin -> Customer)
    const adminMsg = await ChatMessage.create({
      conversationId: conv._id,
      sender: 'admin',
      senderName: 'Fresh Veggies Support',
      text: 'Yes! Your seeds are scheduled for dispatch today.',
      status: 'delivered'
    });
    console.log('✅ Admin response created:', adminMsg.text, 'Status:', adminMsg.status);

    conv.lastMessage = {
      text: adminMsg.text,
      sender: adminMsg.sender,
      createdAt: adminMsg.createdAt,
      status: adminMsg.status
    };
    conv.unreadCustomerCount += 1;
    await conv.save();

    // 4. Test Read Receipts
    console.log('\n--- 3. Testing WhatsApp Read Receipts (Ticks System) ---');
    const updateResult = await ChatMessage.updateMany(
      { conversationId: conv._id, sender: 'customer', status: { $ne: 'read' } },
      { $set: { status: 'read', readAt: new Date() } }
    );
    console.log('✅ Messages marked read count:', updateResult.modifiedCount);

    const verifiedMsg = await ChatMessage.findById(custMsg._id);
    if (verifiedMsg.status !== 'read') {
      throw new Error(`Expected status 'read', got ${verifiedMsg.status}`);
    }
    console.log('✅ Verified tick status transitioned to read:', verifiedMsg.status, 'ReadAt:', verifiedMsg.readAt);

    // 5. Test Socket.io Initialization
    console.log('\n--- 4. Testing Socket.io Server Attachment ---');
    const app = express();
    const server = http.createServer(app);
    initSocket(server, { origin: '*' });
    const io = getIO();
    if (!io) {
      throw new Error('Socket.io instance failed to initialize');
    }
    console.log('✅ Socket.io engine initialized and attached successfully');

    // Clean up test data
    await ChatMessage.deleteMany({ conversationId: conv._id });
    await Conversation.findByIdAndDelete(conv._id);
    console.log('\n✅ Cleaned up test records');

    console.log('\n🎉 ALL NATIVE IN-APP COMMUNICATION TESTS PASSED!\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTests();
