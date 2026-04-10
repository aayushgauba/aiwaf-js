const { validate: isUuid } = require('uuid');

let config = {
  prefix: '/user',
  uuidResolver: null
};

function extractUuid(req) {
  if (req?.params?.uuid) return String(req.params.uuid);
  const path = String(req.path || req.url || '');
  const regex = new RegExp(`^${config.prefix}/([^/]+)$`);
  const match = path.match(regex);
  return match ? match[1] : null;
}

module.exports = {
  init(opts = {}) {
    config = {
      prefix: opts.uuidRoutePrefix || '/user',
      uuidResolver: typeof opts.uuidResolver === 'function'
        ? opts.uuidResolver
        : null
    };
  },

  async isSuspicious(req) {
    const uid = extractUuid(req);
    if (!uid) return false;
    if (!isUuid(uid)) return true;

    if (config.uuidResolver) {
      try {
        const exists = await config.uuidResolver(uid, req);
        return !exists;
      } catch (err) {
        return false;
      }
    }

    return false;
  }
};
