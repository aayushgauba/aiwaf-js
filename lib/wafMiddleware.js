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
const requestLogStore = require('./requestLogStore');
const { extractFeatures, init: initFeatureUtils, markRequestStart } = require('./featureUtils');
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
    const method = String(req.method || 'GET').toUpperCase();

    middlewareLogger.attach(req, res, { ip });
    markRequestStart(req);

    const deny = (status, code, reason, country = '') => {
      middlewareLogger.markBlocked(res, reason || code, country);
      if (shouldReturnJson(req, opts)) {
        return res.status(status).json({ error: code });
      }
      return res.status(status).send(code);
    };

    if (opts.AIWAF_METHOD_POLICY_ENABLED === true) {
      const allowed = (opts.AIWAF_ALLOWED_METHODS || ['GET', 'POST', 'HEAD', 'OPTIONS'])
        .map(m => String(m).toUpperCase());
      if (!allowed.includes(method)) {
        await blacklistManager.block(ip, `method_not_allowed:${method}`);
        return deny(405, 'blocked', `method_not_allowed:${method}`);
      }
    }

    if (await exemptions.isExemptRequest(ip, path)) {
      return next();
    }

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
      const status = honeypotResult.statusCode || 403;
      const code = honeypotResult.errorCode || 'bot_detected';
      return deny(status, code, honeypotResult.reason || 'honeypot');
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

    if (await uuidDetector.isSuspicious(req)) {
      await blacklistManager.block(ip, 'uuid');
      return deny(403, 'blocked', 'uuid');
    }

    if (!matchesKnownRoute(req.app, req.path || req.url || '/')) {
      const features = await extractFeatures(req);
      const isAnomaly = await anomalyDetector.isAnomalous(features);
      if (isAnomaly && anomalyDetector.hasModel()) {
        // Analyze recent behavior before blocking.
        const now = Date.now();
        const recentData = (await requestLogStore.recent(5000))
          .filter(row => row.ip_address === ip)
          .map(row => ({
            timestamp: row.created_at ? new Date(row.created_at).getTime() : now,
            path: row.path,
            status: Number(row.status || 0),
            responseTime: Number(row.response_time_ms || 0)
          }))
          .filter(entry => now - entry.timestamp <= 5 * 60 * 1000);

        const stats = anomalyDetector.analyzeRecentBehavior(recentData);
        if (stats && stats.should_block) {
          const reason = `AI anomaly + scanning 404s (total:${stats.max_404s}, scanning:${stats.scanning_404s}, kw:${stats.avg_kw_hits.toFixed(1)}, burst:${stats.avg_burst.toFixed(1)})`;
          await blacklistManager.block(ip, reason);
          return deny(403, 'blocked', 'anomaly');
        }
      } else if (!anomalyDetector.hasModel()) {
        // Conservative fallback: only block on strong indicators.
        const pathLower = String(req.path || req.url || '').toLowerCase();
        const kwHits = STATIC_KW.reduce((sum, kw) => sum + (pathLower.includes(kw) ? 1 : 0), 0);
        if (kwHits >= 3 && anomalyDetector.isScanningPath(pathLower)) {
          await blacklistManager.block(ip, `AI anomaly + scanning behavior (kw:${kwHits})`);
          return deny(403, 'blocked', 'anomaly');
        }
      }
    }

    res.on('finish', () => {
      const statusCode = Number(res.statusCode || 0);
      anomalyDetector.maybeLearnKeyword(req.path || req.url || '', statusCode, opts);
    });

    next();
  };
};
