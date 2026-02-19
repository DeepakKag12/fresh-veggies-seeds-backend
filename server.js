const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load environment variables FIRST before anything else
dotenv.config();

// Initialize Express app
const app = express();

// ─── CORS Configuration ───────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://fresh-veggies-seeds-frontend.vercel.app',
  'https://fresh-veggies-seeds-frontend-git-main-deepak-kags-projects.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      /^https:\/\/fresh-veggies-seeds.*\.vercel\.app$/.test(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors(corsOptions));

// ─── Webhook route must receive RAW body (before express.json) ───────────────
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// ─── JSON body parser (all other routes) ─────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Rate Limiters ────────────────────────────────────────────────────────────

// Auth: 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many auth attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// OTP: 5 sends per 10 min (per IP)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many OTP requests. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Payment: 20 requests per 10 min
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many payment requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Order creation: 30 per 10 min
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many order requests.' },
  standardHeaders: true,
  legacyHeaders: false
});

// General API: 200 per 15 min
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);

// ─── Database connection (serverless-safe, cached) ─────────────────────────
// Vercel runs each request in a serverless function. We cache the connection
// across warm invocations and await it in middleware so every handler is
// guaranteed a live connection before it executes.
let _dbConnected = false;

const connectDB = async () => {
  if (_dbConnected || mongoose.connection.readyState >= 1) {
    _dbConnected = true;
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    bufferCommands: false,          // fail fast instead of queuing forever
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  _dbConnected = true;
  console.log('✅ MongoDB Connected Successfully');

  // ── Abandoned order cleanup (only schedule once per warm instance) ──────
  const Order = require('./models/Order');
  const ABANDONED_TTL = 30 * 60 * 1000;
  const cleanupAbandonedOrders = async () => {
    try {
      const cutoff = new Date(Date.now() - ABANDONED_TTL);
      const result = await Order.updateMany(
        { paymentMode: { $in: ['Online', 'UPI'] }, paymentStatus: 'Pending', createdAt: { $lt: cutoff } },
        { $set: { paymentStatus: 'Failed' } }
      );
      if (result.modifiedCount > 0)
        console.log(`🧹 Cleaned up ${result.modifiedCount} abandoned online order(s)`);
    } catch (err) {
      console.error('⚠️  Cleanup job error:', err.message);
    }
  };
  cleanupAbandonedOrders();
  setInterval(cleanupAbandonedOrders, ABANDONED_TTL);
};

// Middleware: ensure DB is ready before any route handler runs
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    res.status(500).json({ success: false, message: 'Database connection failed. Please try again.' });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth/login',         authLimiter);
app.use('/api/auth/register',      authLimiter);
app.use('/api/auth/send-otp',      otpLimiter);
app.use('/api/auth/verify-otp',    otpLimiter);
app.use('/api/auth/forgot-password', otpLimiter);
app.use('/api/auth',               authRoutes);

app.use('/api/categories',  require('./routes/categoryRoutes'));
app.use('/api/products',    require('./routes/productRoutes'));
app.use('/api/combos',      require('./routes/comboRoutes'));
app.use('/api/orders',      orderLimiter, require('./routes/orderRoutes'));
app.use('/api/payments',    paymentLimiter, require('./routes/paymentRoutes'));
app.use('/api/admin',       require('./routes/adminRoutes'));
app.use('/api/upload',      require('./routes/uploadRoutes'));
app.use('/api/coupons',     require('./routes/couponRoutes'));
app.use('/api/reviews',     require('./routes/reviewRoutes'));
app.use('/api/banners',     require('./routes/bannerRoutes'));

// ─── Root / Health ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: '🌱 Fresh Veggies API Server' });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: {
      NODE_ENV:        process.env.NODE_ENV,
      JWT_SECRET:      !!process.env.JWT_SECRET,
      MONGODB_URI:     !!process.env.MONGODB_URI,
      FRONTEND_URL:    process.env.FRONTEND_URL,
      RAZORPAY_KEY_ID: !!process.env.RAZORPAY_KEY_ID,
      WEBHOOK_SECRET:  !!process.env.RAZORPAY_WEBHOOK_SECRET
    }
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    mongoose.connection.close(false, () => process.exit(0));
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    mongoose.connection.close(false, () => process.exit(0));
  });
});
