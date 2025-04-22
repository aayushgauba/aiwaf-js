const db = require('../utils/db');
module.exports = {
  async isBlocked(ip) {
    const row = await db('blocked_ips').where('ip_address', ip).first();
    return !!row;
  },
  async block(ip, reason) {
    await db('blocked_ips').insert({ ip_address: ip, reason }).onConflict('ip_address').ignore();
  }
};