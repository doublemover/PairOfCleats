# CI Capability Policy

This policy defines how optional capabilities are treated in CI and nightly runs.

## CI (run-suite --mode ci)
- Required: core CI-lite lane (`tests/run.js --lane ci-lite`).
- Optional capabilities (SQLite, LMDB, HNSW, LanceDB, Tantivy) should **skip with a reason** if unavailable.
- Missing optional capabilities must not fail CI.

## Nightly (run-suite --mode ci --lane ci)
- Required: core CI lane (`tests/run.js --lane ci`).
- Optional capabilities are exercised when available; missing capabilities are logged as warnings.

## Reporting
- `tools/ci/capability-gate.js` writes `.diagnostics/capabilities.json` and prints a summary.
- Exit code is non-zero only if explicitly required capabilities are missing.
