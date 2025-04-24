const STATIC_KW = ['.php', '.xmlrpc', 'wp-', '.env', '.git', '.bak', 'shell'];
const STATUS_IDX = ['200', '403', '404', '500'];
const localCache = new Map();
const { getClient } = require('./redisClient');

async function extractFeatures(req) {
  const uri = req.path.toLowerCase();
  const redis = getClient();

  if (redis) {
    try {
      const cached = await redis.get(`features:${uri}`);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn('⚠️ Redis read failed. Using fallback.', err);
    }
  }

  if (localCache.has(uri)) return localCache.get(uri);

  const pathLen = uri.length;
  const kwHits = STATIC_KW.reduce((count, kw) => count + (uri.includes(kw) ? 1 : 0), 0);
  const statusIdx = STATUS_IDX.indexOf(String(req.res?.statusCode || 200));
  const rt = parseFloat(req.headers['x-response-time'] || '0');
  const burst = 0;
  const total404 = 0;
  const features = [pathLen, kwHits, statusIdx, rt, burst, total404];

  if (redis) {
    try {
      await redis.set(`features:${uri}`, JSON.stringify(features), { EX: 60 });
    } catch (err) {
      console.warn('⚠️ Redis write failed. Ignoring.', err);
    }
  }

  localCache.set(uri, features);
  return features;
}

module.exports = { extractFeatures };