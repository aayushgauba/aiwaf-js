#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const directFileArg = process.argv[2];
const protectedFileArg = process.argv[3];

function listResultFiles(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.startsWith('results_') && name.endsWith('.json'))
    .map(name => path.join(dir, name));
}

function pickLatest(dir, prefix) {
  const files = listResultFiles(dir)
    .filter(name => path.basename(name).startsWith(`results_${prefix}_`));

  if (files.length === 0) return null;

  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

const baseDir = __dirname;
const directFile = directFileArg || pickLatest(baseDir, 'direct');
const protectedFile = protectedFileArg || pickLatest(baseDir, 'protected');

if (!directFile || !protectedFile) {
  console.error('Usage: node compare-results.js <direct.json> <protected.json>');
  console.error('Or place results_direct_*.json and results_protected_*.json in examples/sandbox.');
  process.exit(1);
}

const direct = JSON.parse(fs.readFileSync(directFile, 'utf8'));
const protectedRes = JSON.parse(fs.readFileSync(protectedFile, 'utf8'));

const byAttack = new Map();

direct.attacks.forEach(a => byAttack.set(a.attack_type, { direct: a }));
protectedRes.attacks.forEach(a => {
  const entry = byAttack.get(a.attack_type) || {};
  entry.protected = a;
  byAttack.set(a.attack_type, entry);
});

const summary = [];
let totalDirectBlocked = 0;
let totalProtectedBlocked = 0;
let totalDirectRequests = 0;
let totalProtectedRequests = 0;
for (const [attack, pair] of byAttack.entries()) {
  const directBlocked = pair.direct?.blocked ?? 0;
  const protectedBlocked = pair.protected?.blocked ?? 0;
  const directRequests = pair.direct?.requests_sent ?? 0;
  const protectedRequests = pair.protected?.requests_sent ?? 0;

  totalDirectBlocked += directBlocked;
  totalProtectedBlocked += protectedBlocked;
  totalDirectRequests += directRequests;
  totalProtectedRequests += protectedRequests;

  summary.push({
    attack_type: attack,
    direct_blocked: directBlocked,
    protected_blocked: protectedBlocked,
    direct_requests: directRequests,
    protected_requests: protectedRequests,
    direct_avg_ms: pair.direct?.avg_response_time_ms ?? 0,
    protected_avg_ms: pair.protected?.avg_response_time_ms ?? 0
  });
}

console.log(JSON.stringify({
  direct: direct.target,
  protected: protectedRes.target,
  direct_file: path.relative(baseDir, directFile),
  protected_file: path.relative(baseDir, protectedFile),
  totals: {
    direct_blocked: totalDirectBlocked,
    protected_blocked: totalProtectedBlocked,
    direct_requests: totalDirectRequests,
    protected_requests: totalProtectedRequests
  },
  comparison: summary
}, null, 2));
