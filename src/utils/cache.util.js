/**
 * High-Performance In-Memory Cache Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides fast, thread-safe (single-process) in-memory caching with:
 * - TTL (time-to-live) expiration
 * - Bounded LRU/capacity guard (prevents unbounded memory growth)
 * - Key prefix invalidation
 * - `remember(key, ttlMs, producer)` pattern
 */

const crypto = require('crypto');

const MAX_ENTRIES = 1500;
const store = new Map();
const inFlight = new Map();

/**
 * Tiered TTL Presets with Distinct, Staggered Ranges
 * Different domains expire in different time horizons to prevent synchronized invalidation.
 */
const TTL_TIERS = {
  REALTIME_STATS: 20_000,      // 20s (Operational metrics, pending orders)
  LOW_STOCK: 35_000,           // 35s (Inventory alert warnings)
  STORE_CATALOG: 60_000,       // 60s (Product catalog listings)
  PRODUCT_DETAIL: 180_000,     // 3m  (Single product pages)
  REVENUE_ANALYTICS: 150_000,  // 2.5m (Financial ledger & revenue split)
  BEHAVIOR_ANALYTICS: 360_000, // 6m  (12-month trends, hourly heatmaps, state distribution)
  AUDIT_LOGS: 600_000,         // 10m (Audit history & delete logs)
};

/**
 * Applies randomized jitter (±18% spread) to stagger expiration times.
 * This prevents cache stampedes / thundering herds where multiple caches
 * expire simultaneously, protecting MongoDB from sudden load spikes.
 */
const withJitter = (baseTtlMs, spread = 0.18) => {
  if (typeof baseTtlMs !== 'number' || baseTtlMs <= 0) return 60_000;
  const minFactor = 1 - spread;
  const maxFactor = 1 + spread;
  const factor = minFactor + Math.random() * (maxFactor - minFactor);
  return Math.round(baseTtlMs * factor);
};

/**
 * Retrieve cached value if exists and not expired.
 * Evicts expired entries on touch.
 */
const get = (key) => {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
};

/**
 * Verify whether a cache key exists and is still valid without evicting.
 */
const isValid = (key) => {
  const hit = store.get(key);
  if (!hit) return false;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return false;
  }
  return true;
};

/**
 * Store a value with a specified TTL in milliseconds.
 * Enforces capacity limits and applies jitter to stagger expirations.
 */
const set = (key, value, ttlMs = 60000, applyJitter = true) => {
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }

  const finalTtl = applyJitter ? withJitter(ttlMs) : Math.max(100, ttlMs);
  const now = Date.now();

  store.set(key, {
    value,
    expires: now + finalTtl,
    createdAt: now,
    ttlMs: finalTtl,
  });
  return value;
};

/**
 * Invalidate all keys matching a prefix, or clear the entire store if no prefix given.
 */
const invalidate = (prefix) => {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
};

/**
 * Single-flight request coalescing:
 * Ensures that multiple concurrent requests for the exact same uncached key
 * share a single database execution instead of producing a thundering herd.
 */
const singleFlight = (key, producer) => {
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    try {
      return await producer();
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
};

/**
 * Helper to fetch from cache or execute producer and cache the result.
 */
const remember = async (key, ttlMs, producer) => {
  const cached = get(key);
  if (cached !== null) return cached;

  const fresh = await singleFlight(key, producer);
  if (fresh !== undefined && fresh !== null) {
    set(key, fresh, ttlMs);
  }
  return fresh;
};

/**
 * Deterministic ETag generation for HTTP conditional requests
 */
const generateETag = (data) => {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const hash = crypto.createHash('md5').update(json).digest('hex');
  return `W/"${hash.substring(0, 16)}"`;
};

/**
 * Multi-layer HTTP response caching with ETag 304 validation and single-flight coalescing
 */
const sendCachedResponse = async (req, res, cacheKey, producer, ttlMs = 60000) => {
  let payload = get(cacheKey);

  if (!payload) {
    payload = await singleFlight(cacheKey, producer);
    if (payload !== undefined && payload !== null) {
      set(cacheKey, payload, ttlMs);
    }
  }

  if (!payload) {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }

  const etag = generateETag(payload);
  const clientEtag = req.headers['if-none-match'];

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');

  // Standard pagination headers (FEAT-004)
  if (typeof payload.total === 'number') {
    res.setHeader('X-Total-Count', String(payload.total));
  }
  if (typeof payload.currentPage === 'number') {
    res.setHeader('X-Page', String(payload.currentPage));
  }
  if (typeof payload.limit === 'number') {
    res.setHeader('X-Limit', String(payload.limit));
  }
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Total-Count, X-Page, X-Limit');

  if (clientEtag && clientEtag === etag) {
    return res.status(304).end();
  }

  return res.status(200).json(payload);
};

/**
 * Return current cache statistics for monitoring/diagnostics.
 */
const getStats = () => {
  let active = 0;
  let expired = 0;
  const now = Date.now();
  for (const [, item] of store) {
    if (now > item.expires) expired++;
    else active++;
  }
  return { total: store.size, active, expired, inFlight: inFlight.size };
};

module.exports = {
  get,
  set,
  isValid,
  invalidate,
  singleFlight,
  remember,
  generateETag,
  sendCachedResponse,
  getStats,
  withJitter,
  TTL_TIERS,
};
