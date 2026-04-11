#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function listComparisonFiles(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.startsWith('comparison_modes_') && name.endsWith('.json'))
    .map(name => path.join(dir, name));
}

function pickLatest(dir) {
  const files = listComparisonFiles(dir);
  if (files.length === 0) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pad(value, len) {
  const str = String(value ?? '');
  if (str.length >= len) return str;
  return `${str}${' '.repeat(len - str.length)}`;
}

function calculateStats(report) {
  const stats = {
    totalRequests: 0,
    totalBlocked: 0,
    blockedPct: 0,
    avgResponseTime: 0
  };

  if (!report || !report.attacks) return stats;

  report.attacks.forEach(attack => {
    stats.totalRequests += attack.requests_sent || 0;
    stats.totalBlocked += attack.blocked || 0;
  });

  stats.blockedPct = stats.totalRequests > 0 ? (stats.totalBlocked / stats.totalRequests * 100).toFixed(1) : 0;
  
  const totalTime = report.attacks.reduce((sum, a) => sum + (a.avg_response_time_ms || 0), 0);
  stats.avgResponseTime = report.attacks.length > 0 ? (totalTime / report.attacks.length).toFixed(2) : 0;

  return stats;
}

async function main() {
  const baseDir = __dirname;
  const comparisonFile = pickLatest(baseDir);

  if (!comparisonFile) {
    console.error('No comparison_modes_*.json found in examples/sandbox/');
    process.exit(1);
  }

  const data = loadJson(comparisonFile);
  const normalReports = data.normal || [];
  const attackReports = data.attacks || [];

  console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║ WAF Comparison: Normal vs Attack Traffic                       ║`);
  console.log(`║ Generated: ${data.generatedAt.split('T')[0]}                                   ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝\n`);

  const results = [];

  for (const normalReport of normalReports) {
    const attackReport = attackReports.find(r => r.target === normalReport.target);
    if (!attackReport) continue;

    const normalStats = calculateStats(normalReport);
    const attackStats = calculateStats(attackReport);

    results.push({
      target: normalReport.target,
      normal: normalStats,
      attacks: attackStats
    });
  }

  // Print table
  console.log('Target                   | Normal Traffic       | Attack Traffic       | Status');
  console.log('                         | Reqs    Blocked %    | Reqs    Blocked %    |');
  console.log('-'.repeat(90));

  for (const result of results) {
    const target = pad(result.target, 24);
    const normalReqs = pad(result.normal.totalRequests, 5);
    const normalBlocked = pad(`${result.normal.blockedPct}%`, 9);
    const attackReqs = pad(result.attacks.totalRequests, 5);
    const attackBlocked = pad(`${result.attacks.blockedPct}%`, 9);
    
    // Determine status
    let status = '✓';
    if (parseFloat(result.normal.blockedPct) > 5) {
      status = '⚠ HIGH FALSE POS';
    } else if (parseFloat(result.attacks.blockedPct) < 50) {
      status = '⚠ LOW DETECTION';
    }

    console.log(`${target}| ${normalReqs} ${normalBlocked} | ${attackReqs} ${attackBlocked} | ${status}`);
  }

  console.log('\n' + '='.repeat(90));
  console.log('\nDetailed Breakdown:\n');

  for (const result of results) {
    console.log(`\n${result.target.toUpperCase()}`);
    console.log('-'.repeat(50));
    
    console.log(`\nNormal Traffic:`);
    console.log(`  Total Requests: ${result.normal.totalRequests}`);
    console.log(`  Blocked: ${result.normal.totalBlocked} (${result.normal.blockedPct}%)`);
    console.log(`  Avg Response Time: ${result.normal.avgResponseTime}ms`);
    
    console.log(`\nAttack Traffic:`);
    console.log(`  Total Requests: ${result.attacks.totalRequests}`);
    console.log(`  Blocked: ${result.attacks.totalBlocked} (${result.attacks.blockedPct}%)`);
    console.log(`  Avg Response Time: ${result.attacks.avgResponseTime}ms`);
    
    // Alert if issues
    if (parseFloat(result.normal.blockedPct) > 5) {
      console.log(`\n  ⚠ WARNING: High false positive rate (${result.normal.blockedPct}% of normal traffic blocked)`);
    }
    if (parseFloat(result.attacks.blockedPct) < 50) {
      console.log(`\n  ⚠ WARNING: Low attack detection rate (${result.attacks.blockedPct}% of attacks blocked)`);
    }
  }

  console.log(`\n\nFull report: ${path.relative(baseDir, comparisonFile)}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
