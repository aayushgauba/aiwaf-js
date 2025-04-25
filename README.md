# aiwaf‑js

> **Adaptive Web Application Firewall** middleware for Node.js & Express  
> Self‑learning, plug‑and‑play WAF with rate‑limiting, static & dynamic keyword blocking, honeypot traps, UUID‑tamper protection, and IsolationForest anomaly detection—fully configurable and trainable on your own access logs. Now Redis‑powered and ready for distributed, multiprocess use.

[![npm version](https://img.shields.io/npm/v/aiwaf-js.svg)](https://www.npmjs.com/package/aiwaf-js)  
[![Build Status](https://img.shields.io/github/actions/workflow/status/your-user/aiwaf-js/ci.yml)](https://github.com/your-user/aiwaf-js/actions)  
[![License](https://img.shields.io/npm/l/aiwaf-js.svg)](LICENSE)

---

## Features

- ✅ Rate Limiting (Redis-based or fallback to memory)
- ✅ Static Keyword Blocking
- ✅ Dynamic Keyword Learning (auto-adaptive)
- ✅ Honeypot Field Detection
- ✅ UUID‑Tamper Protection
- ✅ Anomaly Detection (Isolation Forest)
- ✅ Redis Support for multiprocess environments
- ✅ Offline Training from access logs
- ✅ **Custom Cache Logic Support**

---

## Installation

```bash
npm install aiwaf-js --save
```

---

## Train the Model (Optional but recommended)

You can train the anomaly detector and keyword learner using real access logs.

```bash
NODE_LOG_PATH=/path/to/access.log npm run train
```

If `NODE_LOG_PATH` is not provided, it defaults to `/var/log/nginx/access.log`.

---

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

---

## Redis Support (Recommended for Production)

AIWAF‑JS supports Redis for distributed rate limiting and keyword caching.

```bash
# On Unix/Linux/macOS
export REDIS_URL=redis://localhost:6379

# On Windows PowerShell
$env:REDIS_URL = "redis://localhost:6379"
```

If Redis is unavailable, it gracefully falls back to in-memory mode.

---

## Custom Cache Logic (Advanced)

You can inject your own cache logic (in-memory, Redis, hybrid, or file-based) by passing a `cache` object implementing the following interface:

```js
const myCustomCache = {
  get: async (key) => { /* return cached value */ },
  set: async (key, value, options) => { /* store with optional TTL */ },
  del: async (key) => { /* delete entry */ }
}

app.use(aiwaf({
  cache: myCustomCache,
  staticKeywords: ['.php'],
  dynamicTopN: 5,
  MAX_REQ: 10,
  WINDOW_SEC: 15,
  FLOOD_REQ: 20,
}))
```

This overrides Redis/in-memory usage with your custom strategy for all cache operations.

---

## Configuration

```js
app.use(aiwaf({
  staticKeywords: ['.php', '.env', '.git'],
  dynamicTopN: 10,
  WINDOW_SEC: 10,
  MAX_REQ: 20,
  FLOOD_REQ: 10,
  HONEYPOT_FIELD: 'hp_field',
  cache: myCustomCache, // optional custom cache injection
}));
```

| Option             | Env Var             | Default                     | Description                                              |
|--------------------|---------------------|-----------------------------|----------------------------------------------------------|
| `staticKeywords`   | —                   | [".php",".xmlrpc","wp-"]    | Substrings to block immediately.                        |
| `dynamicTopN`      | `DYNAMIC_TOP_N`     | 10                          | Number of dynamic keywords to match.                    |
| `windowSec`        | `WINDOW_SEC`        | 10                          | Time window in seconds for rate limiting.               |
| `maxReq`           | `MAX_REQ`           | 20                          | Max allowed requests per window.                        |
| `floodReq`         | `FLOOD_REQ`         | 10                          | Hard limit triggering IP block.                         |
| `honeypotField`    | `HONEYPOT_FIELD`    | "hp_field"                  | Hidden bot trap field.                                  |
| `anomalyThreshold` | `ANOMALY_THRESHOLD` | 0.5                         | Threshold for IsolationForest-based anomaly detection.  |
| `logPath`          | `NODE_LOG_PATH`     | "/var/log/nginx/access.log" | Path to access log file.                                |
| `logGlob`          | `NODE_LOG_GLOB`     | "${logPath}.*"              | Glob pattern to include rotated/gzipped logs.           |
| `cache`            | —                   | undefined                   | Custom cache implementation (overrides Redis/memory)    |

---

## Optimization Note

**Tip:** In high-volume environments, caching the feature vector extractor (especially if Redis is unavailable) can reduce redundant computation and significantly boost performance.

---

## 📄 License

MIT License © 2025 [Aayush Gauba](https://github.com/aayushg)