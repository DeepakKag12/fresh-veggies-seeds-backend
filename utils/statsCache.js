/**
 * Tiny in-process TTL cache for expensive read-only aggregations.
 *
 * The admin dashboard re-runs a dozen aggregations and auto-refreshes every
 * 30s; with several admins open that is a lot of identical work. A short TTL
 * keeps the numbers current while collapsing bursts into one query set.
 *
 * Deliberately in-process: no extra infrastructure, and a stale entry costs at
 * most `ttlMs`. Any write that would change the figures calls invalidate().
 */
const store = new Map();

const get = (key) => {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { store.delete(key); return null; }
  return hit.value;
};

const set = (key, value, ttlMs) => {
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
};

/** Drop everything, or just the keys starting with `prefix`. */
const invalidate = (prefix) => {
  if (!prefix) return store.clear();
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
};

/** Run `producer` unless a fresh cached value exists. */
const remember = async (key, ttlMs, producer) => {
  const cached = get(key);
  if (cached !== null) return cached;
  return set(key, await producer(), ttlMs);
};

module.exports = { get, set, invalidate, remember };
