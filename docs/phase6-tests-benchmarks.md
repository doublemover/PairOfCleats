# Phase 6: Expanded Tests + Benchmarks

## Fixture Repos
Deterministic fixtures live under `tests/fixtures/` (currently `sample` and `mixed`) and are used for smoke and parity validation without downloading models.

### Fixture Smoke
```bash
npm run fixture-smoke
```

This runs `build_index.js --stub-embeddings` against the fixture, builds the SQLite index, and validates search output.

Optional flags:
- `npm run fixture-smoke -- --all`
- `npm run fixture-smoke -- --fixture mixed`

### Fixture Parity
```bash
npm run fixture-parity
```

Runs the parity harness against every fixture to compare memory vs SQLite results and report ranking overlap.

### Model Comparison Harness
```bash
npm run compare-models -- --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2 --build
```

Compares latency and ranking overlap across embedding models. Use `--json` or `--out` for a report.

### Combined Summary Report
```bash
npm run summary-report -- --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2
```

Runs the compare-models harness (memory + sqlite) and the parity harness (sqlite + sqlite-fts), then writes `docs/combined-summary.json`.

Skip rebuilds (reuses existing indexes):
```bash
npm run summary-report -- --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2 --no-build
```

Test harness:
```bash
npm run summary-report-test
```

### Fixture Eval
```bash
npm run fixture-eval
```

Runs expected-hit checks against fixture queries and reports a simple MRR score.

### Query Cache Harness
```bash
npm run query-cache-test
```

Validates that the persistent query cache records a miss on the first request and a hit on the second.

## Benchmark Harness
```bash
npm run bench
npm run bench-ann
npm run bench -- --no-ann --limit 5 --write-report
```

The benchmark script:
- Runs a query set against memory and SQLite backends.
- Captures average latency.
- Records current artifact sizes using `tools/report-artifacts.js`.
- Optionally writes a report to `docs/benchmarks.json`.

Optional flags:
- `--build` to measure index + sqlite build time before running queries.
- `--build-index` or `--build-sqlite` to measure one build step.
- `--stub-embeddings` to avoid model downloads during build.
- `--ann` to force ANN on (defaults to on when `search.annDefault` is true).

## Notes
- `PAIROFCLEATS_EMBEDDINGS=stub` or `--stub-embeddings` skips model downloads.
- Benchmarks are intended to be opt-in to avoid expensive builds during normal workflows.

## Uninstall Test
```bash
npm run uninstall-test
```

Runs a contained uninstall flow against a temporary cache root and verifies that caches, dictionaries, and models are deleted.

## MCP Server Test
```bash
npm run mcp-server-test
```

Runs a minimal MCP handshake and tool call against the stdio server.

## SQLite ANN Extension Test
```bash
npm run sqlite-ann-extension-test
```

Builds a fixture index with the SQLite ANN extension enabled and asserts the
extension table is present and used during search.

## Download Extensions Archive Test
```bash
npm run download-extensions-test
```

Downloads stub `.zip` and `.tar` archives via a local server and verifies the
extension binary is extracted and recorded in `extensions.json`.

## Verify Extensions Command
```bash
npm run verify-extensions -- --no-load
```

Validates that the configured extension binary is present (use `--load` to
attempt loading it into SQLite).
