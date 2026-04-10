const NodeCache = require('node-cache');
const blacklistManager = require('./blacklistManager');

let cacheBackend;
let opts;
let cleanupInterval;

const defaultMemoryCache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); // Auto cleanup every 2 minutes

const fallbackCache = {
  get: (key) => Promise.resolve(defaultMemoryCache.get(key)),
  set: (key, value, ttl) => Promise.resolve(defaultMemoryCache.set(key, value, ttl)),
  lPush: async (key, value) => {
    const arr = defaultMemoryCache.get(key) || [];
    arr.unshift(value);
    defaultMemoryCache.set(key, arr, opts.WINDOW_SEC * 2); // Keep for 2x window duration
  },
  expire: (key, ttl) => Promise.resolve(defaultMemoryCache.ttl(key, ttl)),
  lLen: async (key) => {
    const arr = defaultMemoryCache.get(key) || [];
    return arr.length;
  },
  lRange: async (key, start, end) => {
    const arr = defaultMemoryCache.get(key) || [];
    const normalizedEnd = end < 0 ? arr.length - 1 : end;
    return arr.slice(start, normalizedEnd + 1);
  }
};

// Additional cleanup for old timestamps within arrays
function cleanupOldTimestamps() {
  const now = Date.now();
  const cutoff = now - (opts.WINDOW_SEC * 2 * 1000); // Keep 2x window worth
  
  const keys = defaultMemoryCache.keys();
  for (const key of keys) {
    if (key.startsWith('ratelimit:')) {
      const arr = defaultMemoryCache.get(key);
      if (Array.isArray(arr)) {
        const filtered = arr.filter(timestamp => timestamp > cutoff);
        if (filtered.length !== arr.length) {
          if (filtered.length > 0) {
            defaultMemoryCache.set(key, filtered, opts.WINDOW_SEC * 2);
          } else {
            defaultMemoryCache.del(key);
          }
        }
      }
    }
  }
}

module.exports = {
  async init(o) {
    opts = {
      WINDOW_SEC: o?.WINDOW_SEC ?? 60,
      MAX_REQ: o?.MAX_REQ ?? 100,
      FLOOD_REQ: o?.FLOOD_REQ ?? 200,
      cache: o?.cache
    };
    const requiredOps = ['lPush', 'expire', 'lLen', 'lRange'];
    const externalCache = opts.cache;
    const hasRequiredOps = externalCache && requiredOps.every(op => typeof externalCache[op] === 'function');
    cacheBackend = hasRequiredOps ? externalCache : fallbackCache;
    
    // Start cleanup interval for fallback cache
    if (cacheBackend === fallbackCache && !cleanupInterval) {
      cleanupInterval = setInterval(cleanupOldTimestamps, 60000); // Cleanup every minute
      if (typeof cleanupInterval.unref === 'function') {
        cleanupInterval.unref();
      }
      console.log('Rate limiter memory cleanup enabled');
    }
  },

  async record(ip) {
    const now = Date.now().toString();

    try {
      const key = `ratelimit:${ip}`;
      await cacheBackend.lPush(key, now);
      await cacheBackend.expire(key, opts.WINDOW_SEC * 2); // Extended TTL
      const count = await cacheBackend.lLen(key);
      if (count > opts.FLOOD_REQ) {
        await blacklistManager.block(ip, 'flood');
      }
    } catch (err) {
      console.warn('⚠️ Cache error in record().', err.message);
    }
  },

  async isBlocked(ip) {
    try {
      if (await blacklistManager.isBlocked(ip)) return true;
    } catch (err) {
      console.warn('⚠️ Blacklist check error:', err.message);
    }

    try {
      const key = `ratelimit:${ip}`;
      const now = Date.now();
      const timestamps = (await cacheBackend.lRange(key, 0, -1)).map(Number);
      const within = timestamps.filter(t => now - t < opts.WINDOW_SEC * 1000);
      return within.length > opts.MAX_REQ;
    } catch (err) {
      console.warn('⚠️ Cache error in isBlocked().', err.message);
      return false; // Fail open
    }
  },

  // Cleanup method for graceful shutdown
  cleanup() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    if (defaultMemoryCache && typeof defaultMemoryCache.close === 'function') {
      defaultMemoryCache.close();
    }
  }
};
