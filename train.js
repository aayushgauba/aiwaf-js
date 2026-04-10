const fs = require('fs');
const path = require('path');
const glob = require('glob');
const zlib = require('zlib');
const readline = require('readline');
const { IsolationForest } = require('./lib/isolationForest');
const requestLogStore = require('./lib/requestLogStore');
const modelStore = require('./lib/modelStore');

const STATIC_KW = [
  '.php', '.xmlrpc', 'wp-', '.env', '.git', '.bak',
  'conflg', 'shell', 'filemanager'
];

const STATUS_IDX = ['200', '403', '404', '500'];

const LOG_PATH = process.env.NODE_LOG_PATH || '/var/log/nginx/access.log';
const LOG_GLOB = process.env.NODE_LOG_GLOB || `${LOG_PATH}.*`;
const MIDDLEWARE_LOG_PATH = process.env.AIWAF_MIDDLEWARE_LOG_PATH || path.join(__dirname, 'logs', 'aiwaf-requests.jsonl');
const MIDDLEWARE_LOG_CSV_PATH = process.env.AIWAF_MIDDLEWARE_LOG_CSV_PATH || path.join(__dirname, 'logs', 'aiwaf-requests.csv');
const MIN_TRAIN_LOGS = Number(process.env.AIWAF_MIN_TRAIN_LOGS || process.env.AIWAF_MIN_AI_LOGS || 100);
const FORCE_TRAINING = ['1', 'true', 'yes', 'on'].includes(String(process.env.AIWAF_FORCE_AI_TRAINING || '').toLowerCase());

const LINE_RX = /(\d+\.\d+\.\d+\.\d+).*?\[(.*?)\].*?"(?:GET|POST|PUT|DELETE|HEAD|OPTIONS) (.*?) HTTP\/.*?" (\d{3}).*?(?:response-time=(\d+\.\d+)|$)/;

async function* readLines(file) {
  const stream = file.endsWith('.gz')
    ? fs.createReadStream(file).pipe(zlib.createGunzip())
    : fs.createReadStream(file);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}

async function readAccessLogLines() {
  const lines = [];

  if (fs.existsSync(LOG_PATH)) {
    for await (const line of readLines(LOG_PATH)) {
      lines.push(line);
    }
  }

  for (const rotatedPath of glob.sync(LOG_GLOB)) {
    for await (const line of readLines(rotatedPath)) {
      lines.push(line);
    }
  }

  return lines;
}

async function readMiddlewareEvents() {
  if (!fs.existsSync(MIDDLEWARE_LOG_PATH)) return [];

  const events = [];
  for await (const line of readLines(MIDDLEWARE_LOG_PATH)) {
    const raw = String(line || '').trim();
    if (!raw) continue;

    try {
      const event = JSON.parse(raw);
      events.push(event);
    } catch (err) {
      // Ignore malformed lines.
    }
  }

  return events;
}

async function readMiddlewareCsvEvents() {
  if (!fs.existsSync(MIDDLEWARE_LOG_CSV_PATH)) return [];

  const events = [];
  let isFirstLine = true;
  for await (const line of readLines(MIDDLEWARE_LOG_CSV_PATH)) {
    const raw = String(line || '').trim();
    if (!raw) continue;
    if (isFirstLine) {
      isFirstLine = false;
      if (raw.toLowerCase().startsWith('timestamp,')) {
        continue;
      }
    }

    const parts = raw.match(/("([^"]|"")*"|[^,]+)/g) || [];
    const unquote = val => {
      const trimmed = String(val || '').trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/""/g, '"');
      }
      return trimmed;
    };

    events.push({
      timestamp: unquote(parts[0] || ''),
      ip: unquote(parts[1] || ''),
      method: unquote(parts[2] || ''),
      path: unquote(parts[3] || ''),
      status: unquote(parts[4] || ''),
      responseTime: unquote(parts[5] || '')
    });
  }

  return events;
}

async function readDbRequestLogs() {
  try {
    const rows = await requestLogStore.recent(20000);
    return rows.map(row => ({
      ip: row.ip_address,
      path: row.path,
      status: row.status,
      responseTime: row.response_time_ms,
      timestamp: row.created_at
    }));
  } catch (err) {
    return [];
  }
}

function parseLogLine(line) {
  const match = LINE_RX.exec(line);
  if (!match) return null;

  const ip = match[1];
  const timestampStr = match[2];
  const uri = match[3].split('?')[0];
  const status = match[4];
  const rt = match[5] ? parseFloat(match[5]) : 0.0;

  let timestamp = new Date();
  try {
    const cleanTimestamp = timestampStr.split(' ')[0];
    const monthMap = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04',
      May: '05', Jun: '06', Jul: '07', Aug: '08',
      Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };

    const parts = cleanTimestamp.split(/[/:\s]/);
    if (parts.length >= 6) {
      const [day, monthText, year, hour, minute, second] = parts;
      const month = monthMap[monthText] || '01';
      timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    }
  } catch (err) {
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

function parseMiddlewareEvent(event) {
  if (!event || !event.path || !event.ip) return null;

  return {
    ip: String(event.ip),
    path: String(event.path).split('?')[0],
    status: String(event.status || 200),
    responseTime: Number(event.responseTime || 0),
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date()
  };
}

function parseDbEvent(event) {
  if (!event || !event.path || !event.ip) return null;
  return {
    ip: String(event.ip),
    path: String(event.path).split('?')[0],
    status: String(event.status || 200),
    responseTime: Number(event.responseTime || 0),
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date()
  };
}

function calculateFeatures(parsedRequests) {
  const ipRequests = new Map();
  const ip404Counts = new Map();

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

    const ipReqs = ipRequests.get(req.ip);
    const burst = ipReqs.filter(item => Math.abs(item.timestamp.getTime() - req.timestamp.getTime()) <= 10000).length;

    const total404 = ip404Counts.get(req.ip) || 0;

    features.push([pathLen, kwHits, statusIdx, respTime, burst, total404]);
  }

  return features;
}

(async () => {
  try {
    const rawAccessLines = await readAccessLogLines();
    let parsedRequests = rawAccessLines.map(parseLogLine).filter(Boolean);

    if (parsedRequests.length === 0) {
      const middlewareEvents = await readMiddlewareEvents();
      parsedRequests = middlewareEvents.map(parseMiddlewareEvent).filter(Boolean);

      if (parsedRequests.length > 0) {
        console.log(`Using middleware logs from ${MIDDLEWARE_LOG_PATH} (${parsedRequests.length} records)`);
      }
    }

    if (parsedRequests.length === 0) {
      const csvEvents = await readMiddlewareCsvEvents();
      parsedRequests = csvEvents.map(parseMiddlewareEvent).filter(Boolean);
      if (parsedRequests.length > 0) {
        console.log(`Using middleware CSV logs from ${MIDDLEWARE_LOG_CSV_PATH} (${parsedRequests.length} records)`);
      }
    }

    if (parsedRequests.length === 0) {
      const dbEvents = await readDbRequestLogs();
      parsedRequests = dbEvents.map(parseDbEvent).filter(Boolean);
      if (parsedRequests.length > 0) {
        console.log(`Using request_logs table (${parsedRequests.length} records)`);
      }
    }

    if (parsedRequests.length === 0) {
      console.warn('No logs found. Set NODE_LOG_PATH or enable AIWAF middleware logging.');
      return;
    }

    if (parsedRequests.length < MIN_TRAIN_LOGS && !FORCE_TRAINING) {
      console.warn(`Insufficient logs (${parsedRequests.length}) < AIWAF_MIN_TRAIN_LOGS (${MIN_TRAIN_LOGS}). Set AIWAF_FORCE_AI_TRAINING=true to override.`);
      return;
    }

    console.log(`Parsed ${parsedRequests.length} valid requests`);

    const features = calculateFeatures(parsedRequests);
    if (features.length === 0) {
      console.warn('No features generated.');
      return;
    }

    console.log(`Generated ${features.length} feature vectors`);

    const model = new IsolationForest({ nTrees: 100, sampleSize: 256 });
    model.fit(features);

    const modelData = {
      ...model.toJSON(),
      metadata: {
        createdAt: new Date().toISOString(),
        samplesCount: features.length,
        featureCount: 6,
        version: '1.1'
      }
    };

    await modelStore.save(process.env, modelData, modelData.metadata);
    console.log(`Trained on ${features.length} samples`);
  } catch (err) {
    console.error('Training failed:', err);
  }
})();
