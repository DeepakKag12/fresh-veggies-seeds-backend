/**
 * In-process TTL cache for stats and aggregations.
 * Backed by cacheService with capacity protection.
 */
const cacheService = require('./cacheService');

module.exports = cacheService;
