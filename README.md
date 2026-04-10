# aiwaf-js

AIWAF-JS is a Node.js web application firewall middleware focused on Express applications. It combines deterministic request checks with anomaly detection so you can block abusive traffic, detect suspicious behavior, and retrain from access logs.

## What It Does

- Blocks known bad traffic with static keyword rules and IP blacklisting
- Enforces rate limits with flood detection
- Detects bot-like form abuse using honeypot field checks
- Blocks suspicious UUID probing on sensitive route prefixes
- Learns high-frequency path segments as dynamic suspicious keywords
- Runs IsolationForest anomaly checks on feature vectors for unknown routes
- Supports Redis and custom cache backends with memory fallback

## Repository Layout

- `index.js`: package entrypoint
- `lib/wafMiddleware.js`: main middleware orchestration
- `lib/rateLimiter.js`: rate-window and flood logic
- `lib/blacklistManager.js`: blocked IP persistence and operations
- `lib/keywordDetector.js`: static keyword checks
- `lib/dynamicKeyword.js`: in-memory dynamic keyword learning/checking
- `lib/uuidDetector.js`: UUID tamper detection
- `lib/honeypotDetector.js`: honeypot trap detection
- `lib/anomalyDetector.js`: pretrained model loading and anomaly scoring
- `lib/featureUtils.js`: request feature extraction and short-lived caching
- `lib/isolationForest.js`: IsolationForest implementation
- `lib/redisClient.js`: optional Redis client lifecycle
- `train.js`: offline model training from access logs
- `resources/model.json`: pretrained anomaly model artifact
- `utils/db.js`: SQLite connection (memory DB in test)
- `migrations/`: schema migration files for blocked IP and dynamic keyword storage
- `test/waf.test.js`: middleware test coverage

## Request Processing Flow

1. Initialize module options for rate limiter, keyword detectors, honeypot, UUID checks, and anomaly detector.
2. Resolve client IP (`x-forwarded-for` first, then `req.ip`) and normalized path.
3. Update dynamic keyword counters from current path.
4. Block immediately if IP is already in blacklist.
5. Block and blacklist on honeypot trigger.
6. Record request in rate limiter and enforce rate/flood policies.
7. Block and blacklist on static keyword match.
8. Block and blacklist on dynamic keyword match.
9. Block and blacklist on suspicious UUID access.
10. For unknown routes, extract request features and run anomaly detection; block and blacklist on anomaly.
11. Allow request through `next()` when no rule triggers.

## Installation

```bash
npm install aiwaf-js
```

## Quick Start

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
  FLOOD_REQ: 40,
  HONEYPOT_FIELD: 'hp_field',
  uuidRoutePrefix: '/user'
}));

app.get('/', (req, res) => res.send('Protected'));
app.listen(3000);
```

## Configuration

| Option | Default | Description |
|---|---|---|
| `staticKeywords` | `[]` | Substrings that trigger immediate block + blacklist |
| `dynamicTopN` or `DYNAMIC_TOP_N` | `10` | Frequency threshold for dynamic segment blocking |
| `WINDOW_SEC` | `60` | Time window for rate limiting |
| `MAX_REQ` | `100` | Max allowed requests in window before rate block |
| `FLOOD_REQ` | `200` | Hard threshold that blacklists IP |
| `HONEYPOT_FIELD` | `undefined` | Body field name used as bot trap |
| `uuidRoutePrefix` | `"/user"` | Path prefix monitored for UUID tamper attempts |
| `cache` | fallback memory cache | Custom cache backend used by limiter/features |
| `nTrees` | `100` | IsolationForest trees when model is initialized in-process |
| `sampleSize` | `256` | IsolationForest sample size |

## Redis and Cache Behavior

- Set `REDIS_URL` (or `AIWAF_REDIS_URL`) to enable Redis connectivity (`lib/redisClient.js`).
- If Redis is unavailable, runtime falls back to in-memory behavior.
- You can inject a custom cache object.

Rate limiter custom cache must implement:

- `lPush(key, value)`
- `expire(key, ttl)`
- `lLen(key)`
- `lRange(key, start, end)`

Feature cache custom backend supports:

- `get(key)`
- `set(key, value, ttl)`

## Geo Blocking (MMDB)

- Put your DB at `geolock/ipinfo_lite.mmdb` (default) or set `AIWAF_GEO_MMDB_PATH`.
- Enable with `AIWAF_GEO_BLOCK_ENABLED: true`.
- Configure `AIWAF_GEO_BLOCK_COUNTRIES` and/or `AIWAF_GEO_ALLOW_COUNTRIES`.
- Install MMDB reader dependency in your app:
  - `npm install maxmind`
- If MMDB is unavailable, the middleware falls back to `x-country-code` header.

## Offline Training

Train a model using access logs:

```bash
NODE_LOG_PATH=/path/to/access.log npm run train
```

Optional rotated/gz support:

```bash
NODE_LOG_GLOB='/path/to/access.log.*' npm run train
```

Training pipeline in `train.js`:

- Reads raw and rotated (including `.gz`) access logs
- Parses request fields (IP, URI, status, response time, timestamp)
- Builds feature vectors: `[pathLen, kwHits, statusIdx, responseTime, burst, total404]`
- Trains IsolationForest
- Writes model artifact to `resources/model.json` with metadata
- Model storage backends:
  - `AIWAF_MODEL_STORAGE`: `file` (default), `db`, `cache`
  - `AIWAF_MODEL_PATH` (file backend)
  - `AIWAF_MODEL_STORAGE_FALLBACK` (fallback backend)
  - `AIWAF_MODEL_CACHE_KEY`, `AIWAF_MODEL_CACHE_TTL` (cache backend)

## Testing

```bash
npm test
```

Current tests cover:

- Static keyword blocking
- Safe path pass-through
- Rate-limit behavior
- Honeypot blocking
- UUID tamper blocking
- Dynamic keyword learning/blocking
- Anomaly blocking
- Redis failure fallback behavior

## Data and Persistence

- Runtime blacklist storage uses SQLite through `utils/db.js`.
- Production DB file defaults to `./aiwaf.sqlite`.
- Test environment uses in-memory SQLite (`NODE_ENV=test`).
- Primary blocked IP table: `blocked_ips`.
- Middleware logging supports JSONL, optional SQLite, and CSV fallback.
- CSV settings:
  - `AIWAF_MIDDLEWARE_LOG_CSV`
  - `AIWAF_MIDDLEWARE_LOG_CSV_PATH`
- Table storage CSV fallbacks are enabled automatically when DB operations fail:
  - `blocked_ips` -> `logs/storage/blocked_ips.csv` (`AIWAF_BLOCKED_IPS_CSV_PATH`)
  - `ip_exemptions` -> `logs/storage/ip_exemptions.csv` (`AIWAF_IP_EXEMPTIONS_CSV_PATH`)
  - `path_exemptions` -> `logs/storage/path_exemptions.csv` (`AIWAF_PATH_EXEMPTIONS_CSV_PATH`)
  - `geo_blocked_countries` -> `logs/storage/geo_blocked_countries.csv` (`AIWAF_GEO_BLOCKED_COUNTRIES_CSV_PATH`)
  - `request_logs` -> `logs/storage/request_logs.csv` (`AIWAF_REQUEST_LOGS_CSV_PATH`)
  - `dynamic_keywords` -> `logs/storage/dynamic_keywords.csv` (`AIWAF_DYNAMIC_KEYWORDS_CSV_PATH`)

## Operational Notes

- Middleware order matters; place AIWAF after body parsers if honeypot checks depend on parsed JSON/form body.
- If no trained model exists or loading fails, anomaly detector fails open.
- Dynamic keyword learning is in-memory for process lifetime.
- Multi-instance deployments should use Redis/custom shared cache for limiter consistency.

## Development

```bash
npm install
npm test
npm run train
npm run aiwaf -- help
```

## Operations CLI

```bash
npm run aiwaf -- list blacklist
npm run aiwaf -- list exemptions
npm run aiwaf -- add ip-exemption 203.0.113.10 "trusted monitor"
npm run aiwaf -- add path-exemption /health "health probes"
npm run aiwaf -- geo block CN "manual block"
npm run aiwaf -- geo summary
npm run aiwaf -- diagnose 203.0.113.10
```

## License

MIT
