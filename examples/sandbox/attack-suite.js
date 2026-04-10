#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function buildOutputPath(targetName, runId) {
  return path.join(__dirname, `results_${targetName}_${runId}.json`);
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

async function requestOnce(method, url, options = {}) {
  const start = nowMs();
  let status = 0;
  let error = null;
  try {
    const res = await fetch(url, {
      method,
      headers: options.headers,
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

async function runSuite(baseUrl, targetName, outputFile) {
  const health = await requestOnce('GET', `${baseUrl}/`);
  if (health.status === 0) {
    const reason = health.error ? ` (${health.error})` : '';
    throw new Error(`Unable to reach ${baseUrl}${reason}. Is it running and reachable?`);
  }

  const attacks = [
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

  const report = {
    target: targetName,
    baseUrl,
    runId: outputFile ? path.basename(outputFile).replace(/^results_/, '').replace(/\.json$/, '') : new Date().toISOString(),
    startedAt: new Date().toISOString(),
    attacks: []
  };

  for (const attack of attacks) {
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

async function runCli() {
  const baseUrl = process.argv[2];
  const targetName = process.argv[3] || 'target';

  if (!baseUrl) {
    console.error('Usage: node attack-suite.js <baseUrl> <targetName>');
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = buildOutputPath(targetName, runId);

  await runSuite(baseUrl, targetName, outputFile);
}

if (require.main === module) {
  runCli().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  runSuite,
  buildOutputPath
};
