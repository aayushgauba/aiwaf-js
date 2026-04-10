let config = {
  enabled: false,
  requiredHeaders: [],
  blockedUserAgents: []
};

module.exports = {
  init(opts = {}) {
    config = {
      enabled: !!opts.AIWAF_HEADER_VALIDATION,
      requiredHeaders: (opts.AIWAF_REQUIRED_HEADERS || []).map(h => String(h).toLowerCase()),
      blockedUserAgents: (opts.AIWAF_BLOCKED_USER_AGENTS || []).map(u => String(u).toLowerCase())
    };
  },

  validate(req) {
    if (!config.enabled) return null;

    for (const header of config.requiredHeaders) {
      if (!req.headers || !req.headers[header]) {
        return `missing_header:${header}`;
      }
    }

    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    if (config.blockedUserAgents.some(pattern => ua.includes(pattern))) {
      return 'blocked_user_agent';
    }

    return null;
  }
};
