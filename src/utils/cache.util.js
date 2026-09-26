/**
 * High-Performance In-Memory Cache Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides fast, thread-safe (single-process) in-memory caching with:
 * - TTL (time-to-live) expiration
 * - Bounded LRU/capacity guard (prevents unbounded memory growth)
 * - Key prefix invalidation
 * - `remember(key, ttlMs, producer)` pattern
 */

const MAX_ENTRIES = 1500;
const store = new Map();

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
 * Store a value with a specified TTL in milliseconds.
 * Enforces a capacity limit to protect against memory leaks.
 */
const set = (key, value, ttlMs = 60000) => {
  // If capacity exceeded, evict the oldest key (FIFO/LRU-approximate via Map iterator)
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }

  store.set(key, {
    value,
    expires: Date.now() + Math.max(100, ttlMs),
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
 * Helper to fetch from cache or execute producer and cache the result.
 */
const remember = async (key, ttlMs, producer) => {
  const cached = get(key);
  if (cached !== null) return cached;

  const fresh = await producer();
  if (fresh !== undefined && fresh !== null) {
    set(key, fresh, ttlMs);
  }
  return fresh;
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
  return { total: store.size, active, expired };
};

module.exports = {
  get,
  set,
  invalidate,
  remember,
  getStats,
};
