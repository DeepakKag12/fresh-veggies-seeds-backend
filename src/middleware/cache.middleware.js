/**
 * HTTP Cache-Control middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Two helpers that decide how browsers and the CDN (Vercel edge) are allowed to
 * store our JSON responses.
 *
 *   noStore()      → the safe default. Applied to every /api route so that any
 *                    endpoint we forget about is never cached anywhere.
 *   publicCache()  → opt-in, for genuinely public catalogue reads only.
 *
 * Safety rules baked into publicCache — all four must hold or we fall through
 * to the no-store default:
 *
 *   1. GET/HEAD only          — mutations are never cacheable.
 *   2. No Authorization header — a logged-in user (and every admin) always gets
 *                               fresh data, and no personalised response can
 *                               ever land in a shared cache.
 *   3. 2xx responses only     — the header is attached at res.json() time, so a
 *                               404/500 keeps the no-store default and errors
 *                               are never cached at the edge.
 *   4. Vary: Origin, Authorization — CORS echoes the request origin, so a shared
 *                               cache must key on it rather than serve one
 *                               origin's response to another.
 *
 * Correctness note: Express already emits a weak ETag for every JSON response.
 * Pairing that with a max-age turns a repeat request into a 304 Not Modified
 * with an empty body once the freshness window lapses, instead of a full
 * re-download.
 */

/**
 * Forbid all caching. Use for anything authenticated, personalised or
 * transactional (auth, cart, orders, payments, admin).
 */
const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

/**
 * Allow shared caching of a public read.
 *
 * @param {object}  opts
 * @param {number}  opts.maxAge                - browser freshness, seconds
 * @param {number}  opts.sMaxAge               - CDN freshness, seconds (default: maxAge)
 * @param {number}  opts.staleWhileRevalidate  - grace window the CDN may serve
 *                                               stale content while it refreshes
 */
const publicCache = ({ maxAge = 60, sMaxAge, staleWhileRevalidate = 300 } = {}) => {
  const shared = sMaxAge === undefined ? maxAge : sMaxAge;
  const value =
    `public, max-age=${maxAge}, s-maxage=${shared}, stale-while-revalidate=${staleWhileRevalidate}`;

  return (req, res, next) => {
    // Rule 1 + 2 — anything else keeps the no-store default set upstream.
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.authorization) return next();

    // Rule 4 — must be set even on the responses we end up not caching, so a
    // shared cache never mixes up variants.
    res.vary('Origin');
    res.vary('Authorization');
    res.vary('Accept-Encoding');

    // Rule 3 — swap the header in only once we know the status code, which
    // controllers set via res.status(...) immediately before res.json(...).
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.set('Cache-Control', value);
        res.removeHeader('Pragma');
        res.removeHeader('Expires');
      }
      return json(body);
    };

    next();
  };
};

module.exports = { noStore, publicCache };
