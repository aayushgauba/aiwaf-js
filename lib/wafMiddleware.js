const rateLimiter      = require('./rateLimiter');
const blacklistManager = require('./blacklistManager');
const keywordDetector  = require('./keywordDetector');
const dynamicKeyword   = require('./dynamicKeyword');
const honeypotDetector = require('./honeypotDetector');
const uuidDetector     = require('./uuidDetector');
const anomalyDetector  = require('./anomalyDetector');
const { extractFeatures } = require('./featureUtils');

module.exports = function aiwaf(opts = {}) {
  rateLimiter.init(opts);
  keywordDetector.init(opts);
  dynamicKeyword.init(opts);
  honeypotDetector.init(opts);
  uuidDetector.init(opts);
  anomalyDetector.init(opts);

  return async (req, res, next) => {
    const ipHdr = req.headers['x-forwarded-for'];
    const ip    = ipHdr ? ipHdr.split(',')[0].trim() : req.ip;
    const path  = req.path.toLowerCase();

    dynamicKeyword.learn(path);

    if (await blacklistManager.isBlocked(ip)) {
      return res.status(403).json({ error: 'blocked' });
    }

    if (honeypotDetector.isTriggered(req)) {
      await blacklistManager.block(ip, 'honeypot');
      return res.status(403).json({ error: 'bot_detected' });
    }

    await rateLimiter.record(ip);

    if (await rateLimiter.isBlocked(ip)) {
      if (await blacklistManager.isBlocked(ip)) {
        return res.status(403).json({ error: 'blocked' });
      }
      return res.status(429).json({ error: 'too_many_requests' });
    }

    const sk = keywordDetector.check(path);
    if (sk) {
      await blacklistManager.block(ip, `static:${sk}`);
      return res.status(403).json({ error: 'blocked' });
    }

    const dk = dynamicKeyword.check(path);
    if (dk) {
      await blacklistManager.block(ip, `dynamic:${dk}`);
      return res.status(403).json({ error: 'blocked' });
    }

    if (uuidDetector.isSuspicious(req)) {
      await blacklistManager.block(ip, 'uuid');
      return res.status(403).json({ error: 'blocked' });
    }

    // ✅ Anomaly detection only for unknown routes
    const knownRoutes = req.app._router.stack
      .filter(r => r.route && r.route.path)
      .map(r => r.route.path);

    const matchesKnown = knownRoutes.some(route => {
      const pattern = new RegExp('^' + route.replace(/:\w+/g, '[^/]+') + '$');
      return pattern.test(req.path);
    });

    if (!matchesKnown) {
      const features = extractFeatures(req);
      if (await anomalyDetector.isAnomalous(features)) {
        await blacklistManager.block(ip, 'anomaly');
        return res.status(403).json({ error: 'blocked' });
      }
    }

    next();
  };
};
