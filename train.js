// train.js

const fs       = require('fs');
const path     = require('path');
const glob     = require('glob');
const zlib     = require('zlib');
const readline = require('readline');
const { IsolationForest } = require('./lib/isolationForest');

//
// Configuration
//

// Static malicious keywords to count in URLs
const STATIC_KW  = [
  '.php', '.xmlrpc', 'wp-', '.env', '.git', '.bak',
  'conflg', 'shell', 'filemanager'
];

// Status codes we index
const STATUS_IDX = ['200','403','404','500'];

// Default log input paths (can be overridden with env vars)
const LOG_PATH = process.env.NODE_LOG_PATH
  || '/var/log/nginx/access.log';
const LOG_GLOB = process.env.NODE_LOG_GLOB
  || `${LOG_PATH}.*`;

// Regex to parse each access‐log line.
// Captures: 1) client IP, 2) request URI, 3) status code, 4) response‐time
const LINE_RX = /(\d+\.\d+\.\d+\.\d+).*"(?:GET|POST) (.*?) HTTP\/.*?" (\d{3}).*?response-time=(\d+\.\d+)/;

//
// Helpers to read log files
//

async function* readLines(file) {
  const stream = file.endsWith('.gz')
    ? fs.createReadStream(file).pipe(zlib.createGunzip())
    : fs.createReadStream(file);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}

async function readAllLogs() {
  const lines = [];

  // main log
  if (fs.existsSync(LOG_PATH)) {
    for await (const l of readLines(LOG_PATH)) {
      lines.push(l);
    }
  }

  // rotated / gzipped files
  for (const f of glob.sync(LOG_GLOB)) {
    for await (const l of readLines(f)) {
      lines.push(l);
    }
  }

  return lines;
}

//
// Convert a single log line into a 6‑dimensional feature vector:
// [ pathLength, keywordHits, statusIdx, responseTime, burst=0, total404=0 ]
//

function parseLineToFeatures(line) {
  const m = LINE_RX.exec(line);
  if (!m) return null;

  // m[2] = URI with optional query
  // m[3] = status code
  // m[4] = response‐time
  const uri    = m[2].split('?')[0];
  const status = m[3];
  const rt     = parseFloat(m[4]);

  // Feature 1: length of the path
  const pathLen = uri.length;

  // Feature 2: count of static keywords in the path
  const kwHits = STATIC_KW.reduce(
    (sum, kw) => sum + (uri.toLowerCase().includes(kw) ? 1 : 0),
    0
  );

  // Feature 3: status code index
  const statusIdx = STATUS_IDX.indexOf(status) >= 0
    ? STATUS_IDX.indexOf(status)
    : -1;

  // Feature 4: response time
  const respTime = rt;

  // Features 5 & 6 are placeholders (burst count and total 404s)
  const burst    = 0;
  const total404 = 0;

  return [pathLen, kwHits, statusIdx, respTime, burst, total404];
}

//
// Main training routine
//

(async () => {
  try {
    const raw = await readAllLogs();
    if (raw.length === 0) {
      console.warn('No logs found – please set NODE_LOG_PATH to your access log.');
      return;
    }

    // Build feature matrix
    const feats = raw
      .map(parseLineToFeatures)
      .filter(f => f !== null);

    if (feats.length === 0) {
      console.warn('No valid log lines parsed into features.');
      return;
    }

    // Train the Isolation Forest
    const model = new IsolationForest({ nTrees: 100, sampleSize: 256 });
    model.fit(feats);

    // Persist the trained model
    const outDir  = path.join(__dirname, 'resources');
    const outFile = path.join(outDir, 'model.json');
    fs.mkdirSync(outDir, { recursive: true });

    // Serialize the model; if your IsolationForest supports .serialize(), use that.
    // Otherwise we simply JSON‐stringify the internal tree structure.
    fs.writeFileSync(outFile, JSON.stringify(model), 'utf8');

    console.log(`✅ Trained on ${feats.length} samples → ${outFile}`);
  } catch (err) {
    console.error('Training failed:', err);
  }
})();
