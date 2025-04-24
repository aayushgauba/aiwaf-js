const { createClient } = require('redis');
const NodeCache = require('node-cache');
const blacklistManager = require('./blacklistManager');

let redis, useRedis = false;
const memoryCache = new NodeCache();
let opts;

module.exports = {
  async init(o) {
    opts = o;
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      try {
        if (!redis) {
          redis = createClient({ url: redisUrl });
          redis.on('error', err => console.warn('⚠️ Redis error:', err));
        }

        if (!redis.isOpen) {
          await redis.connect();
        }

        useRedis = true;
        console.log('✅ Redis connected.');
      } catch (err) {
        console.warn('⚠️ Redis connection failed. Using in-memory fallback.', err);
        useRedis = false;
      }
    } else {
      console.warn('⚠️ No REDIS_URL set. Using in-memory fallback.');
    }
  },

  async record(ip) {
    const now = Date.now();

    if (useRedis && redis?.isOpen) {
      try {
        const key = `ratelimit:${ip}`;
        await redis.lPush(key, now);
        await redis.expire(key, opts.WINDOW_SEC);
        const count = await redis.lLen(key);

        if (count > opts.FLOOD_REQ) {
          await blacklistManager.block(ip, 'flood');
        }
      } catch (err) {
        console.warn('⚠️ Redis error in record(). Falling back to memory.', err);
        useRedis = false;
        await this.record(ip); // retry in-memory
      }
    } else {
      const logs = memoryCache.get(ip) || [];
      logs.push(now);
      memoryCache.set(ip, logs, opts.WINDOW_SEC);
      if (logs.length > opts.FLOOD_REQ) {
        await blacklistManager.block(ip, 'flood');
      }
    }
  },

  async isBlocked(ip) {
    if (await blacklistManager.isBlocked(ip)) return true;
    const now = Date.now();

    if (useRedis && redis?.isOpen) {
      try {
        const key = `ratelimit:${ip}`;
        const timestamps = (await redis.lRange(key, 0, -1)).map(Number);
        const within = timestamps.filter(t => now - t < opts.WINDOW_SEC * 1000);
        return within.length > opts.MAX_REQ;
      } catch (err) {
        console.warn('⚠️ Redis error in isBlocked(). Using memory fallback.', err);
        useRedis = false;
        return this.isBlocked(ip);
      }
    } else {
      const logs = memoryCache.get(ip) || [];
      const within = logs.filter(t => now - t < opts.WINDOW_SEC * 1000);
      return within.length > opts.MAX_REQ;
    }
  }
};
