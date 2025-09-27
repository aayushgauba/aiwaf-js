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
// Captures: 1) client IP, 2) timestamp, 3) request URI, 4) status code, 5) response‐time
const LINE_RX = /(\d+\.\d+\.\d+\.\d+).*?\[(.*?)\].*?"(?:GET|POST|PUT|DELETE|HEAD|OPTIONS) (.*?) HTTP\/.*?" (\d{3}).*?(?:response-time=(\d+\.\d+)|$)/;

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
// Parse a single log line into a request object
//

function parseLogLine(line) {
  const m = LINE_RX.exec(line);
  if (!m) return null;

  // m[1] = IP address
  // m[2] = timestamp string
  // m[3] = URI with optional query
  // m[4] = status code
  // m[5] = response‐time (optional)
  const ip = m[1];
  const timestampStr = m[2];
  const uri = m[3].split('?')[0];
  const status = m[4];
  const rt = m[5] ? parseFloat(m[5]) : 0.0;

  // Parse timestamp (format: dd/MMM/yyyy:HH:mm:ss +0000)
  let timestamp = new Date();
  try {
    // Remove timezone offset for simplicity
    const cleanTimestamp = timestampStr.split(' ')[0];
    timestamp = new Date(cleanTimestamp.replace(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1 $4:$5:$6'));
    
    // Convert month names to numbers
    const monthMap = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
      'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
      'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    
    const parts = cleanTimestamp.split(/[\/:\s]/);
    if (parts.length >= 6) {
      const day = parts[0];
      const month = monthMap[parts[1]] || '01';
      const year = parts[2];
      const hour = parts[3];
      const minute = parts[4];
      const second = parts[5];
      
      timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    }
  } catch (err) {
    // Fall back to current time if parsing fails
    timestamp = new Date();
  }

  return {
    ip,
    path: uri,
    status,
    responseTime: rt,
    timestamp
  };
}

//
// Convert parsed requests into feature vectors with proper burst and 404 calculations
//

function calculateFeatures(parsedRequests) {
  // Group requests by IP for burst and 404 calculations
  const ipRequests = new Map();
  const ip404Counts = new Map();

  // Group requests by IP and count 404s
  for (const req of parsedRequests) {
    if (!ipRequests.has(req.ip)) {
      ipRequests.set(req.ip, []);
    }
    ipRequests.get(req.ip).push(req);

    if (req.status === '404') {
      ip404Counts.set(req.ip, (ip404Counts.get(req.ip) || 0) + 1);
    }
  }

  const features = [];

  for (const req of parsedRequests) {
    const pathLen = req.path.length;

    const kwHits = STATIC_KW.reduce(
      (sum, kw) => sum + (req.path.toLowerCase().includes(kw) ? 1 : 0),
      0
    );

    const statusIdx = STATUS_IDX.indexOf(req.status) >= 0
      ? STATUS_IDX.indexOf(req.status)
      : -1;

    const respTime = req.responseTime;

    // Calculate burst count: requests from same IP within 10 seconds
    const ipReqs = ipRequests.get(req.ip);
    const burst = ipReqs.filter(r => 
      Math.abs(r.timestamp.getTime() - req.timestamp.getTime()) <= 10000
    ).length;

    // Get total 404 count for this IP
    const total404 = ip404Counts.get(req.ip) || 0;

    features.push([pathLen, kwHits, statusIdx, respTime, burst, total404]);
  }

  return features;
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

    console.log(`Processing ${raw.length} log lines...`);

    // Parse all log lines into request objects
    const parsedRequests = raw
      .map(parseLogLine)
      .filter(req => req !== null);

    if (parsedRequests.length === 0) {
      console.warn('No valid log lines parsed.');
      return;
    }

    console.log(`Parsed ${parsedRequests.length} valid requests`);

    // Calculate features with proper burst and 404 counts
    const features = calculateFeatures(parsedRequests);

    if (features.length === 0) {
      console.warn('No features generated.');
      return;
    }

    console.log(`Generated ${features.length} feature vectors`);

    // Train the Isolation Forest
    const model = new IsolationForest({ nTrees: 100, sampleSize: 256 });
    model.fit(features);

    // Persist the trained model
    const outDir  = path.join(__dirname, 'resources');
    const outFile = path.join(outDir, 'model.json');
    fs.mkdirSync(outDir, { recursive: true });

    // Create model data with metadata
    const modelData = {
      ...model.toJSON(),
      metadata: {
        createdAt: new Date().toISOString(),
        samplesCount: features.length,
        featureCount: 6,
        version: '1.0'
      }
    };

    fs.writeFileSync(outFile, JSON.stringify(modelData, null, 2), 'utf8');

    console.log(`✅ Trained on ${features.length} samples → ${outFile}`);
    
    // Show some statistics
    const ipCounts = new Map();
    const statusCounts = new Map();
    
    for (const req of parsedRequests) {
      ipCounts.set(req.ip, (ipCounts.get(req.ip) || 0) + 1);
      statusCounts.set(req.status, (statusCounts.get(req.status) || 0) + 1);
    }
    
    console.log(`📊 Statistics:`);
    console.log(`   - Unique IPs: ${ipCounts.size}`);
    console.log(`   - Status codes: ${JSON.stringify(Object.fromEntries(statusCounts))}`);
    console.log(`   - Top 5 IPs by request count:`);
    
    const topIps = Array.from(ipCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    topIps.forEach(([ip, count]) => {
      console.log(`     ${ip}: ${count} requests`);
    });

  } catch (err) {
    console.error('Training failed:', err);
  }
})();
