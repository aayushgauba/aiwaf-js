const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { IsolationForest } = require('./isolationForest');
console.log(require('../node_modules/aiwaf-wasm/package.json').version);
let wasmModule = null;
let wasmLoadAttempted = false;
let wasmLoadError = null;

async function loadWasmFromDisk() {
  const pkgDir = path.join(__dirname, '..', 'node_modules', 'aiwaf-wasm');
  const wasmPath = path.join(pkgDir, 'aiwaf_wasm_bg.wasm');
  const bgPath = path.join(pkgDir, 'aiwaf_wasm_bg.js');

  if (!fs.existsSync(wasmPath) || !fs.existsSync(bgPath)) {
    return null;
  }

  const bg = await import(pathToFileURL(bgPath).href);
  const bytes = fs.readFileSync(wasmPath);
  const importObject = { './aiwaf_wasm_bg.js': bg };
  const { instance } = await WebAssembly.instantiate(bytes, importObject);

  if (typeof bg.__wbg_set_wasm === 'function') {
    bg.__wbg_set_wasm(instance.exports);
  }
  if (instance.exports && typeof instance.exports.__wbindgen_start === 'function') {
    instance.exports.__wbindgen_start();
  }

  return {
    AiwafIsolationForest: bg.IsolationForest,
    validate_headers: bg.validate_headers,
    validate_headers_with_config: bg.validate_headers_with_config,
    analyze_recent_behavior: bg.analyze_recent_behavior,
    extract_features: bg.extract_features,
    extract_features_batch_with_state: bg.extract_features_batch_with_state,
    finalize_feature_state: bg.finalize_feature_state
  };
}

async function loadWasm() {
  if (wasmLoadAttempted) return wasmModule;
  wasmLoadAttempted = true;
  try {
    // Optional dependency: aiwaf-wasm
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const mod = require('aiwaf-wasm');
    if (mod) {
      if (typeof mod.default === 'function') {
        await mod.default();
      } else if (typeof mod.init === 'function') {
        await mod.init();
      }
      wasmModule = mod;
    }
  } catch (err) {
    try {
      const fallback = await loadWasmFromDisk();
      if (fallback) {
        wasmModule = fallback;
      } else {
        wasmLoadError = err;
        wasmModule = null;
      }
    } catch (fallbackErr) {
      wasmLoadError = fallbackErr || err;
      wasmModule = null;
    }
  }
  return wasmModule;
}

async function createIsolationForest(opts = {}) {
  const mod = await loadWasm();
  if (mod && typeof mod.AiwafIsolationForest === 'function') {
    const nTrees = Number.isFinite(Number(opts.nTrees)) ? Number(opts.nTrees) : 100;
    const sampleSize = Number.isFinite(Number(opts.sampleSize)) ? Number(opts.sampleSize) : 256;
    const threshold = Number.isFinite(Number(opts.threshold)) ? Number(opts.threshold) : 0.5;
    const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 42;
    const wasmModel = new mod.AiwafIsolationForest({
      n_trees: nTrees,
      sample_size: sampleSize,
      threshold,
      seed
    });

    return {
      fit(data) {
        return wasmModel.fit(data);
      },
      retrain(data) {
        if (typeof wasmModel.retrain === 'function') {
          return wasmModel.retrain(data);
        }
        return undefined;
      },
      anomalyScore(point) {
        if (typeof wasmModel.anomaly_score === 'function') {
          return wasmModel.anomaly_score(point);
        }
        if (typeof wasmModel.anomalyScore === 'function') {
          return wasmModel.anomalyScore(point);
        }
        return 0;
      },
      isAnomaly(point, thresh = threshold) {
        const score = this.anomalyScore(point);
        return score > thresh;
      },
      __aiwafWasm: true
    };
  }

  return new IsolationForest(opts);
}

function normalizeValidationResult(result, fallbackReason) {
  if (result === null || result === undefined || result === true || result === 0) return null;
  if (result === false) return fallbackReason;
  if (typeof result === 'string') return result || null;
  if (typeof result === 'object') {
    if (result.ok === false) return result.reason || fallbackReason;
    if (result.allowed === false) return result.reason || fallbackReason;
  }
  return null;
}

function normalizeHeaderValue(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function toPlainHeaderObject(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    headers.forEach((value, key) => {
      if (!key) return;
      out[String(key).toLowerCase()] = normalizeHeaderValue(value);
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers || {})) {
    if (!key) continue;
    const normalizedValue = Array.isArray(value)
      ? value.map(v => normalizeHeaderValue(v)).join(', ')
      : normalizeHeaderValue(value);
    out[String(key).toLowerCase()] = normalizedValue;
  }
  return out;
}

async function validateHeaders(headers, config) {
  const mod = await loadWasm();
  if (!mod || typeof mod.validate_headers !== 'function') return null;
  try {
    const headerObject = toPlainHeaderObject(headers);
    if (process.env.AIWAF_DEBUG_WASM_HEADERS) {
      // eslint-disable-next-line no-console
      console.error(`[WASM-HEADER-VALIDATION] headers keys: ${Object.keys(headerObject || {}).join(', ')}`);
      // eslint-disable-next-line no-console
      console.error(`[WASM-HEADER-VALIDATION] user-agent: ${headerObject?.['user-agent'] || ''}`);
      // eslint-disable-next-line no-console
      console.error(`[WASM-HEADER-VALIDATION] accept: ${headerObject?.['accept'] || ''}`);
    }
    let result;
    const forcePlain = process.env.AIWAF_FORCE_PLAIN_HEADERS === '1';
    const allowHeaders = process.env.AIWAF_USE_HEADERS === '1';
    const canUseHeaders = allowHeaders
      && !forcePlain
      && (typeof window !== 'undefined' && typeof Headers === 'function');

    const src = headerObject || {};
    const headerInputObj = { ...src };
    if (src['user-agent'] && !headerInputObj.HTTP_USER_AGENT) {
      headerInputObj.HTTP_USER_AGENT = src['user-agent'];
    }
    if (src.accept && !headerInputObj.HTTP_ACCEPT) {
      headerInputObj.HTTP_ACCEPT = src.accept;
    }
    if (src['accept-language'] && !headerInputObj.HTTP_ACCEPT_LANGUAGE) {
      headerInputObj.HTTP_ACCEPT_LANGUAGE = src['accept-language'];
    }
    if (src['accept-encoding'] && !headerInputObj.HTTP_ACCEPT_ENCODING) {
      headerInputObj.HTTP_ACCEPT_ENCODING = src['accept-encoding'];
    }
    if (src.connection && !headerInputObj.HTTP_CONNECTION) {
      headerInputObj.HTTP_CONNECTION = src.connection;
    }
    if (src['cache-control'] && !headerInputObj.HTTP_CACHE_CONTROL) {
      headerInputObj.HTTP_CACHE_CONTROL = src['cache-control'];
    }

    const headerInput = canUseHeaders ? new Headers(src) : headerInputObj;
    if (config && typeof mod.validate_headers_with_config === 'function') {
      const required = (config.requiredHeaders && config.requiredHeaders.length) ? config.requiredHeaders : null;
      const minScore = Number.isFinite(Number(config.minScore)) ? Number(config.minScore) : null;
      result = mod.validate_headers_with_config(headerInput, required, minScore);
    } else {
      result = mod.validate_headers(headerInput);
    }
    if (process.env.AIWAF_DEBUG_WASM_HEADERS) {
      // eslint-disable-next-line no-console
      console.error(`[WASM-HEADER-VALIDATION] raw=${JSON.stringify(result)}`);
    }
    return normalizeValidationResult(result, 'wasm_header_invalid');
  } catch (err) {
    if (process.env.AIWAF_DEBUG_WASM_HEADERS) {
      // eslint-disable-next-line no-console
      console.error(`[WASM-HEADER-VALIDATION] error=${err?.message || err}`);
    }
    return 'wasm_header_error';
  }
}

async function validateUrl(url) {
  const mod = await loadWasm();
  if (!mod || typeof mod.validate_url !== 'function') return null;
  try {
    const result = mod.validate_url(url);
    return normalizeValidationResult(result, 'wasm_url_invalid');
  } catch (err) {
    return 'wasm_url_error';
  }
}

async function validateContent(content) {
  const mod = await loadWasm();
  if (!mod || typeof mod.validate_content !== 'function') return null;
  try {
    const result = mod.validate_content(content);
    return normalizeValidationResult(result, 'wasm_content_invalid');
  } catch (err) {
    return 'wasm_content_error';
  }
}

async function validateRecent(recent) {
  const mod = await loadWasm();
  if (!mod || typeof mod.validate_recent !== 'function') return null;
  try {
    const result = mod.validate_recent(recent);
    return normalizeValidationResult(result, 'wasm_recent_invalid');
  } catch (err) {
    return 'wasm_recent_error';
  }
}

function getWasmStatus() {
  return {
    loaded: !!(wasmModule && wasmModule.AiwafIsolationForest),
    error: wasmLoadError ? String(wasmLoadError.message || wasmLoadError) : null
  };
}

module.exports = {
  createIsolationForest,
  validateHeaders,
  validateUrl,
  validateContent,
  validateRecent,
  getWasmStatus
};
