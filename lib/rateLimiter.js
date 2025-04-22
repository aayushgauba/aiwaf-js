const NodeCache = require('node-cache');
const blacklistManager = require('./blacklistManager');
let cache, opts;
module.exports = {
  init(o) { opts = o; cache = new NodeCache({ stdTTL: opts.WINDOW_SEC }); },
  async record(ip) {
    const recs = cache.get(ip) || [];
    recs.push(Date.now()); cache.set(ip, recs);
    if (recs.length > opts.FLOOD_REQ) {
      await blacklistManager.block(ip, 'flood');
    }
  },
  async isBlocked(ip) {
    if (await blacklistManager.isBlocked(ip)) return true;
    const recs = cache.get(ip) || [];
    const within = recs.filter(t => Date.now() - t < opts.WINDOW_SEC*1000);
    return within.length > opts.MAX_REQ;
  }
};