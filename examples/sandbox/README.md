# AIWAF-JS + OWASP Juice Shop Sandbox

This sandbox runs AIWAF-JS as a proxy in front of OWASP Juice Shop.

## Run

From `examples/sandbox/`:

```bash
docker compose up --build
```

Then open:

- AIWAF-protected: `http://localhost:3000`
- AIWAF-protected (Fastify): `http://localhost:3002`
- AIWAF-protected (Hapi): `http://localhost:3003`
- AIWAF-protected (Koa): `http://localhost:3004`
- AIWAF-protected (NestJS): `http://localhost:3005`
- Direct Juice Shop: `http://localhost:3001`

## Test

```bash
curl http://localhost:3000
curl http://localhost:3000/admin.php
curl http://localhost:3000/../../etc/passwd
curl -A "sqlmap/1.0" http://localhost:3000
```

Check logs in the `aiwaf_logs` volume (JSONL).

## Attack Suite

Run against direct Juice Shop:

```bash
node attack-suite.js http://localhost:3001 direct
```

Run against AIWAF-protected Juice Shop:

```bash
node attack-suite.js http://localhost:3000 protected
```

Run against AIWAF-protected Juice Shop (Fastify):

```bash
node attack-suite.js http://localhost:3002 protected_fastify
```

Run against AIWAF-protected Juice Shop (Hapi):

```bash
node attack-suite.js http://localhost:3003 protected_hapi
```

Run against AIWAF-protected Juice Shop (Koa):

```bash
node attack-suite.js http://localhost:3004 protected_koa
```

Run against AIWAF-protected Juice Shop (NestJS):

```bash
node attack-suite.js http://localhost:3005 protected_nest
```

Compare results:

```bash
node compare-results.js results_direct_*.json results_protected_*.json results_protected_fastify_*.json results_protected_hapi_*.json results_protected_koa_*.json results_protected_nest_*.json
```

Or run the full suite + comparison in one command:

```bash
node run-and-compare.js
```
