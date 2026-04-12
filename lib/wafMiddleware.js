const rateLimiter = require('./rateLimiter');
const blacklistManager = require('./blacklistManager');
const keywordDetector = require('./keywordDetector');
const dynamicKeyword = require('./dynamicKeyword');
const dynamicKeywordStore = require('./dynamicKeywordStore');
const honeypotDetector = require('./honeypotDetector');
const uuidDetector = require('./uuidDetector');
const anomalyDetector = require('./anomalyDetector');
const headerValidation = require('./headerValidation');
const geoBlocker = require('./geoBlocker');
const middlewareLogger = require('./middlewareLogger');
const exemptions = require('./exemptions');
const requestLogStore = require('./requestLogStore');
const { extractFeatures, init: initFeatureUtils, markRequestStart, STATIC_KW } = require('./featureUtils');
const { normalizeSettings } = require('./settingsCompat');
const {
  validateHeaders: wasmValidateHeaders,
  validateUrl: wasmValidateUrl,
  validateContent: wasmValidateContent,
  validateRecent: wasmValidateRecent
} = require('./wasmAdapter');

function knownRoutes(app) {
  // Skip route checking if app is undefined (common in proxy setups)
  if (!app) return [];
  const stack = app?._router?.stack || [];
  return stack
    .filter(layer => layer.route && layer.route.path)
    .map(layer => layer.route.path);
}

function matchesKnownRoute(app, path) {
  // In proxy setups, req.app may be undefined or not have routes
  // Return true (treat as known) to skip anomaly detection on proxies
  if (!app || !app._router || !app._router.stack) {
    if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
      console.error(`[AIWAF-ROUTE-CHECK] app=${!!app} app._router=${!!app?._router} returning true (proxy setup)`);
    }
    return true;
  }
  
  const routes = knownRoutes(app);
  
  // If no routes found, assume this is a proxy setup and allow traffic
  if (routes.length === 0) {
    if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
      console.error(`[AIWAF-ROUTE-CHECK] no routes found, returning true (proxy setup)`);
    }
    return true;
  }
  
  const result = routes.some(route => {
    const regex = new RegExp(`^${String(route).replace(/:\\w+/g, '[^/]+')}$`);
    return regex.test(path);
  });
  
  if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
    console.error(`[AIWAF-ROUTE-CHECK] path=${path} matched=${result}`);
  }
  
  return result;
}

function shouldReturnJson(req, opts) {
  if (opts.AIWAF_FORCE_JSON_ERRORS) return true;
  const accepts = req.headers?.accept || '';
  const contentType = req.headers?.['content-type'] || '';
  return accepts.includes('application/json') || contentType.includes('application/json') || req.xhr;
}

function normalizeHeaders(rawHeaders) {
  return Object.fromEntries(
    Object.entries(rawHeaders || {}).map(([key, value]) => {
      let normalizedValue = value;
      if (Array.isArray(normalizedValue)) {
        normalizedValue = normalizedValue.join(', ');
      } else if (normalizedValue !== undefined && normalizedValue !== null) {
        normalizedValue = String(normalizedValue);
      }
      return [String(key).toLowerCase(), normalizedValue];
    })
  );
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

  if (opts.AIWAF_CLEAR_STATE_ON_START) {
    Promise.allSettled([
      blacklistManager.clear(),
      requestLogStore.clear(),
      dynamicKeywordStore.clear()
    ]).catch(() => {});
  }

  return async (req, res, next) => {
    const ipHdr = req.headers['x-forwarded-for'];
    const ip = ipHdr ? ipHdr.split(',')[0].trim() : req.ip;
    const path = String(req.path || req.url || '/').toLowerCase();
    const method = String(req.method || 'GET').toUpperCase();
    
    // Debug: Log first character of path to ensure it's being captured
    if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
      console.error(`[AIWAF-DEBUG] method=${method} path=${path} req.path=${req.path} req.url=${req.url} ip=${ip} req.ip=${req.ip} x-forwarded-for=${ipHdr}`);
    }

    middlewareLogger.attach(req, res, { ip });
    markRequestStart(req);

    const deny = (status, code, reason, country = '') => {
      middlewareLogger.markBlocked(res, reason || code, country);
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK] status=${status} code=${code} reason=${reason} ip=${ip}`);
      }
      if (shouldReturnJson(req, opts)) {
        res.status(status).json({ error: code });
      } else {
        res.status(status).send(code);
      }
    };

    if (opts.AIWAF_METHOD_POLICY_ENABLED === true) {
      const allowed = (opts.AIWAF_ALLOWED_METHODS || ['GET', 'POST', 'HEAD', 'OPTIONS'])
        .map(m => String(m).toUpperCase());
      if (!allowed.includes(method)) {
        if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
          console.error(`[AIWAF-BLOCK-METHOD] method=${method} not in allowed=${allowed.join(',')}`);
        }
        await blacklistManager.block(ip, `method_not_allowed:${method}`);
        return deny(405, 'blocked', `method_not_allowed:${method}`);
      }
    }

    if (await exemptions.isExemptRequest(ip, path)) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-EXEMPT] path=${path}`);
      }
      return next();
    }

    if (await blacklistManager.isBlocked(ip)) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-BLACKLIST] ip=${ip}`);
      }
      return deny(403, 'blocked', 'blacklist');
    }

    const headerReason = headerValidation.validate(req);
    if (headerReason) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-HEADER] reason=${headerReason}`);
      }
      await blacklistManager.block(ip, headerReason);
      return deny(403, 'blocked', headerReason);
    }

    const wasmValidationEnabled = opts.AIWAF_WASM_VALIDATION !== false;
    const wasmHeaderValidationEnabled = opts.AIWAF_WASM_HEADER_VALIDATION !== false;
    if (wasmValidationEnabled) {
      const pathForHeaders = req.path || req.url || '';
      const wasmConfig = headerValidation.getWasmConfig(req.method);
      const shouldSkipWasmHeaders = headerValidation.isStaticRequest(pathForHeaders);
      const headerWasmReason = (shouldSkipWasmHeaders || !wasmHeaderValidationEnabled)
        ? null
        : await wasmValidateHeaders(normalizeHeaders(req.headers || {}), wasmConfig);
      if (headerWasmReason) {
        if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
          console.error(`[AIWAF-BLOCK-WASM-HEADER] reason=${headerWasmReason}`);
        }
        await blacklistManager.block(ip, `wasm_header:${headerWasmReason}`);
        return deny(403, 'blocked', `wasm_header:${headerWasmReason}`);
      }

      const host = req.headers?.host || '';
      const urlPath = req.originalUrl || req.url || '/';
      const protocol = req.protocol || (req.headers?.['x-forwarded-proto'] || 'http');
      const fullUrl = host ? `${protocol}://${host}${urlPath}` : urlPath;
      const urlWasmReason = await wasmValidateUrl(fullUrl);
      if (urlWasmReason) {
        if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
          console.error(`[AIWAF-BLOCK-WASM-URL] reason=${urlWasmReason}`);
        }
        await blacklistManager.block(ip, `wasm_url:${urlWasmReason}`);
        return deny(403, 'blocked', `wasm_url:${urlWasmReason}`);
      }

      if (req.body !== undefined && req.body !== null) {
        let content = req.body;
        if (Buffer.isBuffer(content)) {
          content = content.toString('utf8');
        } else if (typeof content === 'object') {
          try {
            content = JSON.stringify(content);
          } catch (err) {
            content = String(content);
          }
        } else {
          content = String(content);
        }

        if (content && content.length) {
          const contentWasmReason = await wasmValidateContent(content);
          if (contentWasmReason) {
            if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
              console.error(`[AIWAF-BLOCK-WASM-CONTENT] reason=${contentWasmReason}`);
            }
            await blacklistManager.block(ip, `wasm_content:${contentWasmReason}`);
            return deny(403, 'blocked', `wasm_content:${contentWasmReason}`);
          }
        }
      }

      if (opts.AIWAF_WASM_VALIDATE_RECENT) {
        const recentRows = await requestLogStore.recent(200);
        const recent = recentRows
          .filter(row => row.ip_address === ip)
          .map(row => ({ path: row.path, status: Number(row.status || 0) }));
        if (recent.length) {
          const recentWasmReason = await wasmValidateRecent(recent);
          if (recentWasmReason) {
            if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
              console.error(`[AIWAF-BLOCK-WASM-RECENT] reason=${recentWasmReason}`);
            }
            await blacklistManager.block(ip, `wasm_recent:${recentWasmReason}`);
            return deny(403, 'blocked', `wasm_recent:${recentWasmReason}`);
          }
        }
      }
    }

    const geoResult = await geoBlocker.check(req);
    if (geoResult.blocked) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-GEO] reason=${geoResult.reason}`);
      }
      await blacklistManager.block(ip, geoResult.reason || 'geo_block');
      return deny(403, 'blocked', geoResult.reason || 'geo_block', geoResult.country);
    }

    const honeypotResult = honeypotDetector.evaluate(req, ip, path);
    if (honeypotResult.triggered) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-HONEYPOT] reason=${honeypotResult.reason}`);
      }
      await blacklistManager.block(ip, honeypotResult.reason || 'honeypot');
      const status = honeypotResult.statusCode || 403;
      const code = honeypotResult.errorCode || 'bot_detected';
      return deny(status, code, honeypotResult.reason || 'honeypot');
    }

    await rateLimiter.record(ip);

    if (await rateLimiter.isBlocked(ip)) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-RATE] ip=${ip}`);
      }
      if (await blacklistManager.isBlocked(ip)) {
        return deny(403, 'blocked', 'flood_or_blacklist');
      }
      return deny(429, 'too_many_requests', 'rate_limit');
    }

    const staticMatch = keywordDetector.check(path);
    if (staticMatch && !exemptions.shouldSkipKeyword(staticMatch, path)) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-STATIC-KW] match=${staticMatch}`);
      }
      await blacklistManager.block(ip, `static:${staticMatch}`);
      return deny(403, 'blocked', `static:${staticMatch}`);
    }

    const dynamicMatch = dynamicKeyword.check(path);
    if (dynamicMatch && !exemptions.shouldSkipKeyword(dynamicMatch, path)) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-DYNAMIC-KW] match=${dynamicMatch}`);
      }
      await blacklistManager.block(ip, `dynamic:${dynamicMatch}`);
      return deny(403, 'blocked', `dynamic:${dynamicMatch}`);
    }

    if (await uuidDetector.isSuspicious(req)) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-BLOCK-UUID]`);
      }
      await blacklistManager.block(ip, 'uuid');
      return deny(403, 'blocked', 'uuid');
    }

    if (!matchesKnownRoute(req.app, req.path || req.url || '/')) {
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-ANOMALY-CHECK] path=${req.path || req.url} has no known route`);
      }
      const features = await extractFeatures(req);
      const isAnomaly = await anomalyDetector.isAnomalous(features);
      if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
        console.error(`[AIWAF-ANOMALY-RESULT] isAnomaly=${isAnomaly} hasModel=${anomalyDetector.hasModel()} isSufficient=${anomalyDetector.isModelSufficientlyTrained()}`);
      }
      if (isAnomaly && anomalyDetector.isModelSufficientlyTrained()) {
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
        if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
          console.error(`[AIWAF-ANOMALY-STATS] should_block=${stats?.should_block}`);
        }
        if (stats && stats.should_block) {
          const reason = `AI anomaly + scanning 404s (total:${stats.max_404s}, scanning:${stats.scanning_404s}, kw:${stats.avg_kw_hits.toFixed(1)}, burst:${stats.avg_burst.toFixed(1)})`;
          if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
            console.error(`[AIWAF-ANOMALY-BLOCKING] reason=${reason}`);
          }
          await blacklistManager.block(ip, reason);
          return deny(403, 'blocked', 'anomaly');
        }
      } else if (!anomalyDetector.isModelSufficientlyTrained()) {
        // No sufficient model - skip aggressive anomaly detection
        // Fallback is disabled until we have at least 10k training samples
        if (process.env.AIWAF_DEBUG_MIDDLEWARE) {
          console.error(`[AIWAF-ANOMALY-FALLBACK-DISABLED] No sufficiently trained model available - skipping fallback`);
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
