#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function buildOutputPath(targetName, runId) {
  return path.join(__dirname, `results_${targetName}_${runId}.json`);
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

let defaultHeaders = {};

function setDefaultHeaders(headers) {
  defaultHeaders = headers || {};
}

function hashToOctet(input) {
  const str = String(input || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  return (positive % 200) + 10;
}

function buildIp(base, seed, offset) {
  const octet = (hashToOctet(seed) + offset) % 245 + 10;
  return `${base}.${octet}`;
}

function makeIpGenerator(base, seed, startOffset) {
  let counter = startOffset;
  return () => buildIp(base, seed, counter++);
}

function makeHeaderGenerator(staticHeaders, ipGenerator) {
  if (!ipGenerator) {
    return staticHeaders;
  }
  return () => ({
    ...(staticHeaders || {}),
    'x-forwarded-for': ipGenerator()
  });
}

async function requestOnce(method, url, options = {}) {
  const start = nowMs();
  let status = 0;
  let error = null;
  try {
    const baseHeaders = typeof defaultHeaders === 'function'
      ? (defaultHeaders(method, url) || {})
      : defaultHeaders;
    const res = await fetch(url, {
      method,
      headers: { ...baseHeaders, ...(options.headers || {}) },
      body: options.body
    });
    status = res.status;
    await res.text();
  } catch (err) {
    status = 0;
    error = err?.code || err?.message || 'request_failed';
  }
  const end = nowMs();
  return { status, durationMs: end - start, error };
}

function summarize(results) {
  const statusCounts = {};
  let totalDuration = 0;
  let blocked = 0;
  let errors = 0;

  results.forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    totalDuration += r.durationMs;
    if ([403, 405, 409, 429].includes(r.status)) blocked += 1;
    if (r.status === 0) errors += 1;
  });

  const avgResponseTime = results.length ? totalDuration / results.length : 0;
  return { statusCounts, blocked, avgResponseTime, errors };
}

async function attackBruteForce(baseUrl) {
  const results = [];
  const url = `${baseUrl}/rest/user/login`;
  for (let i = 0; i < 50; i += 1) {
    const body = JSON.stringify({ email: `admin${i}@example.com`, password: 'password' });
    results.push(await requestOnce('POST', url, {
      headers: { 'content-type': 'application/json' },
      body
    }));
  }
  return results;
}

async function attackCredentialStuffing(baseUrl) {
  const results = [];
  const url = `${baseUrl}/rest/user/login`;
  const candidates = [
    { email: 'admin@juice-sh.op', password: 'admin123' },
    { email: 'admin@juice-sh.op', password: 'password' },
    { email: 'test@juice-sh.op', password: 'test' },
    { email: 'demo@juice-sh.op', password: 'demo' }
  ];
  for (const cred of candidates) {
    for (let i = 0; i < 10; i += 1) {
      results.push(await requestOnce('POST', url, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cred)
      }));
    }
  }
  return results;
}

async function attackPathProbe(baseUrl) {
  const paths = [
    '/admin.php',
    '/.env',
    '/.git/config',
    '/../etc/passwd',
    '/wp-login.php',
    '/phpmyadmin',
    '/config.php',
    '/server-status',
    '/actuator/env',
    '/api/internal',
    '/backup.zip',
    '/.well-known/security.txt'
  ];
  const results = [];
  for (const p of paths) {
    results.push(await requestOnce('GET', `${baseUrl}${p}`));
  }
  return results;
}

async function attackHeaderProbe(baseUrl) {
  const results = [];
  const headers = {
    'user-agent': 'sqlmap/1.0',
    'x-evil-header': '1',
    'x-forwarded-for': '127.0.0.1'
  };
  results.push(await requestOnce('GET', `${baseUrl}/`, { headers }));
  return results;
}

async function attackHeaderVariations(baseUrl) {
  const results = [];
  const uas = [
    'sqlmap/1.8',
    'nikto/2.5.0',
    'masscan/1.3',
    'curl/7.88.1',
    'python-requests/2.31.0'
  ];
  for (const ua of uas) {
    results.push(await requestOnce('GET', `${baseUrl}/`, {
      headers: { 'user-agent': ua, 'x-evil-header': '1' }
    }));
  }
  return results;
}

async function attackBurst(baseUrl) {
  const url = `${baseUrl}/`;
  const tasks = Array.from({ length: 30 }, () => requestOnce('GET', url));
  return Promise.all(tasks);
}

async function attackBurstMixed(baseUrl) {
  const urls = [
    `${baseUrl}/`,
    `${baseUrl}/rest/products`,
    `${baseUrl}/rest/user/login`
  ];
  const tasks = Array.from({ length: 40 }, (_, i) => {
    const url = urls[i % urls.length];
    if (url.endsWith('/login')) {
      return requestOnce('POST', url, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `burst${i}@example.com`, password: 'x' })
      });
    }
    return requestOnce('GET', url);
  });
  return Promise.all(tasks);
}

async function attackMethodProbe(baseUrl) {
  const results = [];
  results.push(await requestOnce('PUT', `${baseUrl}/api/`));
  results.push(await requestOnce('DELETE', `${baseUrl}/api/`));
  results.push(await requestOnce('PATCH', `${baseUrl}/api/`));
  return results;
}

async function attackQueryInjection(baseUrl) {
  const payloads = [
    "/rest/products/search?q=' OR 1=1--",
    "/rest/products/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    "/rest/products/search?q=%27%3BWAITFOR%20DELAY%20%270:0:3%27--"
  ];
  const results = [];
  for (const p of payloads) {
    results.push(await requestOnce('GET', `${baseUrl}${p}`));
  }
  return results;
}

async function attackOwaspTop10(baseUrl) {
  const requests = [
    { method: 'GET', path: "/rest/products/search?q=' OR 1=1--" }, // A03 Injection
    { method: 'GET', path: "/rest/products/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E" }, // A03 XSS
    { method: 'GET', path: "/rest/products/search?q=%7B%22$ne%22:%20null%7D" }, // NoSQL-style payload
    { method: 'GET', path: "/api/Users?filter=__proto__" }, // Prototype pollution probe
    { method: 'GET', path: "/api/Users?filter=%7B%22where%22:%7B%22id%22:1%7D%7D" }, // IDOR-ish probe
    { method: 'GET', path: "/rest/user/whoami" }, // Auth check
    { method: 'GET', path: "/admin" }, // Broken access control
    { method: 'GET', path: "/.env" }, // Sensitive file exposure
    { method: 'GET', path: "/.git/config" }, // Sensitive file exposure
    { method: 'GET', path: "/swagger.json" }, // Security misconfig
    { method: 'GET', path: "/api-docs" }, // Security misconfig
    { method: 'GET', path: "/rest/products/1/reviews" }, // Data exposure probe
    { method: 'GET', path: "/rest/products/search?q=%2e%2e%2f%2e%2e%2fetc%2fpasswd" }, // Path traversal
    { method: 'GET', path: "/rest/user/login?email=admin@juice-sh.op&password=admin123" }, // Cred stuffing via query
    { method: 'POST', path: "/rest/user/login", body: { email: "admin@juice-sh.op", password: "admin123" } }, // Cred stuffing
    { method: 'POST', path: "/rest/user/login", body: { email: "admin@juice-sh.op' OR 1=1--", password: "x" } } // Injection
  ];

  const results = [];
  for (const req of requests) {
    const headers = {};
    let body;
    if (req.body) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    results.push(await requestOnce(req.method, `${baseUrl}${req.path}`, { headers, body }));
  }
  return results;
}

async function attackLongPath(baseUrl) {
  const longPath = '/'.padEnd(2048, 'a');
  return [await requestOnce('GET', `${baseUrl}${longPath}`)];
}

async function attackNormalTraffic(baseUrl) {
  const results = [];
  const normalHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.5',
    'accept-encoding': 'gzip, deflate',
    'connection': 'keep-alive',
    'upgrade-insecure-requests': '1'
  };

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Browse homepage
  results.push(await requestOnce('GET', `${baseUrl}/`, { headers: normalHeaders }));
  await delay(50);

  // Search for products
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/search?q=juice`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/search?q=apple`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/search?q=organic`, { headers: normalHeaders }));
  await delay(50);

  // View products
  results.push(await requestOnce('GET', `${baseUrl}/rest/products`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/1`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/2`, { headers: normalHeaders }));
  await delay(50);

  // Pagination
  results.push(await requestOnce('GET', `${baseUrl}/rest/products?limit=10&offset=0`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products?limit=10&offset=10`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products?limit=10&offset=20`, { headers: normalHeaders }));
  await delay(50);

  // View reviews
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/1/reviews`, { headers: normalHeaders }));
  await delay(50);
  results.push(await requestOnce('GET', `${baseUrl}/rest/products/2/reviews`, { headers: normalHeaders }));
  await delay(50);

  // Normal login attempts
  results.push(await requestOnce('POST', `${baseUrl}/rest/user/login`, {
    headers: { ...normalHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'password123' })
  }));
  await delay(100);
  results.push(await requestOnce('POST', `${baseUrl}/rest/user/login`, {
    headers: { ...normalHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@juice-sh.op', password: 'admin123' })
  }));
  await delay(50);

  // Browse categories
  results.push(await requestOnce('GET', `${baseUrl}/rest/categories`, { headers: normalHeaders }));
  await delay(50);

  // Add to basket (normal user behavior)
  results.push(await requestOnce('POST', `${baseUrl}/api/BasketItems`, {
    headers: { ...normalHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ productId: 1, quantity: 1 })
  }));
  await delay(50);
  results.push(await requestOnce('POST', `${baseUrl}/api/BasketItems`, {
    headers: { ...normalHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ productId: 2, quantity: 2 })
  }));
  await delay(50);

  // View basket
  results.push(await requestOnce('GET', `${baseUrl}/api/BasketItems`, { headers: normalHeaders }));
  await delay(50);

  // Browse with different normal user agents
  const userAgents = [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1'
  ];

  for (const ua of userAgents) {
    results.push(await requestOnce('GET', `${baseUrl}/`, { headers: { ...normalHeaders, 'user-agent': ua } }));
    await delay(50);
    results.push(await requestOnce('GET', `${baseUrl}/rest/products`, { headers: { ...normalHeaders, 'user-agent': ua } }));
    await delay(50);
  }

  return results;
}

async function runTestSuite(baseUrl, targetName, outputFile, testList, headers) {
  setDefaultHeaders(headers);
  const health = await requestOnce('GET', `${baseUrl}/`);
  if (health.status === 0) {
    const reason = health.error ? ` (${health.error})` : '';
    throw new Error(`Unable to reach ${baseUrl}${reason}. Is it running and reachable?`);
  }

  const report = {
    target: targetName,
    baseUrl,
    runId: outputFile ? path.basename(outputFile).replace(/^results_/, '').replace(/\.json$/, '') : new Date().toISOString(),
    startedAt: new Date().toISOString(),
    attacks: []
  };

  for (const attack of testList) {
    const results = await attack.fn(baseUrl);
    const summary = summarize(results);
    report.attacks.push({
      attack_type: attack.name,
      requests_sent: results.length,
      status_counts: summary.statusCounts,
      blocked: summary.blocked,
      errors: summary.errors,
      avg_response_time_ms: summary.avgResponseTime
    });
  }

  report.finishedAt = new Date().toISOString();
  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Saved ${outputFile}`);
  }
  return report;
}

async function runNormalTrafficOnly(baseUrl, targetName, outputFile, headers) {
  const testList = [
    { name: 'normal_traffic', fn: attackNormalTraffic }
  ];
  return runTestSuite(baseUrl, targetName, outputFile, testList, headers);
}

async function runAttacksSuite(baseUrl, targetName, outputFile, headers) {
  const testList = [
    { name: 'brute_force', fn: attackBruteForce },
    { name: 'credential_stuffing', fn: attackCredentialStuffing },
    { name: 'path_probe', fn: attackPathProbe },
    { name: 'header_probe', fn: attackHeaderProbe },
    { name: 'header_variations', fn: attackHeaderVariations },
    { name: 'burst', fn: attackBurst },
    { name: 'burst_mixed', fn: attackBurstMixed },
    { name: 'query_injection', fn: attackQueryInjection },
    { name: 'owasp_top10', fn: attackOwaspTop10 },
    { name: 'long_path', fn: attackLongPath },
    { name: 'method_probe', fn: attackMethodProbe }
  ];
  return runTestSuite(baseUrl, targetName, outputFile, testList, headers);
}

async function runFullSuite(baseUrl, targetName, outputFile, headers) {
  const testList = [
    { name: 'normal_traffic', fn: attackNormalTraffic },
    { name: 'brute_force', fn: attackBruteForce },
    { name: 'credential_stuffing', fn: attackCredentialStuffing },
    { name: 'path_probe', fn: attackPathProbe },
    { name: 'header_probe', fn: attackHeaderProbe },
    { name: 'header_variations', fn: attackHeaderVariations },
    { name: 'burst', fn: attackBurst },
    { name: 'burst_mixed', fn: attackBurstMixed },
    { name: 'query_injection', fn: attackQueryInjection },
    { name: 'owasp_top10', fn: attackOwaspTop10 },
    { name: 'long_path', fn: attackLongPath },
    { name: 'method_probe', fn: attackMethodProbe }
  ];
  return runTestSuite(baseUrl, targetName, outputFile, testList, headers);
}

async function runDefaultComparison() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runSeed = `run-${runId}`;
  const targets = [
    { name: 'direct', url: 'http://localhost:3001' },
    { name: 'protected', url: 'http://localhost:3000' },
    { name: 'protected_fastify', url: 'http://localhost:3002' },
    { name: 'protected_hapi', url: 'http://localhost:3003' },
    { name: 'protected_koa', url: 'http://localhost:3004' },
    { name: 'protected_nest', url: 'http://localhost:3005' },
    { name: 'protected_next', url: 'http://localhost:3006' },
    { name: 'protected_adonis', url: 'http://localhost:3007' }
  ];

  const allReports = { normal: [], attacks: [] };

  targets.forEach((target, idx) => {
    target.normalIp = buildIp('198.51.100', runSeed, idx);
    target.attackIp = buildIp('203.0.113', runSeed, idx + 50);
    target.normalIpGenerator = makeIpGenerator('198.51.100', runSeed, idx + 100);
    target.attackIpGenerator = makeIpGenerator('203.0.113', runSeed, idx + 200);
  });

  for (const target of targets) {
    // Run normal traffic tests
    const normalOutputFile = buildOutputPath(`${target.name}_normal`, runId);
    console.log(`\nRunning normal traffic tests for ${target.name}...`);
    const normalReport = await runNormalTrafficOnly(
      target.url,
      target.name,
      normalOutputFile,
      makeHeaderGenerator({ 'x-forwarded-for': target.normalIp }, target.normalIpGenerator)
    );
    allReports.normal.push(normalReport);

    // Run attack tests
    const attacksOutputFile = buildOutputPath(`${target.name}_attacks`, runId);
    console.log(`\nRunning attack tests for ${target.name}...`);
    const attacksReport = await runAttacksSuite(
      target.url,
      target.name,
      attacksOutputFile,
      makeHeaderGenerator({ 'x-forwarded-for': target.attackIp }, target.attackIpGenerator)
    );
    allReports.attacks.push(attacksReport);
  }

  // Create normal vs attacks comparison
  const comparisonFile = path.join(__dirname, `comparison_modes_${runId}.json`);
  fs.writeFileSync(comparisonFile, JSON.stringify({
    runId,
    generatedAt: new Date().toISOString(),
    normal: allReports.normal,
    attacks: allReports.attacks
  }, null, 2), 'utf8');

  console.log(`\n✓ Saved comprehensive comparison: ${comparisonFile}`);
}

async function runCli() {
  const baseUrl = process.argv[2];
  const targetName = process.argv[3] || 'target';
  const modeArg = process.argv[4] || '--mode=all';
  const mode = modeArg.replace('--mode=', '');

  if (!baseUrl) {
    await runDefaultComparison();
    return;
  }

  if (!['normal', 'attacks', 'all'].includes(mode)) {
    console.error(`Invalid mode: ${mode}`);
    console.error('Valid modes: normal, attacks, all');
    console.error('');
    console.error('Usage:');
    console.error('  node attack-suite.js <baseUrl> [targetName] [--mode=normal|attacks|all]');
    console.error('');
    console.error('Examples:');
    console.error('  node attack-suite.js http://localhost:3000 protected --mode=normal');
    console.error('  node attack-suite.js http://localhost:3000 protected --mode=attacks');
    console.error('  node attack-suite.js http://localhost:3000 protected --mode=all');
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = buildOutputPath(`${targetName}_${mode}`, runId);
  const runSeed = `${targetName}-${runId}`;
  const normalIp = buildIp('198.51.100', runSeed, 1);
  const attackIp = buildIp('203.0.113', runSeed, 2);
  const normalIpGenerator = makeIpGenerator('198.51.100', runSeed, 100);
  const attackIpGenerator = makeIpGenerator('203.0.113', runSeed, 200);

  let report;
  if (mode === 'normal') {
    console.log('Running normal traffic tests...');
    report = await runNormalTrafficOnly(
      baseUrl,
      targetName,
      outputFile,
      makeHeaderGenerator({ 'x-forwarded-for': normalIp }, normalIpGenerator)
    );
  } else if (mode === 'attacks') {
    console.log('Running attack tests...');
    report = await runAttacksSuite(
      baseUrl,
      targetName,
      outputFile,
      makeHeaderGenerator({ 'x-forwarded-for': attackIp }, attackIpGenerator)
    );
  } else {
    console.log('Running full test suite (normal + attacks)...');
    report = await runFullSuite(
      baseUrl,
      targetName,
      outputFile,
      makeHeaderGenerator({ 'x-forwarded-for': normalIp }, normalIpGenerator)
    );
  }

  console.log(`\nResults: ${report.attacks.length} test(s) completed`);
  report.attacks.forEach(test => {
    const blocked = test.blocked ? ` (${test.blocked} blocked)` : '';
    console.log(`  - ${test.attack_type}: ${test.requests_sent} requests${blocked}`);
  });
}

if (require.main === module) {
  runCli().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  runNormalTrafficOnly,
  runAttacksSuite,
  runFullSuite,
  buildOutputPath,
  runDefaultComparison,
  runTestSuite
};
