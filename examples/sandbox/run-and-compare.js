#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { runSuite, buildOutputPath } = require('./attack-suite');

const directUrl = process.argv[2] || 'http://localhost:3001';
const protectedUrl = process.argv[3] || 'http://localhost:3000';

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const directFile = buildOutputPath('direct', runId);
const protectedFile = buildOutputPath('protected', runId);

function compare(direct, protectedRes) {
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

    const directRate = directRequests ? directBlocked / directRequests : 0;
    const protectedRate = protectedRequests ? protectedBlocked / protectedRequests : 0;

    summary.push({
      attack_type: attack,
      direct_blocked: directBlocked,
      protected_blocked: protectedBlocked,
      direct_requests: directRequests,
      protected_requests: protectedRequests,
      direct_block_rate: Number(directRate.toFixed(4)),
      protected_block_rate: Number(protectedRate.toFixed(4)),
      delta_block_rate: Number((protectedRate - directRate).toFixed(4)),
      verdict: protectedBlocked > directBlocked ? 'improved' : 'no_change',
      direct_avg_ms: pair.direct?.avg_response_time_ms ?? 0,
      protected_avg_ms: pair.protected?.avg_response_time_ms ?? 0
    });
  }

  return {
    direct: direct.target,
    protected: protectedRes.target,
    direct_file: path.basename(directFile),
    protected_file: path.basename(protectedFile),
    totals: {
      direct_blocked: totalDirectBlocked,
      protected_blocked: totalProtectedBlocked,
      direct_requests: totalDirectRequests,
      protected_requests: totalProtectedRequests
    },
    comparison: summary
  };
}

async function run() {
  await runSuite(directUrl, 'direct', directFile);
  await runSuite(protectedUrl, 'protected', protectedFile);

  const direct = JSON.parse(fs.readFileSync(directFile, 'utf8'));
  const protectedRes = JSON.parse(fs.readFileSync(protectedFile, 'utf8'));
  const combined = compare(direct, protectedRes);

  const outputFile = path.join(__dirname, `comparison_${runId}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(combined, null, 2), 'utf8');
  console.log(`Saved ${outputFile}`);
  console.log(JSON.stringify(combined, null, 2));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
