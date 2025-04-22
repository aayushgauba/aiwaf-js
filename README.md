# aiwaf‑js

> **Adaptive Web Application Firewall** middleware for Node.js & Express  
> Self‑learning, plug‑and‑play WAF with rate‑limiting, static & dynamic keyword blocking, honeypot traps, UUID‑tamper protection and IsolationForest anomaly detection—fully configurable and trainable on your own access logs.

[![npm version](https://img.shields.io/npm/v/aiwaf-js.svg)](https://www.npmjs.com/package/aiwaf-js)  
[![Build Status](https://img.shields.io/github/actions/workflow/status/your‑user/aiwaf-js/ci.yml)](https://github.com/your‑user/aiwaf-js/actions)  
[![License](https://img.shields.io/npm/l/aiwaf-js.svg)](LICENSE)

## Features

- Rate Limiting
- Static Keyword Blocking
- Dynamic Keyword Learning
- Honeypot Field Detection
- UUID‑Tamper Protection
- Anomaly Detection (Isolation Forest)
- Offline Retraining

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

## Training

```bash
NODE_LOG_PATH=/path/to/access.log npm run train
```


## Usage Example

Here’s a simple Express app that uses `aiwaf-js` with custom settings:

```js
const express = require('express');
const aiwaf = require('aiwaf-js');

const app = express();
app.use(express.json());

app.use(aiwaf({
  staticKeywords: ['.php', '.env', '.git'],  // ← add .php here
  dynamicTopN: 10,
  WINDOW_SEC: 10,
  MAX_REQ: 20,
  FLOOD_REQ: 10,
  HONEYPOT_FIELD: 'hp_field',
}));

app.get('/', (req, res) => res.send('Protected by AIWAF-JS'));
app.listen(3000, () => console.log('Server running on http://localhost:3000'));
```

## License

MIT License © 2025 Aayush Gauba

## Configuration Options

You can pass an options object to `aiwaf(opts)` or use environment variables.

| Option             | Env Var             | Default                               | Description                                                             |
|--------------------|---------------------|---------------------------------------|-------------------------------------------------------------------------|
| `staticKeywords`   | —                   | [".php",".xmlrpc","wp-",…]            | Substrings to block immediately.                                       |
| `dynamicTopN`      | `DYNAMIC_TOP_N`     | 10                                    | Number of top “learned” keywords to match per request.                 |
| `windowSec`        | `WINDOW_SEC`        | 10                                    | Time window (in seconds) for rate limiting and burst calculation.      |
| `maxReq`           | `MAX_REQ`           | 20                                    | Maximum requests allowed in `windowSec`.                               |
| `floodReq`         | `FLOOD_REQ`         | 10                                    | If requests exceed this in `windowSec`, IP is blacklisted outright.    |
| `honeypotField`    | `HONEYPOT_FIELD`    | "hp_field"                            | Name of the hidden form field to detect bots.                          |
| `anomalyThreshold` | `ANOMALY_THRESHOLD` | 0.5                                   | IsolationForest score threshold above which requests are anomalous.    |
| `logPath`          | `NODE_LOG_PATH`     | "/var/log/nginx/access.log"           | Path to your main access log (used by `train.js`).                     |
| `logGlob`          | `NODE_LOG_GLOB`     | `${logPath}.*`                        | Glob pattern to include rotated/gzipped logs.                          |
