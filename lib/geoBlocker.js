const fs = require('fs');
const path = require('path');
const geoStore = require('./geoStore');

let config = {
  enabled: false,
  blocked: [],
  allowed: [],
  resolver: null,
  mmdbPath: '',
  mmdbReader: null
};

function normalizeCountry(value) {
  return String(value || '').trim().toUpperCase();
}

async function resolveCountry(req) {
  if (typeof config.resolver === 'function') {
    try {
      return normalizeCountry(await config.resolver(req));
    } catch (err) {
      return '';
    }
  }

  if (config.mmdbReader) {
    try {
      const rawIp = req.headers?.['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : (req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '');
      const cleanedIp = String(rawIp).replace(/^::ffff:/, '');
      if (cleanedIp) {
        const result = config.mmdbReader.get(cleanedIp);
        const iso = result?.country?.iso_code || result?.registered_country?.iso_code;
        if (iso) return normalizeCountry(iso);
      }
    } catch (err) {
      // Fall through to header fallback.
    }
  }

  // Fallback when no MMDB reader is available.
  return normalizeCountry(req.headers?.['x-country-code']);
}

function tryLoadMmdbReader(mmdbPath) {
  if (!mmdbPath || !fs.existsSync(mmdbPath)) return null;
  try {
    // Optional dependency by design.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const maxmind = require('maxmind');
    return maxmind.openSync(mmdbPath);
  } catch (err) {
    return null;
  }
}

module.exports = {
  init(opts = {}) {
    const resolvedPath = opts.AIWAF_GEO_MMDB_PATH
      ? path.resolve(opts.AIWAF_GEO_MMDB_PATH)
      : path.resolve(__dirname, '..', 'geolock', 'ipinfo_lite.mmdb');
    config = {
      enabled: !!opts.AIWAF_GEO_BLOCK_ENABLED,
      blocked: (opts.AIWAF_GEO_BLOCK_COUNTRIES || []).map(normalizeCountry),
      allowed: (opts.AIWAF_GEO_ALLOW_COUNTRIES || []).map(normalizeCountry),
      resolver: opts.geoResolver || null,
      mmdbPath: resolvedPath,
      mmdbReader: tryLoadMmdbReader(resolvedPath)
    };
    geoStore.initialize().catch(() => {});
  },

  async check(req) {
    if (!config.enabled) {
      return { blocked: false, country: '' };
    }

    const country = await resolveCountry(req);
    if (!country) {
      return { blocked: false, country: '' };
    }

    if (config.allowed.length > 0 && !config.allowed.includes(country)) {
      return { blocked: true, country, reason: `geo_allowlist:${country}` };
    }

    let dbBlocked = false;
    try {
      dbBlocked = await geoStore.isBlockedCountry(country);
    } catch (err) {
      dbBlocked = false;
    }

    if (config.blocked.includes(country) || dbBlocked) {
      return { blocked: true, country, reason: `geo_block:${country}` };
    }

    return { blocked: false, country };
  }
};
