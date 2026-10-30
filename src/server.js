const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { initSocket } = require('./socket');

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
]
  .filter(Boolean)
  .map((o) => o.replace(/\/+$/, ''));

const isProduction = process.env.NODE_ENV === 'production';

// Allow loopback (localhost/127.0.0.1) as well as private LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const isLocalOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);

const corsOptions = {
  origin: function (origin, callback) {
    // Non-browser or same-origin requests (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.trim().replace(/\/+$/, '');

    // Allow configured origins
    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    // Allow local development & local network mobile testing off-production
    if (!isProduction && isLocalOrigin(cleanOrigin)) {
      return callback(null, true);
    }

    // Preview deployments are useful during development, but must not become
    // trusted credentialed origins in production.
    if (!isProduction && /\.vercel\.app$/.test(cleanOrigin)) {
      return callback(null, true);
    }

    // Wildcard or non-production environment override
    if (process.env.FRONTEND_URL === '*' || !isProduction) {
      return callback(null, true);
    }

    console.warn(`⚠️  CORS: blocked origin ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma',
    'If-None-Match',
    'If-Modified-Since',
    'X-Refresh-Token',
    'x-no-compression',
    'X-Guest-Capability',
    'x-guest-capability',
    'X-Guest-Id',
    'x-guest-id'
  ],
  exposedHeaders: [
    'ETag',
    'Content-Length',
    'Content-Disposition',
    'X-Total-Count',
    'Cache-Control'
  ],
  maxAge: 86400, // 24 hours preflight cache
  optionsSuccessStatus: 204
};

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ─── Response Compression ────────────────────────────────────────────────────
// Gzip/Brotli compression cuts payload sizes for product/order/category JSON
// responses by ~75-85%, improving load times on mobile and slow networks.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

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

// Auth: 60 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envInt('RATE_LIMIT_AUTH', 60),
  message: { success: false, message: 'Too many auth attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
});

// Payment: 50 requests per 10 min
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: envInt('RATE_LIMIT_PAYMENT', 50),
  message: { success: false, message: 'Too many payment requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
});

// Order creation: 60 per 10 min
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: envInt('RATE_LIMIT_ORDER', 60),
  message: { success: false, message: 'Too many order requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
});

// General API: 2000 per 15 min (generous so mobile and desktop users browsing products never get IP blocked)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envInt('RATE_LIMIT_GENERAL', 2000),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
});

app.use('/api/', generalLimiter);

// ─── Caching policy ───────────────────────────────────────────────────────────
// Default: nothing under /api is cacheable. Public catalogue reads opt back in
// individually below via publicCache(). See middleware/cache.middleware.js for the rules.
const { noStore, publicCache } = require('./middleware/cache.middleware');
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
  const Order = require('./models/order.model');
  const Settings = require('./models/settings.model');
  const stockService = require('./services/stock.service');
  const couponService = require('./services/coupon.service');
  const cleanupAbandonedOrders = async () => {
    try {
      const settings = await Settings.getSingleton().catch(() => null);
      if (settings && !settings.orders.autoCancelUnpaidOrders) return;
      const ttlMinutes = settings?.orders?.unpaidOrderTimeoutMinutes || 30;
      const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);
      const abandonedOrders = await Order.find(
        { paymentMode: { $in: ['Online', 'UPI'] }, paymentStatus: 'Pending', createdAt: { $lt: cutoff } },
        { _id: 1, orderItems: 1, stockDecremented: 1, stockRestored: 1, couponUsed: 1, userId: 1 }
      );
      for (const order of abandonedOrders) {
        const updated = await Order.updateOne(
          { _id: order._id, paymentStatus: 'Pending' },
          { $set: { paymentStatus: 'Failed' } }
        );
        if (updated.modifiedCount !== 1) continue;
        await stockService.restoreStockAfterCancel(order);
        if (order.couponUsed?.couponId) {
          await couponService.releaseCoupon(order.couponUsed.couponId, order.userId, order._id);
        }
      }
      if (abandonedOrders.length > 0)
        console.log(`🧹 Cleaned up ${abandonedOrders.length} abandoned online order(s)`);
    } catch (err) {
      console.error('⚠️  Cleanup job error:', err.message);
    }
  };
  cleanupAbandonedOrders();
  setInterval(cleanupAbandonedOrders, 10 * 60 * 1000);

  const notificationDelivery = require('./services/order-notification-delivery.service');
  notificationDelivery.retryPending().catch((err) =>
    console.error('⚠️  Pending order notification retry failed:', err.message)
  );
  setInterval(() => notificationDelivery.retryPending().catch((err) =>
    console.error('⚠️  Pending order notification retry failed:', err.message)
  ), 5 * 60 * 1000);

  // ── Sync stock for products sold by package variants ──────────────────────
  const Product = require('./models/product.model');
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
app.get('/health/config', require('./middleware/auth.middleware').protect, require('./middleware/auth.middleware').admin, (req, res) => {
  res.status(200).json({
    NODE_ENV:        process.env.NODE_ENV,
    JWT_SECRET:      !!process.env.JWT_SECRET,
    MONGODB_URI:     !!process.env.MONGODB_URI,
    FRONTEND_URL:    process.env.FRONTEND_URL,
    RAZORPAY_KEY_ID: !!process.env.RAZORPAY_KEY_ID,
    WEBHOOK_SECRET:  !!process.env.RAZORPAY_WEBHOOK_SECRET,
    BREVO_SMTP:      !!process.env.BREVO_SMTP_USER
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

// ─── Audit Logging Middleware ────────────────────────────────────────────────
const auditMiddleware = require('./middleware/audit.middleware');
app.use('/api', auditMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth.routes');
app.use('/api/auth/login',         authLimiter);
app.use('/api/auth/register',      authLimiter);
app.use('/api/auth',               authRoutes);

// Categories route uses short cache so admin visibility toggles take effect promptly
app.use('/api/categories',  publicCache({ maxAge: 5, sMaxAge: 10, staleWhileRevalidate: 30 }), require('./routes/category.routes'));
// Products carry stock/price, so keep the window short. Order creation
// re-reads price and stock from the DB, so a stale list can never oversell.
// Catalogue windows are deliberately short. HTTP caches cannot be invalidated
// from the server, so these numbers are the only lever on how long an admin's
// edit stays invisible. The previous 600-900s stale-while-revalidate meant a
// price or photo change could take 15 minutes to reach shoppers — and made it
// look as though the change had not saved.
app.use('/api/products',    publicCache({ maxAge: 30,  sMaxAge: 60,  staleWhileRevalidate: 120 }), require('./routes/product.routes'));
app.use('/api/combos',      publicCache({ maxAge: 30,  sMaxAge: 60,  staleWhileRevalidate: 120 }), require('./routes/combo.routes'));
app.use('/api/orders',      orderLimiter, require('./routes/order.routes'));
app.use('/api/payments',    paymentLimiter, require('./routes/payment.routes'));
app.use('/api/admin',       require('./routes/admin.routes'));
app.use('/api/upload',      require('./routes/upload.routes'));
app.use('/api/coupons',     require('./routes/coupon.routes'));
app.use('/api/reviews',     require('./routes/review.routes'));
app.use('/api/banners',     publicCache({ maxAge: 120, sMaxAge: 300, staleWhileRevalidate: 600 }), require('./routes/banner.routes'));
app.use('/api/settings',    publicCache({ maxAge: 300, sMaxAge: 600, staleWhileRevalidate: 1800 }), require('./routes/settings.routes'));
app.use('/api/contact',     require('./routes/contact.routes'));
app.use('/api/chat',        require('./routes/chat.routes'));

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
const { notFound, errorHandler } = require('./middleware/error.middleware');
app.use(notFound);
app.use(errorHandler);

// ─── Start server (standalone server vs serverless function) ──────────────────
const PORT = process.env.PORT || 5000;
let server;

if (process.env.VERCEL) {
  // In Vercel serverless functions, Vercel invokes the exported app directly
  console.log('⚡ Running in Vercel serverless mode');
} else {
  server = http.createServer(app);
  initSocket(server, corsOptions);

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} (HTTP + WebSockets)`);
    connectDB().catch((err) => console.error('MongoDB initial connection error:', err.message));
  });

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
    server?.close(() => {
      mongoose.connection.close(false, () => process.exit(0));
    });
  });

  process.on('SIGINT', () => {
    server?.close(() => {
      mongoose.connection.close(false, () => process.exit(0));
    });
  });
}

module.exports = app;
