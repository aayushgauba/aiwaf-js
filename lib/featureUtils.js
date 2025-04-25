const STATIC_KW = ['.php', '.xmlrpc', 'wp-', '.env', '.git', '.bak', 'shell'];
const STATUS_IDX = ['200', '403', '404', '500'];
const defaultCache = new Map();
const { getClient } = require('./redisClient');

let customCache = null;

function init(opts = {}) {
  customCache = opts.cache || null;
}

async function extractFeatures(req) {
  const uri = req.path.toLowerCase();
  const redis = getClient();

  // Custom cache logic
  if (customCache?.get && customCache?.set) {
    const cached = await customCache.get(uri);
    if (cached) return cached;
  }

  // Redis check
  if (redis) {
    try {
      const cached = await redis.get(`features:${uri}`);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn('⚠️ Redis read failed. Falling back.', err);
    }
  }

  // Local cache fallback
  if (defaultCache.has(uri)) return defaultCache.get(uri);

  // Compute features
  const pathLen = uri.length;
  const kwHits = STATIC_KW.reduce((count, kw) => count + (uri.includes(kw) ? 1 : 0), 0);
  const statusIdx = STATUS_IDX.indexOf(String(req.res?.statusCode || 200));
  const rt = parseFloat(req.headers['x-response-time'] || '0');
  const burst = 0;
  const total404 = 0;
  const features = [pathLen, kwHits, statusIdx, rt, burst, total404];

  // Write back
  if (customCache?.set) {
    await customCache.set(uri, features);
  } else if (redis) {
    try {
      await redis.set(`features:${uri}`, JSON.stringify(features), { EX: 60 });
    } catch (err) {
      console.warn('⚠️ Redis write failed. Ignoring.', err);
    }
  }

  defaultCache.set(uri, features);
  return features;
}

module.exports = { extractFeatures, init };
