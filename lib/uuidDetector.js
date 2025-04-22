const { validate: isUuid } = require('uuid');

module.exports = {
  init(opts = {}) {
    this.prefix = opts.uuidRoutePrefix || '/user';
  },
  isSuspicious(req) {
    const { path } = req;
    const regex = new RegExp(`^${this.prefix}/([^/]+)$`);
    const match = path.match(regex);
    if (!match) {
      return false;
    }
    const uid = match[1];
    return !isUuid(uid);
  }
};
