// lib/wafMiddleware.js

const rateLimiter      = require('./rateLimiter');
const blacklistManager = require('./blacklistManager');
const keywordDetector  = require('./keywordDetector');
const dynamicKeyword   = require('./dynamicKeyword');
const honeypotDetector = require('./honeypotDetector');
const uuidDetector     = require('./uuidDetector');
const anomalyDetector  = require('./anomalyDetector');

module.exports = function aiwaf(opts = {}) {
  // initialize all sub‑modules
  rateLimiter.init(opts);
  keywordDetector.init(opts);
  dynamicKeyword.init(opts);
  honeypotDetector.init(opts);
  uuidDetector.init(opts);
  anomalyDetector.init(opts);

  return async (req, res, next) => {
    // honor X‑Forwarded‑For for tests or real proxies
    const ipHdr = req.headers['x-forwarded-for'];
    const ip    = ipHdr ? ipHdr.split(',')[0].trim() : req.ip;
    const path  = req.path.toLowerCase();

    // learn every request for dynamic keywords
    dynamicKeyword.learn(path);

    // 1) IP blacklist
    if (await blacklistManager.isBlocked(ip)) {
      return res.status(403).json({ error: 'blocked' });
    }

    // 2) Honeypot trap
    if (honeypotDetector.isTriggered(req)) {
      await blacklistManager.block(ip, 'honeypot');
      return res.status(403).json({ error: 'bot_detected' });
    }

    // 3) Rate limiting
    await rateLimiter.record(ip);

    // If recs > MAX_REQ but not yet blacklisted (flood), return 429
    if (await rateLimiter.isBlocked(ip)) {
      if (await blacklistManager.isBlocked(ip)) {
        return res.status(403).json({ error: 'blocked' });
      }
      return res.status(429).json({ error: 'too_many_requests' });
    }

    // 4) Static keyword
    const sk = keywordDetector.check(path);
    if (sk) {
      await blacklistManager.block(ip, `static:${sk}`);
      return res.status(403).json({ error: 'blocked' });
    }

    // 5) Dynamic keyword
    const dk = dynamicKeyword.check(path);
    if (dk) {
      await blacklistManager.block(ip, `dynamic:${dk}`);
      return res.status(403).json({ error: 'blocked' });
    }

    // 6) UUID tamper
    if (uuidDetector.isSuspicious(req)) {
      await blacklistManager.block(ip, 'uuid');
      return res.status(403).json({ error: 'blocked' });
    }

    // 7) Anomaly detection
    if (await anomalyDetector.isAnomalous(req)) {
      await blacklistManager.block(ip, 'anomaly');
      return res.status(403).json({ error: 'blocked' });
    }

    // no block, pass through
    next();
  };
};
