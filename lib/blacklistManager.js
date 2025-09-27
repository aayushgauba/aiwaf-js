const db = require('../utils/db');

let initialized = false;

async function initialize() {
  if (initialized) return;
  
  try {
    // Ensure the blocked_ips table exists
    const exists = await db.schema.hasTable('blocked_ips');
    if (!exists) {
      console.log('Creating blocked_ips table...');
      await db.schema.createTable('blocked_ips', (table) => {
        table.increments('id').primary();
        table.string('ip_address').unique().notNullable();
        table.string('reason').defaultTo('WAF blocked');
        table.timestamp('blocked_at').defaultTo(db.fn.now());
      });
    }
    initialized = true;
    console.log('BlacklistManager initialized successfully');
  } catch (err) {
    console.error('Failed to initialize BlacklistManager:', err.message);
  }
}

module.exports = {
  async isBlocked(ip) {
    try {
      await initialize();
      const row = await db('blocked_ips').where('ip_address', ip).first();
      return !!row;
    } catch (err) {
      console.error('Error checking if IP is blocked:', err.message);
      return false; // Fail open
    }
  },
  
  async block(ip, reason = 'WAF blocked') {
    try {
      await initialize();
      await db('blocked_ips')
        .insert({ ip_address: ip, reason })
        .onConflict('ip_address')
        .ignore();
      console.log(`✅ Blocked IP: ${ip} (Reason: ${reason})`);
      return true;
    } catch (err) {
      console.error('Error blocking IP:', err.message);
      return false;
    }
  },
  
  async unblock(ip) {
    try {
      await initialize();
      const deleted = await db('blocked_ips').where('ip_address', ip).del();
      if (deleted > 0) {
        console.log(`✅ Unblocked IP: ${ip}`);
      }
      return deleted > 0;
    } catch (err) {
      console.error('Error unblocking IP:', err.message);
      return false;
    }
  },
  
  async getBlockedIPs() {
    try {
      await initialize();
      return await db('blocked_ips').select('*').orderBy('blocked_at', 'desc');
    } catch (err) {
      console.error('Error getting blocked IPs:', err.message);
      return [];
    }
  },
  
  async initialize() {
    return initialize();
  }
};