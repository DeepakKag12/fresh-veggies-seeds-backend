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

// Trust Vercel / proxy X-Forwarded-For headers (required for express-rate-limit
// to work correctly when the app is behind a reverse proxy or CDN)
app.set('trust proxy', 1);

// ─── CORS Configuration ───────────────────────────────────────────────────────
const allowedOrigins = [
  'https://fresh-veggies-seeds-frontend.vercel.app',
  'https://fresh-veggies-seeds-frontend-git-main-deepak-kags-projects.vercel.app',
  'https://www.freshveggies.me',
  'https://freshveggies.me',
  process.env.FRONTEND_URL,
  // Extra origins for a specific deployment, comma-separated.
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()),
].filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';

// In development the frontend moves between ports — 3000 for `npm start`, 4173
// or 5173 for a served build, whatever `serve` picks next. Hard-coding a couple
// of ports meant a normal local setup was blocked by CORS with no obvious
// cause. Any loopback origin is allowed off-production; production stays on the
// explicit allow-list.
const isLocalOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      (!isProduction && isLocalOrigin(origin)) ||
      /^https:\/\/fresh-veggies-seeds.*\.vercel\.app$/.test(origin)
    ) {
      return callback(null, true);
    }
    // Refuse without throwing: an Error here reaches the global handler and
    // prints a full stack for what is just a disallowed origin. The request
    // still fails the browser's CORS check, because no headers are sent.
    console.warn(`⚠️  CORS: blocked origin ${origin}`);
    return callback(null, false);
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
// Limits are env-tunable so they can be relaxed for automated tests and tuned
// per deployment (an office or campus behind one NAT IP shares a bucket), while
// the defaults stay at the conservative production values.
const envInt = (name, fallback) => {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Auth: 10 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envInt('RATE_LIMIT_AUTH', 10),
  message: { success: false, message: 'Too many auth attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// OTP: 5 sends per 10 min (per IP)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: envInt('RATE_LIMIT_OTP', 5),
  message: { success: false, message: 'Too many OTP requests. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Payment: 20 requests per 10 min
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: envInt('RATE_LIMIT_PAYMENT', 20),
  message: { success: false, message: 'Too many payment requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Order creation: 30 per 10 min
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: envInt('RATE_LIMIT_ORDER', 30),
  message: { success: false, message: 'Too many order requests.' },
  standardHeaders: true,
  legacyHeaders: false
});

// General API: 200 per 15 min
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envInt('RATE_LIMIT_GENERAL', 200),
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);

// ─── Caching policy ───────────────────────────────────────────────────────────
// Default: nothing under /api is cacheable. Public catalogue reads opt back in
// individually below via publicCache(). See middleware/cache.js for the rules.
const { noStore, publicCache } = require('./middleware/cache');
app.use('/api/', noStore);

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

  // ── Sync stock for products sold by package variants ──────────────────────
  const Product = require('./models/Product');
  const syncVariantStock = async () => {
    try {
      const prods = await Product.find({ 'packages.0': { $exists: true } });
      for (const p of prods) {
        const total = p.packages.reduce((sum, pkg) => sum + (Number(pkg.stock) || 0), 0);
        if (p.stock !== total) {
          await Product.updateOne({ _id: p._id }, { $set: { stock: total } });
          console.log(`📦 Synced variant stock for "${p.name}": was ${p.stock} → now ${total}`);
        }
      }
    } catch (err) {
      console.error('⚠️  Variant stock sync error:', err.message);
    }
  };
  syncVariantStock();
};

// ─── Health check ─────────────────────────────────────────────────────────────
// Deliberately mounted BEFORE the database gate below: a health endpoint that
// itself 500s when Mongo is unreachable cannot tell you Mongo is unreachable.
// It reports connection state instead, and returns 503 when degraded so load
// balancers and uptime monitors read it correctly.
//
// It no longer echoes which secrets are configured. That was unauthenticated,
// and told anyone who asked exactly which integrations were live.
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  const healthy = dbState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    database: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] ?? 'unknown',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Detailed configuration readiness — admin only, for debugging a deployment.
app.get('/health/config', require('./middleware/auth').protect, require('./middleware/auth').admin, (req, res) => {
  res.status(200).json({
    NODE_ENV:        process.env.NODE_ENV,
    JWT_SECRET:      !!process.env.JWT_SECRET,
    MONGODB_URI:     !!process.env.MONGODB_URI,
    FRONTEND_URL:    process.env.FRONTEND_URL,
    RAZORPAY_KEY_ID: !!process.env.RAZORPAY_KEY_ID,
    WEBHOOK_SECRET:  !!process.env.RAZORPAY_WEBHOOK_SECRET,
    BREVO_SMTP:      !!process.env.BREVO_SMTP_USER,
    ADMIN_WHATSAPP:  !!process.env.ADMIN_WHATSAPP_NUMBER
  });
});

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

// Categories change rarely — cache hard, revalidate lazily.
app.use('/api/categories',  publicCache({ maxAge: 300, sMaxAge: 600, staleWhileRevalidate: 1800 }), require('./routes/categoryRoutes'));
// Products carry stock/price, so keep the window short. Order creation
// re-reads price and stock from the DB, so a stale list can never oversell.
// Catalogue windows are deliberately short. HTTP caches cannot be invalidated
// from the server, so these numbers are the only lever on how long an admin's
// edit stays invisible. The previous 600-900s stale-while-revalidate meant a
// price or photo change could take 15 minutes to reach shoppers — and made it
// look as though the change had not saved.
app.use('/api/products',    publicCache({ maxAge: 30,  sMaxAge: 60,  staleWhileRevalidate: 120 }), require('./routes/productRoutes'));
app.use('/api/combos',      publicCache({ maxAge: 30,  sMaxAge: 60,  staleWhileRevalidate: 120 }), require('./routes/comboRoutes'));
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

// ─── 404 + global error handler (must be last) ────────────────────────────────
// The previous handler collapsed everything into a 500, so a bad ObjectId, a
// schema validation failure and a duplicate-key race all looked like server
// faults to the client. errorHandler maps each to its correct status code and
// keeps internal detail in the logs. notFound guarantees a JSON body for
// unmatched routes instead of Express's HTML error page.
const { notFound, errorHandler } = require('./middleware/errorHandler');
app.use(notFound);
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// A port clash is an everyday development situation, not a crash worth an
// unhandled 'error' event and a stack trace. Say what happened and how to fix
// it, then exit cleanly.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n✖  Port ${PORT} is already in use.\n` +
      `   Another server is running. Stop it, or start this one on a different port:\n` +
      `     lsof -ti:${PORT} | xargs kill -9     # stop whatever is using it\n` +
      `     PORT=5001 npm run dev                # or use another port\n`
    );
  } else if (err.code === 'EACCES') {
    console.error(`\n✖  Not permitted to bind port ${PORT}. Use a port above 1024.\n`);
  } else {
    console.error('\n✖  Server failed to start:', err.message, '\n');
  }
  process.exit(1);
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
