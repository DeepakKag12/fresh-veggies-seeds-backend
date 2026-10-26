const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Contact = require('../src/models/contact.model');
const Conversation = require('../src/models/conversation.model');
const ChatMessage = require('../src/models/chat-message.model');
const contactController = require('../src/controllers/contact.controller');

async function testContactChatBridge() {
  console.log('🧪 Testing Contact Form Direct-to-Chat Section Integration...\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fresh_veggies_test';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  try {
    const testGuestId = `guest_test_${Date.now()}`;
    const mockReq = {
      body: {
        name: 'Anita Verma',
        email: `anita_${Date.now()}@example.com`,
        phone: '98' + Math.floor(10000000 + Math.random() * 90000000),
        subject: 'Gardening Advice & Sowing Tips',
        message: 'Hello, what is the best sowing season for coriander seeds on terrace pots?',
        guestId: testGuestId
      },
      ip: '127.0.0.1',
      headers: {}
    };

    let responseData = null;
    let statusCode = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        responseData = payload;
        return this;
      }
    };

    // Execute submitContactInquiry
    await contactController.submitContactInquiry(mockReq, mockRes);

    if (statusCode !== 201 || !responseData?.success) {
      throw new Error(`Inquiry submission failed with status ${statusCode}: ${JSON.stringify(responseData)}`);
    }
    console.log('✅ 1. submitContactInquiry returned 201 Created');

    // 2. Verify Contact model document created
    const contactRecord = await Contact.findById(responseData.data.id);
    if (!contactRecord || contactRecord.name !== 'Anita Verma') {
      throw new Error('Contact record not found in MongoDB');
    }
    console.log('✅ 2. Contact ticket created in database:', contactRecord._id, `[${contactRecord.subject}]`);

    // 3. Verify Conversation created in Chat section
    const conversation = await Conversation.findById(responseData.data.conversationId);
    if (!conversation) {
      throw new Error('Chat Conversation was not created for contact submission');
    }
    if (conversation.customerName !== 'Anita Verma' || conversation.unreadAdminCount < 1) {
      throw new Error(`Conversation mismatch: ${JSON.stringify(conversation)}`);
    }
    console.log('✅ 3. Chat Conversation bridged in Messages section:', conversation._id, 'Unread count:', conversation.unreadAdminCount);

    // 4. Verify ChatMessage created in Chat section
    const chatMsg = await ChatMessage.findOne({ conversationId: conversation._id });
    if (!chatMsg || !chatMsg.text.includes('Website Contact Form') || !chatMsg.text.includes('coriander seeds')) {
      throw new Error(`ChatMessage text mismatch: ${chatMsg?.text}`);
    }
    console.log('✅ 4. ChatMessage stored in Conversation thread:');
    console.log(`   "${chatMsg.text}"`);

    // Clean up test records
    await Contact.findByIdAndDelete(contactRecord._id);
    await ChatMessage.deleteMany({ conversationId: conversation._id });
    await Conversation.findByIdAndDelete(conversation._id);
    console.log('✅ Cleaned up test records');

    console.log('\n🎉 ALL CONTACT-TO-CHAT BRIDGE TESTS PASSED GREEN!\n');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

testContactChatBridge();
