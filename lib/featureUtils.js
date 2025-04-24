const STATIC_KW = ['.php', '.xmlrpc', 'wp-', '.env', '.git', '.bak', 'shell'];
const STATUS_IDX = ['200', '403', '404', '500'];

let useRedis = false;
let redisClient = null;
const localCache = new Map();

function enableRedis(redis) {
  if (!redis || !redis.isOpen) {
    console.warn('⚠️ Redis not connected. Falling back to in-memory cache.');
    return;
  }

  useRedis = true;
  redisClient = redis;
}

async function extractFeatures(req) {
  const uri = req.path.toLowerCase();

  // Try Redis read
  if (useRedis && redisClient?.isOpen) {
    try {
      const cached = await redisClient.get(`features:${uri}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('⚠️ Redis read failed. Disabling Redis cache.', err);
      useRedis = false;
    }
  }

  // Fallback to memory
  if (!useRedis && localCache.has(uri)) {
    return localCache.get(uri);
  }

  const pathLen = uri.length;
  const kwHits = STATIC_KW.reduce((count, kw) => count + (uri.includes(kw) ? 1 : 0), 0);
  const statusIdx = STATUS_IDX.indexOf(String(req.res?.statusCode || 200));
  const rt = parseFloat(req.headers['x-response-time'] || '0');
  const burst = 0;
  const total404 = 0;

  const features = [pathLen, kwHits, statusIdx, rt, burst, total404];

  // Try Redis write
  if (useRedis && redisClient?.isOpen) {
    try {
      await redisClient.set(`features:${uri}`, JSON.stringify(features), { EX: 60 });
    } catch (err) {
      console.warn('⚠️ Redis write failed. Disabling Redis cache.', err);
      useRedis = false;
    }
  }

  // Fallback write
  if (!useRedis) {
    localCache.set(uri, features);
  }

  return features;
}

module.exports = { extractFeatures, enableRedis };
