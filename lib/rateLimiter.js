const NodeCache = require('node-cache');
const blacklistManager = require('./blacklistManager');

let cacheBackend;
let opts;

const defaultMemoryCache = new NodeCache();
const fallbackCache = {
  get: (key) => Promise.resolve(defaultMemoryCache.get(key)),
  set: (key, value, ttl) => Promise.resolve(defaultMemoryCache.set(key, value, ttl)),
  lPush: async (key, value) => {
    const arr = defaultMemoryCache.get(key) || [];
    arr.unshift(value);
    defaultMemoryCache.set(key, arr, opts.WINDOW_SEC);
  },
  expire: (key, ttl) => Promise.resolve(defaultMemoryCache.ttl(key, ttl)),
  lLen: async (key) => {
    const arr = defaultMemoryCache.get(key) || [];
    return arr.length;
  },
  lRange: async (key, start, end) => {
    const arr = defaultMemoryCache.get(key) || [];
    return arr.slice(start, end + 1);
  }
};

module.exports = {
  async init(o) {
    opts = o;
    cacheBackend = o.cache || fallbackCache;
  },

  async record(ip) {
    const now = Date.now().toString();

    try {
      const key = `ratelimit:${ip}`;
      await cacheBackend.lPush(key, now);
      await cacheBackend.expire(key, opts.WINDOW_SEC);
      const count = await cacheBackend.lLen(key);
      if (count > opts.FLOOD_REQ) {
        await blacklistManager.block(ip, 'flood');
      }
    } catch (err) {
      console.warn('⚠️ Cache error in record().', err);
    }
  },

  async isBlocked(ip) {
    if (await blacklistManager.isBlocked(ip)) return true;

    try {
      const key = `ratelimit:${ip}`;
      const now = Date.now();
      const timestamps = (await cacheBackend.lRange(key, 0, -1)).map(Number);
      const within = timestamps.filter(t => now - t < opts.WINDOW_SEC * 1000);
      return within.length > opts.MAX_REQ;
    } catch (err) {
      console.warn('⚠️ Cache error in isBlocked().', err);
      return false;
    }
  }
};
