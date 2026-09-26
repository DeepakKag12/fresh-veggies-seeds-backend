const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide your full name'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide your email address'],
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  subject: {
    type: String,
    trim: true,
    default: 'General Inquiry',
    maxlength: [200, 'Subject cannot exceed 200 characters']
  },
  message: {
    type: String,
    required: [true, 'Please provide your message or inquiry'],
    trim: true,
    maxlength: [3000, 'Message cannot exceed 3000 characters']
  },
  status: {
    type: String,
    enum: ['new', 'read', 'replied', 'archived'],
    default: 'new'
  },
  ipAddress: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

contactSchema.index({ createdAt: -1 });
contactSchema.index({ status: 1 });

module.exports = mongoose.model('Contact', contactSchema);
