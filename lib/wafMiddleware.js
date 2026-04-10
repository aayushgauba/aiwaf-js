const rateLimiter = require('./rateLimiter');
const blacklistManager = require('./blacklistManager');
const keywordDetector = require('./keywordDetector');
const dynamicKeyword = require('./dynamicKeyword');
const honeypotDetector = require('./honeypotDetector');
const uuidDetector = require('./uuidDetector');
const anomalyDetector = require('./anomalyDetector');
const headerValidation = require('./headerValidation');
const geoBlocker = require('./geoBlocker');
const middlewareLogger = require('./middlewareLogger');
const exemptions = require('./exemptions');
const { extractFeatures, init: initFeatureUtils } = require('./featureUtils');
const { normalizeSettings } = require('./settingsCompat');

function knownRoutes(app) {
  const stack = app?._router?.stack || [];
  return stack
    .filter(layer => layer.route && layer.route.path)
    .map(layer => layer.route.path);
}

function matchesKnownRoute(app, path) {
  const routes = knownRoutes(app);
  return routes.some(route => {
    const regex = new RegExp(`^${String(route).replace(/:\\w+/g, '[^/]+')}$`);
    return regex.test(path);
  });
}

function shouldReturnJson(req, opts) {
  if (opts.AIWAF_FORCE_JSON_ERRORS) return true;
  const accepts = req.headers?.accept || '';
  const contentType = req.headers?.['content-type'] || '';
  return accepts.includes('application/json') || contentType.includes('application/json') || req.xhr;
}

module.exports = function aiwaf(rawOpts = {}) {
  const opts = normalizeSettings(rawOpts);

  rateLimiter.init(opts);
  keywordDetector.init(opts);
  dynamicKeyword.init(opts);
  honeypotDetector.init(opts);
  uuidDetector.init(opts);
  anomalyDetector.init(opts);
  initFeatureUtils(opts);
  headerValidation.init(opts);
  geoBlocker.init(opts);
  middlewareLogger.init(opts);
  exemptions.init(opts);

  return async (req, res, next) => {
    const ipHdr = req.headers['x-forwarded-for'];
    const ip = ipHdr ? ipHdr.split(',')[0].trim() : req.ip;
    const path = String(req.path || req.url || '/').toLowerCase();

    middlewareLogger.attach(req, res, { ip });

    const deny = (status, code, reason, country = '') => {
      middlewareLogger.markBlocked(res, reason || code, country);
      if (shouldReturnJson(req, opts)) {
        return res.status(status).json({ error: code });
      }
      return res.status(status).send(code);
    };

    if (await exemptions.isExemptRequest(ip, path)) {
      return next();
    }

    dynamicKeyword.learn(path);

    if (await blacklistManager.isBlocked(ip)) {
      return deny(403, 'blocked', 'blacklist');
    }

    const headerReason = headerValidation.validate(req);
    if (headerReason) {
      await blacklistManager.block(ip, headerReason);
      return deny(403, 'blocked', headerReason);
    }

    const geoResult = await geoBlocker.check(req);
    if (geoResult.blocked) {
      await blacklistManager.block(ip, geoResult.reason || 'geo_block');
      return deny(403, 'blocked', geoResult.reason || 'geo_block', geoResult.country);
    }

    const honeypotResult = honeypotDetector.evaluate(req, ip, path);
    if (honeypotResult.triggered) {
      await blacklistManager.block(ip, honeypotResult.reason || 'honeypot');
      return deny(403, 'bot_detected', honeypotResult.reason || 'honeypot');
    }

    await rateLimiter.record(ip);

    if (await rateLimiter.isBlocked(ip)) {
      if (await blacklistManager.isBlocked(ip)) {
        return deny(403, 'blocked', 'flood_or_blacklist');
      }
      return deny(429, 'too_many_requests', 'rate_limit');
    }

    const staticMatch = keywordDetector.check(path);
    if (staticMatch && !exemptions.shouldSkipKeyword(staticMatch, path)) {
      await blacklistManager.block(ip, `static:${staticMatch}`);
      return deny(403, 'blocked', `static:${staticMatch}`);
    }

    const dynamicMatch = dynamicKeyword.check(path);
    if (dynamicMatch && !exemptions.shouldSkipKeyword(dynamicMatch, path)) {
      await blacklistManager.block(ip, `dynamic:${dynamicMatch}`);
      return deny(403, 'blocked', `dynamic:${dynamicMatch}`);
    }

    if (uuidDetector.isSuspicious(req)) {
      await blacklistManager.block(ip, 'uuid');
      return deny(403, 'blocked', 'uuid');
    }

    if (!matchesKnownRoute(req.app, req.path || req.url || '/')) {
      const features = await extractFeatures(req);
      if (await anomalyDetector.isAnomalous(features)) {
        await blacklistManager.block(ip, 'anomaly');
        return deny(403, 'blocked', 'anomaly');
      }
    }

    next();
  };
};
