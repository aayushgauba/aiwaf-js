let config = {
  field: undefined,
  minFormTimeMs: 0,
  maxPageTimeMs: 3600 * 1000
};

const lastGetByKey = new Map();

function getKey(ip, path) {
  return `${ip || 'unknown'}:${path || ''}`;
}

module.exports = {
  init(opts = {}) {
    config = {
      field: opts.HONEYPOT_FIELD,
      minFormTimeMs: Math.max(0, Number(opts.AIWAF_MIN_FORM_TIME || 0) * 1000),
      maxPageTimeMs: Math.max(0, Number(opts.AIWAF_MAX_PAGE_TIME || 3600) * 1000)
    };
  },

  evaluate(req, ip, path) {
    const method = String(req.method || 'GET').toUpperCase();
    const key = getKey(ip, path);

    if (method === 'GET') {
      lastGetByKey.set(key, Date.now());
      return { triggered: false };
    }

    if (config.field && req.body && req.body[config.field]) {
      return { triggered: true, reason: 'honeypot_field' };
    }

    if (method === 'POST' && (config.minFormTimeMs > 0 || config.maxPageTimeMs > 0)) {
      const lastGet = lastGetByKey.get(key);
      if (lastGet) {
        const elapsed = Date.now() - lastGet;

        if (config.minFormTimeMs > 0 && elapsed < config.minFormTimeMs) {
          return { triggered: true, reason: 'honeypot_too_fast' };
        }

        if (config.maxPageTimeMs > 0 && elapsed > config.maxPageTimeMs) {
          return { triggered: true, reason: 'honeypot_too_slow' };
        }
      }
    }

    return { triggered: false };
  }
};
