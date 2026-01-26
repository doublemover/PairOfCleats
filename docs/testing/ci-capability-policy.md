# CI Capability Policy

This policy defines how optional capabilities are treated in CI and nightly runs.

## PR (test:pr)
- Required: core CI lane (`tests/run.js --lane ci`).
- Optional capabilities (SQLite, LMDB, HNSW, LanceDB, Tantivy) should **skip with a reason** if unavailable.
- Missing optional capabilities must not fail PRs.

## Nightly (test:nightly)
- Run broader lanes (including storage/perf where applicable).
- Optional capabilities are exercised when available; missing capabilities are logged as warnings.

## Reporting
- `tools/ci/capability-gate.js` writes `.diagnostics/capabilities.json` and prints a summary.
- Exit code is non-zero only if explicitly required capabilities are missing.
