# AIWAF-JS + OWASP Juice Shop Sandbox

This sandbox runs AIWAF-JS as a proxy in front of OWASP Juice Shop.

## Run

From `examples/sandbox/`:

```bash
docker compose up --build
```

Then open:

- AIWAF-protected: `http://localhost:3000`
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

Compare results:

```bash
node compare-results.js results_direct_*.json results_protected_*.json
```

Or run the full suite + comparison in one command:

```bash
node run-and-compare.js http://localhost:3001 http://localhost:3000
```
