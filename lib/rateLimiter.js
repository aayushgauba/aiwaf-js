const NodeCache = require('node-cache');
const blacklistManager = require('./blacklistManager');
const { getClient } = require('./redisClient');

const memoryCache = new NodeCache();
let opts;

module.exports = {
  async init(o) {
    opts = o;
  },

  async record(ip) {
    const now = Date.now().toString();
    const redis = getClient();

    if (redis) {
      try {
        const key = `ratelimit:${ip}`;
        await redis.lPush(key, now);
        await redis.expire(key, opts.WINDOW_SEC);
        const count = await redis.lLen(key);
        if (count > opts.FLOOD_REQ) await blacklistManager.block(ip, 'flood');
        return;
      } catch (err) {
        console.warn('⚠️ Redis error in record(). Using fallback.', err);
      }
    }

    const logs = memoryCache.get(ip) || [];
    logs.push(now);
    memoryCache.set(ip, logs, opts.WINDOW_SEC);
    if (logs.length > opts.FLOOD_REQ) await blacklistManager.block(ip, 'flood');
  },

  async isBlocked(ip) {
    if (await blacklistManager.isBlocked(ip)) return true;
    const now = Date.now();
    const redis = getClient();

    if (redis) {
      try {
        const key = `ratelimit:${ip}`;
        const timestamps = (await redis.lRange(key, 0, -1)).map(Number);
        const within = timestamps.filter(t => now - t < opts.WINDOW_SEC * 1000);
        return within.length > opts.MAX_REQ;
      } catch (err) {
        console.warn('⚠️ Redis error in isBlocked(). Using fallback.', err);
      }
    }

    const logs = memoryCache.get(ip) || [];
    const within = logs.filter(t => now - t < opts.WINDOW_SEC * 1000);
    return within.length > opts.MAX_REQ;
  }
};