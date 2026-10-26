const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/user.model');
const Conversation = require('../src/models/conversation.model');
const ChatMessage = require('../src/models/chat-message.model');

async function runChatTests() {
  console.log('--- STARTING LIVE CHAT ENHANCEMENTS BACKEND TEST ---');
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fresh_veggies_test';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  try {
    // 1. Identify or create test conversation
    const guestId = `test_guest_${Date.now()}`;
    const testConv = await Conversation.create({
      guestId,
      customerName: 'Test Shopper',
      status: 'active'
    });
    console.log(`✓ Created test conversation: ${testConv._id}`);

    // 2. Create customer message with text
    const msg1 = await ChatMessage.create({
      conversationId: testConv._id,
      sender: 'customer',
      senderName: 'Test Shopper',
      text: 'Do you have heirloom tomato seeds available?',
      status: 'sent'
    });
    console.log(`✓ Created text message: ${msg1._id}`);

    // 3. Create customer message with attachment
    const msg2 = await ChatMessage.create({
      conversationId: testConv._id,
      sender: 'customer',
      senderName: 'Test Shopper',
      text: 'Here is a photo of my tomato leaf problem',
      attachment: {
        url: 'https://res.cloudinary.com/fresh-veggies/image/upload/v1/chat/tomato-leaf.jpg',
        fileType: 'image',
        fileName: 'tomato-leaf.jpg',
        fileSize: 1048576
      },
      status: 'sent'
    });
    console.log(`✓ Created attachment message: ${msg2._id}`);

    // Update conversation lastMessage
    testConv.lastMessage = {
      text: msg2.text,
      sender: msg2.sender,
      createdAt: msg2.createdAt,
      status: msg2.status,
      hasAttachment: true
    };
    await testConv.save();

    // 4. Create admin response
    const adminUser = await User.findOne({ role: 'admin' });
    const msg3 = await ChatMessage.create({
      conversationId: testConv._id,
      sender: 'admin',
      senderId: adminUser ? adminUser._id : null,
      senderName: 'Admin Specialist',
      text: 'That looks like early blight. We recommend our organic neem fungicide spray.',
      status: 'sent'
    });
    console.log(`✓ Created admin reply: ${msg3._id}`);

    // 5. Test message search / retrieval (excludes isDeleted: true)
    let activeMessages = await ChatMessage.find({
      conversationId: testConv._id,
      isDeleted: { $ne: true }
    });
    if (activeMessages.length !== 3) {
      throw new Error(`Expected 3 messages, got ${activeMessages.length}`);
    }
    console.log('✓ Successfully retrieved 3 active messages including attachment');

    // 6. Test single message deletion (msg1)
    msg1.isDeleted = true;
    msg1.deletedAt = new Date();
    await msg1.save();

    activeMessages = await ChatMessage.find({
      conversationId: testConv._id,
      isDeleted: { $ne: true }
    });
    if (activeMessages.length !== 2) {
      throw new Error(`Expected 2 messages after deleting msg1, got ${activeMessages.length}`);
    }
    console.log('✓ Successfully soft-deleted single message');

    // 7. Test lastMessage recalculation when latest is deleted
    msg3.isDeleted = true;
    msg3.deletedAt = new Date();
    await msg3.save();

    const latestRemaining = await ChatMessage.findOne({
      conversationId: testConv._id,
      isDeleted: { $ne: true }
    }).sort({ createdAt: -1 });

    if (!latestRemaining || String(latestRemaining._id) !== String(msg2._id)) {
      throw new Error('Recalculated latest message should be msg2');
    }
    console.log(`✓ Recalculated latest message is msg2 (${latestRemaining.attachment.fileName})`);

    // 8. Test Clear All Messages
    await ChatMessage.updateMany(
      { conversationId: testConv._id },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    const clearedMessages = await ChatMessage.find({
      conversationId: testConv._id,
      isDeleted: { $ne: true }
    });
    if (clearedMessages.length !== 0) {
      throw new Error('Expected 0 active messages after clear');
    }
    console.log('✓ Successfully cleared conversation messages');

    // Clean up test data
    await ChatMessage.deleteMany({ conversationId: testConv._id });
    await Conversation.findByIdAndDelete(testConv._id);
    console.log('✓ Cleaned up test conversation and messages');

    console.log('\n🎉 ALL LIVE CHAT ENHANCEMENT TESTS PASSED PERFECTLY!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

runChatTests();
