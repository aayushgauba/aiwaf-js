const { connectRedis } = require('./redisClient');
const blacklistManager = require('./blacklistManager');

let redis, opts;

module.exports = {
  async init(o) {
    opts = o;

    try {
      redis = await connectRedis();
      console.log('✅ Redis connected.');
    } catch (err) {
      console.warn('⚠️ Redis connection failed. Continuing without Redis.', err);
    }
  },

  async record(ip) {
    if (!redis?.isOpen) return;

    const key = `ratelimit:${ip}`;
    const now = Date.now();
    await redis.lPush(key, now.toString()); // <- Ensure string input
    await redis.expire(key, opts.WINDOW_SEC);
    const count = await redis.lLen(key);

    if (count > opts.FLOOD_REQ) {
      await blacklistManager.block(ip, 'flood');
    }
  },

  async isBlocked(ip) {
    if (await blacklistManager.isBlocked(ip)) return true;
    if (!redis?.isOpen) return false;

    const key = `ratelimit:${ip}`;
    const now = Date.now();
    const timestamps = (await redis.lRange(key, 0, -1)).map(Number);
    const withinWindow = timestamps.filter(t => now - t < opts.WINDOW_SEC * 1000);
    return withinWindow.length > opts.MAX_REQ;
  }
};

