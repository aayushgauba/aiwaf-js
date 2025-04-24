# aiwaf‑js

> **Adaptive Web Application Firewall** middleware for Node.js & Express  
> Self‑learning, plug‑and‑play WAF with rate‑limiting, static & dynamic keyword blocking, honeypot traps, UUID‑tamper protection and IsolationForest anomaly detection—fully configurable and trainable on your own access logs. Now Redis‑powered and ready for distributed, multiprocess use.

[![npm version](https://img.shields.io/npm/v/aiwaf-js.svg)](https://www.npmjs.com/package/aiwaf-js)  
[![Build Status](https://img.shields.io/github/actions/workflow/status/your‑user/aiwaf-js/ci.yml)](https://github.com/your‑user/aiwaf-js/actions)  
[![License](https://img.shields.io/npm/l/aiwaf-js.svg)](LICENSE)

## Features

- Rate Limiting (Redis-based or fallback)
- Static Keyword Blocking
- Dynamic Keyword Learning (self-adaptive)
- Honeypot Field Detection
- UUID‑Tamper Protection
- Anomaly Detection (Isolation Forest)
- Offline Retraining
- Redis Support (optional but recommended)
- Multiprocess Safe

## Installation

```bash
npm install aiwaf-js --save
```

## Quick Start

```js
const express = require('express')
const aiwaf   = require('aiwaf-js')

const app = express()
app.use(express.json())
app.use(aiwaf())
app.get('/', (req, res) => res.send('Protected'))
app.listen(3000)
```

## Redis Support

AIWAF‑JS supports Redis to share rate limit counters across processes and servers. You can configure Redis by setting the `REDIS_URL` environment variable:

```bash
# On Unix/Linux/macOS
export REDIS_URL=redis://localhost:6379

# On Windows PowerShell
$env:REDIS_URL = "redis://localhost:6379"
```

If Redis is not available, it will gracefully fall back to in-memory tracking (suitable for dev and single‑instance deployments).

## Training

```bash
NODE_LOG_PATH=/path/to/access.log npm run train
```

## Usage Example

```js
const express = require('express');
const aiwaf = require('aiwaf-js');

const app = express();
app.use(express.json());

app.use(aiwaf({
  staticKeywords: ['.php', '.env', '.git'],
  dynamicTopN: 10,
  WINDOW_SEC: 10,
  MAX_REQ: 20,
  FLOOD_REQ: 10,
  HONEYPOT_FIELD: 'hp_field',
}));

app.get('/', (req, res) => res.send('Protected by AIWAF-JS'));
app.listen(3000, () => console.log('Server running on http://localhost:3000'));
```


## Configuration Options

| Option             | Env Var             | Default                               | Description                                                             |
|--------------------|---------------------|---------------------------------------|-------------------------------------------------------------------------|
| `staticKeywords`   | —                   | [".php",".xmlrpc","wp-"]              | Substrings to block immediately.                                       |
| `dynamicTopN`      | `DYNAMIC_TOP_N`     | 10                                    | Number of top “learned” keywords to match per request.                 |
| `windowSec`        | `WINDOW_SEC`        | 10                                    | Time window (in seconds) for rate limiting.                            |
| `maxReq`           | `MAX_REQ`           | 20                                    | Max requests allowed in `windowSec`.                                   |
| `floodReq`         | `FLOOD_REQ`         | 10                                    | If requests exceed this, IP is blocked outright.                       |
| `honeypotField`    | `HONEYPOT_FIELD`    | "hp_field"                            | Hidden field for bot detection.                                        |
| `anomalyThreshold` | `ANOMALY_THRESHOLD` | 0.5                                   | IsolationForest threshold for anomaly.                                 |
| `logPath`          | `NODE_LOG_PATH`     | "/var/log/nginx/access.log"           | Path to main access log.                                               |
| `logGlob`          | `NODE_LOG_GLOB`     | "${logPath}.*"                        | Includes rotated/gzipped logs.                                         |

## License

MIT License © 2025 Aayush Gauba
