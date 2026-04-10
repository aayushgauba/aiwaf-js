#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const tableOnly = args.includes('--table');
const jsonOnly = args.includes('--json');
const fileArgs = args.filter(a => !a.startsWith('--'));
const directFileArg = fileArgs[0];
const protectedFileArg = fileArgs[1];
const fastifyFileArg = fileArgs[2];
const hapiFileArg = fileArgs[3];
const koaFileArg = fileArgs[4];
const nestFileArg = fileArgs[5];

function listResultFiles(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.startsWith('results_') && name.endsWith('.json'))
    .map(name => path.join(dir, name));
}

function pickLatest(dir, prefix) {
  const files = listResultFiles(dir)
    .filter(name => {
      const base = path.basename(name);
      if (prefix === 'protected') {
        return base.startsWith('results_protected_')
          && !base.startsWith('results_protected_fastify_')
          && !base.startsWith('results_protected_hapi_')
          && !base.startsWith('results_protected_koa_')
          && !base.startsWith('results_protected_nest_');
      }
      return base.startsWith(`results_${prefix}_`);
    });

  if (files.length === 0) return null;

  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

const baseDir = __dirname;
const directFile = directFileArg || pickLatest(baseDir, 'direct');
const protectedFile = protectedFileArg || pickLatest(baseDir, 'protected');
const fastifyFile = fastifyFileArg || pickLatest(baseDir, 'protected_fastify');
const hapiFile = hapiFileArg || pickLatest(baseDir, 'protected_hapi');
const koaFile = koaFileArg || pickLatest(baseDir, 'protected_koa');
const nestFile = nestFileArg || pickLatest(baseDir, 'protected_nest');

if (!directFile || !protectedFile || !fastifyFile || !hapiFile || !koaFile || !nestFile) {
  console.error('Usage: node compare-results.js <direct.json> <protected.json> <protected_fastify.json> <protected_hapi.json> <protected_koa.json> <protected_nest.json>');
  console.error('Or place results_direct_*.json, results_protected_*.json, results_protected_fastify_*.json, results_protected_hapi_*.json, results_protected_koa_*.json, results_protected_nest_*.json in examples/sandbox.');
  process.exit(1);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const direct = loadJson(directFile);
let protectedRes = loadJson(protectedFile);
const fastifyRes = loadJson(fastifyFile);
const hapiRes = loadJson(hapiFile);
const koaRes = loadJson(koaFile);
const nestRes = loadJson(nestFile);

if (protectedRes.target !== 'protected') {
  const candidates = listResultFiles(baseDir)
    .filter(name => {
      const base = path.basename(name);
      return base.startsWith('results_protected_')
        && !base.startsWith('results_protected_fastify_')
        && !base.startsWith('results_protected_hapi_')
        && !base.startsWith('results_protected_koa_')
        && !base.startsWith('results_protected_nest_');
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const corrected = candidates.find(filePath => {
    try {
      return loadJson(filePath).target === 'protected';
    } catch (err) {
      return false;
    }
  });

  if (corrected) {
    protectedRes = loadJson(corrected);
  }
}

const byAttack = new Map();

direct.attacks.forEach(a => byAttack.set(a.attack_type, { direct: a }));
protectedRes.attacks.forEach(a => {
  const entry = byAttack.get(a.attack_type) || {};
  entry.protected = a;
  byAttack.set(a.attack_type, entry);
});
fastifyRes.attacks.forEach(a => {
  const entry = byAttack.get(a.attack_type) || {};
  entry.fastify = a;
  byAttack.set(a.attack_type, entry);
});
hapiRes.attacks.forEach(a => {
  const entry = byAttack.get(a.attack_type) || {};
  entry.hapi = a;
  byAttack.set(a.attack_type, entry);
});
koaRes.attacks.forEach(a => {
  const entry = byAttack.get(a.attack_type) || {};
  entry.koa = a;
  byAttack.set(a.attack_type, entry);
});
nestRes.attacks.forEach(a => {
  const entry = byAttack.get(a.attack_type) || {};
  entry.nest = a;
  byAttack.set(a.attack_type, entry);
});

const summary = [];
let totalDirectBlocked = 0;
let totalProtectedBlocked = 0;
let totalDirectRequests = 0;
let totalProtectedRequests = 0;
let totalFastifyBlocked = 0;
let totalFastifyRequests = 0;
let totalHapiBlocked = 0;
let totalHapiRequests = 0;
let totalKoaBlocked = 0;
let totalKoaRequests = 0;
let totalNestBlocked = 0;
let totalNestRequests = 0;
for (const [attack, pair] of byAttack.entries()) {
  const directBlocked = pair.direct?.blocked ?? 0;
  const protectedBlocked = pair.protected?.blocked ?? 0;
  const fastifyBlocked = pair.fastify?.blocked ?? 0;
  const hapiBlocked = pair.hapi?.blocked ?? 0;
  const koaBlocked = pair.koa?.blocked ?? 0;
  const nestBlocked = pair.nest?.blocked ?? 0;
  const directRequests = pair.direct?.requests_sent ?? 0;
  const protectedRequests = pair.protected?.requests_sent ?? 0;
  const fastifyRequests = pair.fastify?.requests_sent ?? 0;
  const hapiRequests = pair.hapi?.requests_sent ?? 0;
  const koaRequests = pair.koa?.requests_sent ?? 0;
  const nestRequests = pair.nest?.requests_sent ?? 0;

  totalDirectBlocked += directBlocked;
  totalProtectedBlocked += protectedBlocked;
  totalDirectRequests += directRequests;
  totalProtectedRequests += protectedRequests;
  totalFastifyBlocked += fastifyBlocked;
  totalFastifyRequests += fastifyRequests;
  totalHapiBlocked += hapiBlocked;
  totalHapiRequests += hapiRequests;
  totalKoaBlocked += koaBlocked;
  totalKoaRequests += koaRequests;
  totalNestBlocked += nestBlocked;
  totalNestRequests += nestRequests;

  summary.push({
    attack_type: attack,
    direct_blocked: directBlocked,
    protected_blocked: protectedBlocked,
    protected_fastify_blocked: fastifyBlocked,
    protected_hapi_blocked: hapiBlocked,
    protected_koa_blocked: koaBlocked,
    protected_nest_blocked: nestBlocked,
    direct_requests: directRequests,
    protected_requests: protectedRequests,
    protected_fastify_requests: fastifyRequests,
    protected_hapi_requests: hapiRequests,
    protected_koa_requests: koaRequests,
    protected_nest_requests: nestRequests,
    direct_avg_ms: pair.direct?.avg_response_time_ms ?? 0,
    protected_avg_ms: pair.protected?.avg_response_time_ms ?? 0,
    protected_fastify_avg_ms: pair.fastify?.avg_response_time_ms ?? 0,
    protected_hapi_avg_ms: pair.hapi?.avg_response_time_ms ?? 0,
    protected_koa_avg_ms: pair.koa?.avg_response_time_ms ?? 0,
    protected_nest_avg_ms: pair.nest?.avg_response_time_ms ?? 0
  });
}

const output = {
  direct: direct.target,
  protected: protectedRes.target,
  protected_fastify: fastifyRes.target,
  protected_hapi: hapiRes.target,
  protected_koa: koaRes.target,
  protected_nest: nestRes.target,
  direct_file: path.relative(baseDir, directFile),
  protected_file: path.relative(baseDir, protectedFile),
  protected_fastify_file: path.relative(baseDir, fastifyFile),
  protected_hapi_file: path.relative(baseDir, hapiFile),
  protected_koa_file: path.relative(baseDir, koaFile),
  protected_nest_file: path.relative(baseDir, nestFile),
  totals: {
    direct_blocked: totalDirectBlocked,
    protected_blocked: totalProtectedBlocked,
    protected_fastify_blocked: totalFastifyBlocked,
    protected_hapi_blocked: totalHapiBlocked,
    protected_koa_blocked: totalKoaBlocked,
    protected_nest_blocked: totalNestBlocked,
    direct_requests: totalDirectRequests,
    protected_requests: totalProtectedRequests,
    protected_fastify_requests: totalFastifyRequests,
    protected_hapi_requests: totalHapiRequests,
    protected_koa_requests: totalKoaRequests,
    protected_nest_requests: totalNestRequests
  },
  comparison: summary
};

function pad(value, len) {
  const str = String(value ?? '');
  if (str.length >= len) return str;
  return `${str}${' '.repeat(len - str.length)}`;
}

function printTable(data) {
  const headers = [
    'attack_type',
    'direct_blocked',
    'protected_blocked',
    'fastify_blocked',
    'hapi_blocked',
    'koa_blocked',
    'nest_blocked',
    'direct_avg_ms',
    'protected_avg_ms',
    'fastify_avg_ms',
    'hapi_avg_ms',
    'koa_avg_ms',
    'nest_avg_ms'
  ];
  const rows = data.comparison.map(row => ([
    row.attack_type,
    row.direct_blocked,
    row.protected_blocked,
    row.protected_fastify_blocked,
    row.protected_hapi_blocked,
    row.protected_koa_blocked,
    row.protected_nest_blocked,
    row.direct_avg_ms.toFixed ? row.direct_avg_ms.toFixed(2) : row.direct_avg_ms,
    row.protected_avg_ms.toFixed ? row.protected_avg_ms.toFixed(2) : row.protected_avg_ms,
    row.protected_fastify_avg_ms.toFixed ? row.protected_fastify_avg_ms.toFixed(2) : row.protected_fastify_avg_ms,
    row.protected_hapi_avg_ms.toFixed ? row.protected_hapi_avg_ms.toFixed(2) : row.protected_hapi_avg_ms,
    row.protected_koa_avg_ms.toFixed ? row.protected_koa_avg_ms.toFixed(2) : row.protected_koa_avg_ms,
    row.protected_nest_avg_ms.toFixed ? row.protected_nest_avg_ms.toFixed(2) : row.protected_nest_avg_ms
  ]));

  const widths = headers.map((header, idx) => {
    const maxCell = Math.max(header.length, ...rows.map(r => String(r[idx]).length));
    return Math.min(30, maxCell);
  });

  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(headers.map((_, i) => '-'.repeat(widths[i])).join('  '));
  rows.forEach(row => {
    console.log(row.map((cell, i) => pad(cell, widths[i])).join('  '));
  });
}

if (!jsonOnly) {
  printTable(output);
}
if (!tableOnly) {
  console.log(JSON.stringify(output, null, 2));
}
