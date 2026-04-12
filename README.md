# aiwaf-js

AIWAF-JS is a Node.js/Express Web Application Firewall that combines deterministic protections with anomaly detection and continuous learning. It ships as middleware, a CLI for ops workflows, and an offline trainer for IsolationForest models.
Supported frameworks: Express (native), Fastify, Hapi, Koa, NestJS (Express/Fastify wrappers), Next.js (API route wrapper), and AdonisJS.

## What It Does

- Blocks known bad traffic with static keyword rules and IP blacklisting
- Enforces rate limits with flood detection
- Detects bot-like form abuse using honeypot field checks and timing gates
- Enforces optional method policies (405) and suspicious method usage
- Blocks suspicious UUID probing on route prefixes (with optional existence resolver)
- Learns high-frequency malicious segments as dynamic suspicious keywords
- Runs IsolationForest anomaly checks with recent-behavior analysis
- Supports Redis/custom cache backends with memory fallback
- Optional GeoIP blocking (MMDB) with allow/block lists and dynamic blocklist
- CSV fallback storage when DB is unavailable
- Operational CLI for blacklist, exemptions, geo, request logs, training and diagnostics

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
- `lib/headerValidation.js`: header caps, suspicious UA, and header quality scoring
- `lib/geoBlocker.js`: GeoIP allow/block checks + MMDB lookup + cache
- `lib/middlewareLogger.js`: JSONL/CSV/DB request logging
- `lib/*Store.js`: DB/CSV storage adapters (blacklist, exemptions, geo, logs, keywords, models)
- `train.js`: offline model training from access logs
- `resources/model.json`: pretrained anomaly model artifact
- `utils/db.js`: SQLite connection (memory DB in test)
- `test/`: Jest test suite

## Request Processing Flow

1. Initialize module options for rate limiter, keyword detectors, honeypot, UUID checks, and anomaly detector.
2. Resolve client IP (`x-forwarded-for` first, then `req.ip`) and normalized path.
3. Enforce optional method policy (405) if enabled.
4. Block immediately if IP is already in blacklist.
5. Header validation (required headers, suspicious UA, header caps, quality score).
6. Geo checks (allow/block lists + DB-backed blocklist).
7. Honeypot field + timing checks.
8. Rate-limit + flood handling.
9. Static keyword blocking.
10. Dynamic keyword blocking.
11. UUID tamper checks (optional existence resolver).
12. Anomaly detection for unknown routes with recent-behavior analysis.
13. Request logging (JSONL/CSV/DB) and optional dynamic keyword learning on 404s.
14. Allow request through `next()` when no rule triggers.

## Installation

```bash
npm install aiwaf-js
```

### Optional WASM Acceleration

AIWAF can use the `aiwaf-wasm` optional dependency for faster IsolationForest scoring and deterministic feature validation.
If the WASM module fails to load, it automatically falls back to the JS implementation.

```bash
npm install aiwaf-wasm
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
  uuidRoutePrefix: '/user',
  AIWAF_HEADER_VALIDATION: true,
  AIWAF_METHOD_POLICY_ENABLED: true,
  AIWAF_ALLOWED_METHODS: ['GET', 'POST', 'HEAD', 'OPTIONS']
}));

app.get('/', (req, res) => res.send('Protected'));
app.listen(3000);
```

## Fastify Usage

```js
const fastify = require('fastify')({ logger: true });
const aiwaf = require('aiwaf-js');

fastify.register(aiwaf.fastify, {
  staticKeywords: ['.php', '.env', '.git'],
  dynamicTopN: 10,
  WINDOW_SEC: 10,
  MAX_REQ: 20,
  FLOOD_REQ: 40,
  HONEYPOT_FIELD: 'hp_field'
});

fastify.get('/', async () => 'Protected');
fastify.listen({ port: 3000 });
```

## Hapi Usage

```js
const Hapi = require('@hapi/hapi');
const aiwaf = require('aiwaf-js');

const server = Hapi.server({ port: 3000 });
await server.register({
  plugin: aiwaf.hapi,
  options: {
    staticKeywords: ['.php', '.env', '.git'],
    dynamicTopN: 10,
    WINDOW_SEC: 10,
    MAX_REQ: 20,
    FLOOD_REQ: 40,
    HONEYPOT_FIELD: 'hp_field'
  }
});

server.route({ method: 'GET', path: '/', handler: () => 'Protected' });
await server.start();
```

## Koa Usage

```js
const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const aiwaf = require('aiwaf-js');

const app = new Koa();
app.use(bodyParser());

app.use(aiwaf.koa({
  staticKeywords: ['.php', '.env', '.git'],
  dynamicTopN: 10,
  WINDOW_SEC: 10,
  MAX_REQ: 20,
  FLOOD_REQ: 40,
  HONEYPOT_FIELD: 'hp_field'
}));

app.use(ctx => {
  ctx.body = 'Protected';
});

app.listen(3000);
```

## NestJS (Express) Usage

```ts
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import aiwaf from 'aiwaf-js';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(aiwaf.nest({
        staticKeywords: ['.php', '.env', '.git'],
        dynamicTopN: 10,
        WINDOW_SEC: 10,
        MAX_REQ: 20,
        FLOOD_REQ: 40,
        HONEYPOT_FIELD: 'hp_field'
      }))
      .forRoutes('*');
  }
}
```

If you need to guarantee ordering before other middleware/proxies, you can also attach the Express middleware directly in `main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import aiwaf from 'aiwaf-js';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(aiwaf({
    staticKeywords: ['.php', '.env', '.git'],
    dynamicTopN: 10,
    WINDOW_SEC: 10,
    MAX_REQ: 20,
    FLOOD_REQ: 40,
    HONEYPOT_FIELD: 'hp_field'
  }));
  await app.listen(3000);
}
bootstrap();
```

## NestJS (Fastify) Usage

Use the Fastify plugin when running Nest with `FastifyAdapter`:

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import aiwaf from 'aiwaf-js';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter());
  await app.register(aiwaf.fastify, {
    staticKeywords: ['.php', '.env', '.git'],
    dynamicTopN: 10,
    WINDOW_SEC: 10,
    MAX_REQ: 20,
    FLOOD_REQ: 40,
    HONEYPOT_FIELD: 'hp_field'
  });
  await app.listen(3000, '0.0.0.0');
}
bootstrap();
```

## Next.js (API Routes) Usage

Use the `aiwaf.next` helper to wrap a Next.js API route handler.

```ts
import aiwaf from 'aiwaf-js';

function handler(req, res) {
  res.status(200).json({ ok: true });
}

export default aiwaf.next(handler, {
  staticKeywords: ['.php', '.env', '.git'],
  dynamicTopN: 10,
  WINDOW_SEC: 10,
  MAX_REQ: 20,
  FLOOD_REQ: 40,
  HONEYPOT_FIELD: 'hp_field'
});
```

## AdonisJS Usage

Register the middleware in your Adonis middleware stack:

```ts
import aiwaf from 'aiwaf-js';

export const middleware = [
  () => aiwaf.adonis({
    staticKeywords: ['.php', '.env', '.git'],
    dynamicTopN: 10,
    WINDOW_SEC: 10,
    MAX_REQ: 20,
    FLOOD_REQ: 40,
    HONEYPOT_FIELD: 'hp_field'
  })
];
```

## Configuration

### Core Controls

| Option | Default | Description |
|---|---|---|
| `staticKeywords` | `[]` | Substrings that trigger immediate block + blacklist |
| `dynamicTopN` or `DYNAMIC_TOP_N` | `10` | Frequency threshold for dynamic segment blocking |
| `WINDOW_SEC` | `60` | Time window for rate limiting |
| `MAX_REQ` | `100` | Max allowed requests in window before rate block |
| `FLOOD_REQ` | `200` | Hard threshold that blacklists IP |
| `HONEYPOT_FIELD` | `undefined` | Body field name used as bot trap |
| `uuidRoutePrefix` | `"/user"` | Path prefix monitored for UUID tamper attempts |
| `uuidResolver` | `undefined` | Optional async resolver `(uuid, req) => boolean` for existence checks |
| `cache` | fallback memory cache | Custom cache backend used by limiter/features |
| `nTrees` | `100` | IsolationForest trees when model is initialized in-process |
| `sampleSize` | `256` | IsolationForest sample size |
| `AIWAF_WASM_VALIDATION` | `true` | Enable WASM validation when available (headers, URL, content, recent) |
| `AIWAF_WASM_VALIDATE_RECENT` | `false` | Run WASM recent-behavior validation on recent request logs |

### Header Validation

| Option | Default | Description |
|---|---|---|
| `AIWAF_HEADER_VALIDATION` | `false` | Enable header validation pipeline |
| `AIWAF_REQUIRED_HEADERS` | `[]` | Required headers array, or `{ DEFAULT, GET, POST }` mapping |
| `AIWAF_HEADER_QUALITY_MIN_SCORE` | `3` | Minimum header quality score |
| `AIWAF_MAX_HEADER_BYTES` | `32768` | Max header bytes before blocking |
| `AIWAF_MAX_HEADER_COUNT` | `100` | Max header count before blocking |
| `AIWAF_MAX_USER_AGENT_LENGTH` | `500` | Max User-Agent length |
| `AIWAF_MAX_ACCEPT_LENGTH` | `4096` | Max Accept header length |
| `AIWAF_BLOCKED_USER_AGENTS` | list | Substring deny list |
| `AIWAF_SUSPICIOUS_USER_AGENTS` | regex list | Regex list for suspicious UA detection |
| `AIWAF_LEGITIMATE_BOTS` | regex list | Regex allow list for legitimate crawlers |

### Method Policy

| Option | Default | Description |
|---|---|---|
| `AIWAF_METHOD_POLICY_ENABLED` | `false` | Enforce method allowlist (returns 405) |
| `AIWAF_ALLOWED_METHODS` | `['GET','POST','HEAD','OPTIONS']` | Allowed methods when policy enabled |
| `AIWAF_POST_ONLY_SUFFIXES` | `['/create/','/submit/','/upload/','/delete/','/process/']` | GET to these triggers 405 when policy enabled |
| `AIWAF_LOGIN_PATH_PREFIXES` | common login paths | Shorten min form time for login |

### Keyword Learning

| Option | Default | Description |
|---|---|---|
| `AIWAF_ENABLE_KEYWORD_LEARNING` | `true` | Enable dynamic keyword learning |
| `AIWAF_DYNAMIC_TOP_N` | `10` | Dynamic keyword learning threshold |
| `AIWAF_EXEMPT_KEYWORDS` | `[]` | Skip these keywords |
| `AIWAF_ALLOWED_PATH_KEYWORDS` | `[]` | Allowlist of path fragments |

### Model / Training

| Option | Default | Description |
|---|---|---|
| `AIWAF_MIN_TRAIN_LOGS` | `50` | Minimum logs to run training |
| `AIWAF_MIN_AI_LOGS` | `10000` | Minimum logs to train AI model |
| `AIWAF_FORCE_AI_TRAINING` | `false` | Force AI training below minimum logs |
| `AIWAF_MODEL_STORAGE` | `file` | `file`, `db`, or `cache` |
| `AIWAF_MODEL_PATH` | `resources/model.json` | Model file path (file backend) |
| `AIWAF_MODEL_STORAGE_FALLBACK` | `file` | Fallback model backend |
| `AIWAF_MODEL_CACHE_KEY` | `aiwaf:model` | Cache key when using cache backend |
| `AIWAF_MODEL_CACHE_TTL` | `0` | Cache TTL in seconds |

### Geo Blocking

| Option | Default | Description |
|---|---|---|
| `AIWAF_GEO_BLOCK_ENABLED` | `false` | Enable geo blocking |
| `AIWAF_GEO_BLOCK_COUNTRIES` | `[]` | Block list (country codes) |
| `AIWAF_GEO_ALLOW_COUNTRIES` | `[]` | Allow list (country codes) |
| `AIWAF_GEO_MMDB_PATH` | `geolock/ipinfo_lite.mmdb` | MMDB path |
| `AIWAF_GEO_CACHE_SECONDS` | `3600` | Geo cache TTL |
| `AIWAF_GEO_CACHE_PREFIX` | `aiwaf:geo:` | Geo cache key prefix |

### Logging / Storage

| Option | Default | Description |
|---|---|---|
| `AIWAF_MIDDLEWARE_LOGGING` | `false` | Enable JSONL logging |
| `AIWAF_MIDDLEWARE_LOG_PATH` | `logs/aiwaf-requests.jsonl` | JSONL log path |
| `AIWAF_MIDDLEWARE_LOG_DB` | `false` | Store logs in DB |
| `AIWAF_MIDDLEWARE_LOG_CSV` | `false` | Store logs in CSV |
| `AIWAF_MIDDLEWARE_LOG_CSV_PATH` | `logs/aiwaf-requests.csv` | CSV log path |
| `AIWAF_BLOCKED_IPS_CSV_PATH` | `logs/storage/blocked_ips.csv` | CSV fallback for blocked IPs |
| `AIWAF_IP_EXEMPTIONS_CSV_PATH` | `logs/storage/ip_exemptions.csv` | CSV fallback for IP exemptions |
| `AIWAF_PATH_EXEMPTIONS_CSV_PATH` | `logs/storage/path_exemptions.csv` | CSV fallback for path exemptions |
| `AIWAF_GEO_BLOCKED_COUNTRIES_CSV_PATH` | `logs/storage/geo_blocked_countries.csv` | CSV fallback for geo blocklist |
| `AIWAF_REQUEST_LOGS_CSV_PATH` | `logs/storage/request_logs.csv` | CSV fallback for request logs |
| `AIWAF_DYNAMIC_KEYWORDS_CSV_PATH` | `logs/storage/dynamic_keywords.csv` | CSV fallback for dynamic keywords |

### Redis / Cache
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
AIWAF_ACCESS_LOG=/path/to/access.log npm run train
```

Optional rotated/gz support:

```bash
NODE_LOG_GLOB='/path/to/access.log.*' npm run train
```

Training pipeline in `train.js`:

- Reads raw and rotated (including `.gz`) access logs
- Parses request fields (IP, URI, status, response time, timestamp)
- Builds feature vectors: `[pathLen, kwHits, statusIdx, responseTime, burst, total404]`
- Enforces `AIWAF_MIN_TRAIN_LOGS` and `AIWAF_MIN_AI_LOGS`
- Trains IsolationForest when log volume is sufficient
- Learns dynamic keywords from suspicious 4xx/5xx traffic
- Removes exempt keywords and unblocks exempt IPs
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

- Header validation (caps, suspicious UA, quality scoring)
- Method policy enforcement
- Geo blocking and MMDB lookup
- Honeypot timing policies
- UUID tamper detection (with resolver)
- Anomaly detection and recent-behavior analysis
- Dynamic keyword learning and trainer behaviors
- CSV/DB fallback storage
- CLI and settings compatibility

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
- Dynamic keyword learning persists to DB/CSV via `dynamicKeywordStore`.
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

## Sandbox (OWASP Juice Shop)

The repository includes a runnable sandbox that proxies OWASP Juice Shop behind AIWAF. It also includes an attack suite that generates comparable results for direct vs protected traffic.

Run sandbox:

```bash
docker compose -f examples/sandbox/docker-compose.yml up --build
```

Run the attack suite and compare:

```bash
node examples/sandbox/run-and-compare.js http://localhost:3001 http://localhost:3000
```

The comparison output includes per‑attack block rates and total blocked requests.
Fastify proxy is also available on `http://localhost:3002`.

## License

MIT
